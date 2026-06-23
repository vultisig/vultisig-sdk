import { create } from '@bufbuild/protobuf'
import type { WalletCore } from '@trustwallet/wallet-core'
import { Chain, UtxoChain } from '@vultisig/core-chain/Chain'
import type { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { getPublicKey } from '@vultisig/core-chain/publicKey/getPublicKey'
import { toCommCoin } from '@vultisig/core-mpc/types/utils/commCoin'
import { UTXOSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import {
  type KeysignPayload,
  KeysignPayloadSchema,
} from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { UtxoInfoSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/utxo_info_pb'
import { Buffer } from 'buffer'

import { getWalletCore } from '../../context/wasmRuntime'
import type { VaultIdentity } from './types'

/**
 * Chains that support UTXO consolidation. Mirrors the mcp-ts
 * `build_utxo_consolidate` chain set (BTC/LTC/DOGE/BCH/DASH). Zcash is
 * intentionally excluded — it carries a separate `zcashSpecific` blockchain
 * payload, so its consolidation path would diverge from the plain `utxoSpecific`
 * envelope built here.
 */
export const CONSOLIDATE_CHAINS = [
  UtxoChain.Bitcoin,
  UtxoChain.Litecoin,
  UtxoChain.Dogecoin,
  UtxoChain.BitcoinCash,
  UtxoChain.Dash,
] as const

export type ConsolidateChain = (typeof CONSOLIDATE_CHAINS)[number]

const isConsolidateChain = (chain: Chain): chain is ConsolidateChain =>
  (CONSOLIDATE_CHAINS as readonly Chain[]).includes(chain)

/**
 * A single unspent output to feed into the consolidation transaction.
 * These are supplied by the caller (e.g. mcp-ts / agent-backend fetches them
 * from Blockchair) — the SDK never performs network IO here, keeping this a
 * pure crypto builder.
 */
export type ConsolidateUtxo = {
  /** Funding transaction id (txid / `transaction_hash`). */
  hash: string
  /** Output index (vout). */
  index: number
  /** Value in satoshis. */
  value: bigint
}

export type PrepareUtxoConsolidateTxFromKeysParams = {
  /**
   * The UTXO coin to consolidate. `chain` must be one of {@link CONSOLIDATE_CHAINS}
   * and `address` is the self-address every input belongs to (and the single
   * consolidation output goes back to).
   */
  coin: AccountCoin
  /** The set of UTXOs to sweep. Must contain at least 2 entries (otherwise there is nothing to consolidate). */
  utxos: ConsolidateUtxo[]
  /** Fee rate in satoshis per virtual byte (sat/vB). */
  byteFee: bigint
}

// Segwit-baseline virtual-size estimate matching the mcp-ts / Go side:
// 10 bytes tx overhead + 68 bytes per input + 34 bytes for the single output.
// Real signed-tx vsize for P2WPKH / P2SH-P2WPKH inputs lands close to this.
//
// NOTE: this is an ESTIMATE only. The payload is built with
// `sendMaxAmount: true` (see below), so the on-device signer's
// WalletCore `AnySigner.plan` recomputes the real fee from its own
// signed-tx size model and ignores `toAmount`. The returned `fee` /
// `outputAmount` are advisory display values, NOT the signed values.
const TX_OVERHEAD_VBYTES = 10n
const PER_INPUT_VBYTES = 68n
const SINGLE_OUTPUT_VBYTES = 34n

const estimateConsolidationFee = (inputCount: number, byteFee: bigint): bigint => {
  const vsize = TX_OVERHEAD_VBYTES + BigInt(inputCount) * PER_INPUT_VBYTES + SINGLE_OUTPUT_VBYTES
  return vsize * byteFee
}

export type PrepareUtxoConsolidateResult = {
  /** The unsigned consolidation KeysignPayload, ready for on-device signing. NEVER signed or broadcast here. */
  keysignPayload: KeysignPayload
  /** Number of inputs swept. */
  inputCount: number
  /** Sum of all input values (satoshis). */
  totalInput: bigint
  /**
   * ESTIMATED fee (satoshis) from the `10 + 68/input + 34` vbyte model.
   *
   * Because the payload is `sendMaxAmount: true`, the on-device signer
   * (WalletCore `AnySigner.plan`) recomputes the actual fee from its own
   * signed-tx size model. This value is therefore ADVISORY — safe for a
   * "≈ fee" UI preview, but it is NOT the fee of the broadcast tx and may
   * differ by a few sats per input. Never treat it as authoritative.
   */
  fee: bigint
  /**
   * ESTIMATED consolidated output value back to self (`totalInput - fee`,
   * satoshis).
   *
   * Same caveat as {@link fee}: under `sendMaxAmount: true` the signer
   * sweeps `Σinputs − ITS OWN fee`, so the actually-signed output can
   * diverge slightly from this estimate. The send-max-to-self structure
   * guarantees funds can never misroute (output address === input
   * address), only the exact displayed amount may drift. Advisory only.
   */
  outputAmount: bigint
}

/**
 * Build an UNSIGNED UTXO consolidation `KeysignPayload` from raw vault identity
 * fields + an explicitly-provided UTXO set, without an instantiated vault and
 * without any network IO.
 *
 * A consolidation is a send-max-to-self: every supplied UTXO is swept into one
 * output back to `coin.address`. The payload is built with `sendMaxAmount: true`
 * and `toAddress === coin.address` so the on-device signer (`vault.sign`)
 * produces a single-output tx. This function NEVER signs and NEVER broadcasts —
 * the signing material stays on-device. The vault-free equivalent of a
 * consolidation transaction builder, intended for MCP servers / agent backends
 * that only hold the public vault identity.
 *
 * `walletCore` is optional; when omitted, falls back to the SDK's
 * globally-configured `getWalletCore()`.
 *
 * IMPORTANT — returned `fee` / `outputAmount` are ESTIMATES. Because the
 * payload is `sendMaxAmount: true`, the on-device signer recomputes the
 * fee/output from its own size model and ignores the `toAmount` written
 * here. Use the returned values for a "≈" preview only; the broadcast tx
 * is authoritative. This contrasts with the mcp-ts `build_utxo_consolidate`
 * envelope, which emits an explicit `inputs[]` + `output_amount` PSBT the
 * app builds deterministically. Send-max-to-self (output === input address)
 * means funds can never misroute — only the displayed amount may drift.
 *
 * @example
 * ```ts
 * const { keysignPayload, fee, outputAmount } = await prepareUtxoConsolidateTxFromKeys(identity, {
 *   coin: { chain: 'Bitcoin', address: 'bc1q...', decimals: 8, ticker: 'BTC' },
 *   utxos: [
 *     { hash: 'aaaa...', index: 0, value: 50_000n },
 *     { hash: 'bbbb...', index: 1, value: 30_000n },
 *   ],
 *   byteFee: 12n,
 * })
 * ```
 */
export const prepareUtxoConsolidateTxFromKeys = async (
  identity: VaultIdentity,
  params: PrepareUtxoConsolidateTxFromKeysParams,
  walletCoreOverride?: WalletCore
): Promise<PrepareUtxoConsolidateResult> => {
  const { coin, utxos, byteFee } = params

  if (!isConsolidateChain(coin.chain)) {
    throw new Error(`Unsupported chain for consolidation: ${coin.chain} (supported: ${CONSOLIDATE_CHAINS.join(', ')})`)
  }

  if (utxos.length <= 1) {
    throw new Error(`Nothing to consolidate: expected at least 2 UTXOs, got ${utxos.length}`)
  }

  if (byteFee <= 0n) {
    throw new Error(`byteFee must be greater than zero, got ${byteFee.toString()}`)
  }

  let totalInput = 0n
  for (let i = 0; i < utxos.length; i++) {
    const u = utxos[i]
    if (u.value < 0n) {
      throw new Error(`Invalid UTXO value at index ${i}: ${u.value.toString()} (must be non-negative)`)
    }
    if (u.index < 0 || !Number.isSafeInteger(u.index)) {
      throw new Error(`Invalid UTXO index at index ${i}: ${u.index} (must be a non-negative safe integer)`)
    }
    if (!u.hash) {
      throw new Error(`Missing UTXO hash at index ${i}`)
    }
    totalInput += u.value
  }

  const fee = estimateConsolidationFee(utxos.length, byteFee)

  if (fee >= totalInput) {
    throw new Error(
      `Consolidation not economical: fee (${fee.toString()}) >= total input (${totalInput.toString()}) for ${utxos.length} UTXOs`
    )
  }

  const outputAmount = totalInput - fee

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
    // Consolidation is a send-to-self: the single output goes back to the same address.
    toAddress: coin.address,
    // toAmount is the ESTIMATED output. Under `sendMaxAmount: true` the
    // signer ignores it and sweeps `Σinputs − ITS OWN fee`; we still set it
    // so any non-max consumer / display layer has a sane value to show.
    toAmount: outputAmount.toString(),
    vaultLocalPartyId: identity.localPartyId,
    vaultPublicKeyEcdsa: identity.ecdsaPublicKey,
    libType: identity.libType,
    // Explicitly-provided inputs — no on-chain UTXO fetch.
    utxoInfo: utxos.map(u =>
      create(UtxoInfoSchema, {
        hash: u.hash,
        amount: u.value,
        index: u.index,
      })
    ),
    blockchainSpecific: {
      case: 'utxoSpecific',
      value: create(UTXOSpecificSchema, {
        // Sweep everything to the single output.
        sendMaxAmount: true,
        byteFee: byteFee.toString(),
      }),
    },
  })

  return {
    keysignPayload,
    inputCount: utxos.length,
    totalInput,
    fee,
    outputAmount,
  }
}
