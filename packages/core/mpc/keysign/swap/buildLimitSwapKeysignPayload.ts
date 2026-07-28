import { Buffer } from 'buffer'
import { create } from '@bufbuild/protobuf'
import { fromChainAmountDisplay } from '@vultisig/core-chain/amount/fromChainAmountExact'
import { Chain } from '@vultisig/core-chain/Chain'
import { isChainOfKind } from '@vultisig/core-chain/ChainKind'
import { getThorchainInboundAddress } from '@vultisig/core-chain/chains/cosmos/thor/getThorchainInboundAddress'
import { getErc20Allowance } from '@vultisig/core-chain/chains/evm/erc20/getErc20Allowance'
import { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { areEqualCoins } from '@vultisig/core-chain/coin/Coin'
import { isFeeCoin } from '@vultisig/core-chain/coin/utils/isFeeCoin'
import { getAdvancedSwapQueueEnabled } from '@vultisig/core-chain/swap/native/limitSwapAvailability'
import {
  findLimitSwapInbound,
  isLimitSwapDestinationHalted,
  shouldBlockRuneDeposit,
} from '@vultisig/core-chain/swap/native/limitSwapInbound'
import { assertLimitSwapMemo } from '@vultisig/core-chain/swap/native/limitSwapMemo'
import { getNativeSwapDecimals } from '@vultisig/core-chain/swap/native/utils/getNativeSwapDecimals'
import { WalletCore } from '@trustwallet/wallet-core'
import { PublicKey } from '@trustwallet/wallet-core/dist/src/wallet-core'

import { getChainSpecific } from '../chainSpecific'
import { refineKeysignUtxo } from '../refine/utxo'
import { getKeysignUtxoInfo } from '../utxo/getKeysignUtxoInfo'
import { KeysignLibType } from '../../mpcLib'
import { toCommCoin } from '../../types/utils/commCoin'
import { Erc20ApprovePayloadSchema } from '../../types/vultisig/keysign/v1/erc20_approve_payload_pb'
import { KeysignPayloadSchema } from '../../types/vultisig/keysign/v1/keysign_message_pb'
import { THORChainSwapPayloadSchema } from '../../types/vultisig/keysign/v1/thorchain_swap_payload_pb'

/**
 * On-chain deadline for the router's `depositWithExpiry` call.
 *
 * This bounds when the *deposit transaction* may execute — a stale, long-
 * unconfirmed tx cannot land later. It is NOT the resting order's lifetime: that
 * is the memo's interval, up to 3 days, evaluated per block by THORChain. Once
 * THORChain observes the deposit (a block or two, far inside this window) the
 * order rests for its full memo TTL regardless of this value.
 */
const routerExpiryMs = 15 * 60 * 1000

export type BuildLimitSwapKeysignPayloadInput = {
  fromCoin: AccountCoin
  toCoin: AccountCoin
  /** Source amount in the coin's native smallest units. */
  amount: bigint
  /** The `=<` memo from `buildLimitSwapMemo`. */
  memo: string
  vaultId: string
  localPartyId: string
  fromPublicKey: PublicKey
  toPublicKey: PublicKey
  libType: KeysignLibType
  walletCore: WalletCore
  /**
   * The order's guaranteed-minimum output (the memo's LIM) in the target's
   * smallest units, for cross-device "you receive" display only. Never
   * influences signing.
   *
   * Taken as a chain amount rather than a decimal so it is formatted the same
   * way the market path formats its expected output — `Number#toString()` would
   * emit scientific notation for dust values and render as `1e-8` on a co-signer.
   */
  expectedToAmount?: bigint
  /** Epoch milliseconds; parameterised so the router expiry is deterministic under test. */
  now?: number
}

/**
 * Build the `KeysignPayload` for a THORChain limit order.
 *
 * The limit-ness always lives in the memo (`=<` vs the market `=>`); how that
 * memo reaches the chain depends on the source asset:
 *
 * - **Native RUNE** — `MsgDeposit` on THORChain itself. No inbound vault and no
 *   real destination, so `toAddress` carries the signer's own address as a
 *   placeholder (the Cosmos signer keys off `isDeposit`, not `toAddress`).
 * - **Native gas asset** (BTC/ETH/AVAX/…) — a plain transfer to the Asgard
 *   inbound vault with the memo in tx `data` / `OP_RETURN`. No swap payload.
 * - **ERC20** — the router's `depositWithExpiry(vault, asset, amount, memo,
 *   expiry)` call, which needs `approve(router, amount)` first. Both ride one
 *   ceremony, mirroring the market ERC20 THORChain swap. A token source signed
 *   *without* a swap payload would fall through to a plain ERC20 transfer,
 *   dropping the memo and stranding the tokens on the router — so it must carry
 *   one.
 *
 * Fund-safety gates, all fail-closed:
 * - The `EnableAdvSwapQueue` mimir is re-checked here, at sign time. Placement
 *   was already gated on it, but it can flip while the user sits on Verify, and
 *   a `=<` order on a network with the queue disabled can execute as an
 *   unprotected market swap.
 * - The memo must actually be a limit memo.
 * - RUNE deposits are blocked on THORChain's global trading pause (they bypass
 *   the per-chain inbound halt filter entirely), including when the inbound list
 *   is unverifiable — and on a halted destination chain: with no swap payload
 *   attached, the broadcast guard's destination-leg re-check never runs for
 *   them, so sign time is their only destination gate.
 * - External sources must resolve a live, non-halted, non-paused inbound row,
 *   and the destination is taken from that same live view rather than a cache.
 *
 * Gas: unlike iOS, no EVM gas-limit override is applied. iOS pins a native-EVM
 * limit deposit to 120000 to match its own market path; here both paths put the
 * memo on `keysignPayload.memo` and neither sets a general swap payload, so both
 * already floor at `deriveEvmGasLimit`'s 600000 data-tx limit. Forcing 120000
 * would make the limit path diverge from the market path and risk under-gassing.
 */
export const buildLimitSwapKeysignPayload = async ({
  fromCoin,
  toCoin,
  amount,
  memo,
  vaultId,
  localPartyId,
  fromPublicKey,
  toPublicKey,
  libType,
  walletCore,
  expectedToAmount = 0n,
  now = Date.now(),
}: BuildLimitSwapKeysignPayloadInput) => {
  assertLimitSwapMemo(memo)

  if (amount <= 0n) {
    throw new Error('buildLimitSwapKeysignPayload: amount must be greater than 0')
  }

  if (!(await getAdvancedSwapQueueEnabled())) {
    throw new Error(
      "THORChain's advanced swap queue is disabled; a limit order placed now could execute as an unprotected market swap"
    )
  }

  const fromCoinHexPublicKey = Buffer.from(fromPublicKey.data()).toString('hex')
  const toCoinHexPublicKey = Buffer.from(toPublicKey.data()).toString('hex')

  const isRuneDeposit = areEqualCoins(fromCoin, chainFeeCoin[Chain.THORChain])

  const inbounds = await getThorchainInboundAddress()

  const { toAddress, swapPayload, approveSpender } = ((): {
    toAddress: string
    swapPayload?: ReturnType<typeof create<typeof THORChainSwapPayloadSchema>>
    approveSpender?: string
  } => {
    if (isRuneDeposit) {
      if (shouldBlockRuneDeposit(inbounds)) {
        throw new Error(
          'THORChain has globally paused trading (or its inbound list is unverifiable); refusing to sign a RUNE limit-order deposit'
        )
      }

      if (isLimitSwapDestinationHalted({ inbounds, chain: toCoin.chain })) {
        throw new Error(
          `THORChain has halted ${toCoin.chain} trading; refusing to sign a RUNE limit-order deposit whose outbound could not leave`
        )
      }

      return { toAddress: fromCoin.address }
    }

    const inbound = findLimitSwapInbound({ inbounds, chain: fromCoin.chain })

    if (isFeeCoin(fromCoin)) {
      return { toAddress: inbound.address }
    }

    const { router } = inbound
    if (!router) {
      throw new Error(
        `buildLimitSwapKeysignPayload: THORChain's ${inbound.chain} inbound has no router contract, so a token deposit cannot be built`
      )
    }

    return {
      toAddress: router,
      approveSpender: router,
      swapPayload: create(THORChainSwapPayloadSchema, {
        fromAddress: fromCoin.address,
        fromCoin: toCommCoin({ ...fromCoin, hexPublicKey: fromCoinHexPublicKey }),
        toCoin: toCommCoin({ ...toCoin, hexPublicKey: toCoinHexPublicKey }),
        vaultAddress: inbound.address,
        routerAddress: router,
        fromAmount: amount.toString(),
        // Display-only, for the co-signer's "you receive" row. The order's real
        // floor is the LIM inside the memo; these fields are never read here.
        toAmountDecimal: fromChainAmountDisplay(expectedToAmount, getNativeSwapDecimals(toCoin)),
        toAmountLimit: '0',
        streamingInterval: '0',
        streamingQuantity: '0',
        expirationTime: BigInt(Math.floor((now + routerExpiryMs) / 1000)),
        isAffiliate: true,
      }),
    }
  })()

  let keysignPayload = create(KeysignPayloadSchema, {
    coin: toCommCoin({ ...fromCoin, hexPublicKey: fromCoinHexPublicKey }),
    toAmount: amount.toString(),
    vaultLocalPartyId: localPartyId,
    vaultPublicKeyEcdsa: vaultId,
    libType,
    toAddress,
    memo,
    utxoInfo: await getKeysignUtxoInfo(fromCoin),
    ...(swapPayload ? { swapPayload: { case: 'thorchainSwapPayload' as const, value: swapPayload } } : {}),
  })

  keysignPayload.blockchainSpecific = await getChainSpecific({
    keysignPayload,
    walletCore,
    isDeposit: isRuneDeposit,
  })

  if (approveSpender && isChainOfKind(fromCoin.chain, 'evm') && fromCoin.id) {
    const allowance = await getErc20Allowance({
      chain: fromCoin.chain,
      id: fromCoin.id,
      address: fromCoin.address,
      spender: approveSpender,
    })

    if (allowance < amount) {
      keysignPayload.erc20ApprovePayload = create(Erc20ApprovePayloadSchema, {
        amount: amount.toString(),
        spender: approveSpender,
      })
    }
  }

  if (isChainOfKind(fromCoin.chain, 'utxo')) {
    keysignPayload = await refineKeysignUtxo({
      keysignPayload,
      walletCore,
      publicKey: fromPublicKey,
    })
  }

  return keysignPayload
}
