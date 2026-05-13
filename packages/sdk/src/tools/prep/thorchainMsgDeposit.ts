import { create } from '@bufbuild/protobuf'
import type { WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import type { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { getPublicKey } from '@vultisig/core-chain/publicKey/getPublicKey'
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
import { KeysignPayload, KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
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
  const { coin, amountBaseUnits, memo } = params

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

  // Dispatch directly to the per-chain resolver so we don't pull the
  // full `getChainSpecific` barrel (see import comment).
  const resolver = coin.chain === Chain.THORChain ? getThorchainChainSpecific : getMayaChainSpecific
  const value = await resolver({ keysignPayload, walletCore, isDeposit: true })
  keysignPayload.blockchainSpecific = {
    case: coin.chain === Chain.THORChain ? 'thorchainSpecific' : 'mayaSpecific',
    value: value as any,
  }

  return keysignPayload
}
