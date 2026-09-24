import { create } from '@bufbuild/protobuf'
import type { WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import type { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { getPublicKey } from '@vultisig/core-chain/publicKey/getPublicKey'
import { getNativeSwapChainId } from '@vultisig/core-chain/swap/native/NativeSwapChain'
import { assertValidThorchainDepositMemo } from '@vultisig/core-chain/swap/native/thorchainDepositMemo'
// Import THOR/Maya resolvers directly rather than going through the
// `keysign/chainSpecific` barrel — the barrel imports every chain's
// resolver (TON, Tron, Polkadot, …), which pulls in their per-chain
// configs. Tests that mock `chainFeeCoin` for a subset of chains
// (e.g. EVM-only) then crash at module load with
// `Cannot read properties of undefined (reading 'decimals')` because
// the TON config reads `chainFeeCoin[Chain.Ton].decimals` eagerly.
// Direct imports keep this helper's transitive surface minimal.
import { getMayaChainSpecific } from '@vultisig/core-mpc/keysign/chainSpecific/resolvers/maya'
import { getThorchainChainSpecific } from '@vultisig/core-mpc/keysign/chainSpecific/resolvers/thor'
import { toCommCoin } from '@vultisig/core-mpc/types/utils/commCoin'
import { CoinSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/coin_pb'
import { KeysignPayload, KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { THORChainSwapPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/thorchain_swap_payload_pb'
import { Buffer } from 'buffer'

import { getWalletCore } from '../../context/wasmRuntime'
import type { VaultIdentity } from './types'

export type PrepareThorchainMsgDepositTxFromKeysParams = {
  /** AccountCoin for the fee/native asset (RUNE on THORChain, CACAO on MayaChain). */
  coin: AccountCoin
  /** Native-asset base units (1 RUNE = 1e8, 1 CACAO = 1e10). */
  amountBaseUnits: bigint
  /** Pre-built memo (`+:POOL[:PAIRED]`, `-:POOL:BPS[:ASSET]`, etc.). */
  memo: string
  /** Secured L1 asset withdrawn from THORChain. Omit for native THOR/Maya deposits. */
  securedWithdrawal?: {
    l1Chain: string
    ticker: string
    contractAddress?: string
    destination: string
  }
}

/**
 * Build a `KeysignPayload` for a THORChain / MayaChain `MsgDeposit` from raw
 * vault identity fields.
 *
 * The cosmos signing-input resolver branches on `isDeposit: true` (set on
 * `blockchainSpecific.thorchainSpecific` / `mayaSpecific`) to emit a
 * `THORChainDeposit` proto message rather than the default `THORChainSend`
 * — see `packages/core/mpc/keysign/signingInputs/resolvers/cosmos/index.ts`.
 * Setting `toAddress: ''` matches the on-chain shape (MsgDeposit has no
 * recipient) and the resolver reads the deposit amount from
 * `keysignPayload.toAmount`.
 *
 * Unlike `buildSendKeysignPayload`, this helper does **not** run
 * `refineKeysignAmount`: LP deposit amounts are user-controlled (asymmetric
 * deposit size for `+:`, dust constant for `-:`) and must be passed through
 * verbatim. Callers are responsible for ensuring sufficient balance.
 */
export const prepareThorchainMsgDepositTxFromKeys = async (
  identity: VaultIdentity,
  params: PrepareThorchainMsgDepositTxFromKeysParams,
  walletCoreOverride?: WalletCore
): Promise<KeysignPayload> => {
  const { coin, amountBaseUnits, memo, securedWithdrawal } = params

  if (coin.chain !== Chain.THORChain && coin.chain !== Chain.MayaChain) {
    throw new Error(
      `prepareThorchainMsgDepositTxFromKeys: chain ${coin.chain} not supported (THORChain / MayaChain only)`
    )
  }
  if (amountBaseUnits <= 0n) {
    throw new Error('prepareThorchainMsgDepositTxFromKeys: amountBaseUnits must be > 0')
  }
  if (!memo) {
    throw new Error('prepareThorchainMsgDepositTxFromKeys: memo is required')
  }
  assertValidThorchainDepositMemo(memo)
  if (securedWithdrawal) {
    if (coin.chain !== Chain.THORChain) {
      throw new Error('prepareThorchainMsgDepositTxFromKeys: secured withdrawals require THORChain')
    }
    const { l1Chain, ticker, contractAddress, destination } = securedWithdrawal
    if (!getNativeSwapChainId(l1Chain as Chain) || l1Chain === Chain.THORChain || l1Chain === Chain.MayaChain) {
      throw new Error('prepareThorchainMsgDepositTxFromKeys: unsupported secured withdrawal L1 chain')
    }
    if (!/^[A-Z0-9]+$/i.test(ticker) || (contractAddress !== undefined && !/^[A-Z0-9]+$/i.test(contractAddress))) {
      throw new Error('prepareThorchainMsgDepositTxFromKeys: invalid secured withdrawal asset')
    }
    if (!destination || memo !== `secure-:${destination}`) {
      throw new Error('prepareThorchainMsgDepositTxFromKeys: secure- memo must match the destination')
    }
  }

  const walletCore = walletCoreOverride ?? (await getWalletCore())

  const publicKey = getPublicKey({
    chain: coin.chain,
    walletCore,
    publicKeys: {
      ecdsa: identity.ecdsaPublicKey,
      eddsa: identity.eddsaPublicKey,
    },
    hexChainCode: identity.hexChainCode,
    chainPublicKeys: identity.chainPublicKeys,
  })

  const hexPublicKey = Buffer.from(publicKey.data()).toString('hex')

  const keysignPayload = create(KeysignPayloadSchema, {
    coin: toCommCoin({ ...coin, hexPublicKey }),
    toAddress: '',
    toAmount: amountBaseUnits.toString(),
    memo,
    vaultLocalPartyId: identity.localPartyId,
    vaultPublicKeyEcdsa: identity.ecdsaPublicKey,
    libType: identity.libType,
  })

  if (securedWithdrawal) {
    const { l1Chain, ticker, contractAddress = '', destination } = securedWithdrawal
    const assetCoin = create(CoinSchema, {
      chain: l1Chain,
      ticker,
      contractAddress,
      decimals: 8,
      isNativeToken: !contractAddress,
    })
    keysignPayload.swapPayload = {
      case: 'thorchainSwapPayload',
      value: create(THORChainSwapPayloadSchema, {
        fromAddress: coin.address,
        fromCoin: assetCoin,
        toCoin: create(CoinSchema, { ...assetCoin, address: destination, isNativeToken: false }),
        fromAmount: amountBaseUnits.toString(),
        toAmountDecimal: '0',
        toAmountLimit: '0',
        streamingInterval: '0',
        streamingQuantity: '0',
        vaultAddress: '',
        routerAddress: '',
        expirationTime: 0n,
        isAffiliate: false,
        fee: '0',
      }),
    }
  }

  // Dispatch directly to the per-chain resolver so we don't pull the
  // full `getChainSpecific` barrel (see import comment). Branched (rather
  // than picking a resolver reference and reusing one `case`/`value` pair)
  // so each branch's literal `case` and its resolver's return type stay
  // statically paired by the KeysignPayload oneof — a mismatch between the
  // two (e.g. a future refactor swapping one resolver but not the other)
  // fails at compile time instead of being silently accepted by an
  // `as any` cast (SDK-CORRECTNESS-08).
  if (coin.chain === Chain.THORChain) {
    const value = await getThorchainChainSpecific({ keysignPayload, walletCore, isDeposit: true })
    keysignPayload.blockchainSpecific = { case: 'thorchainSpecific', value }
  } else {
    const value = await getMayaChainSpecific({ keysignPayload, walletCore, isDeposit: true })
    keysignPayload.blockchainSpecific = { case: 'mayaSpecific', value }
  }

  return keysignPayload
}
