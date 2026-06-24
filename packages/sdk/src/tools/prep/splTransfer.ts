import {
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import { type AccountMeta, PublicKey } from '@solana/web3.js'

/**
 * Result of {@link buildSplTransfer}: a fully-derived, *unsigned* SPL token
 * transfer instruction plus the deterministically-derived Associated Token
 * Accounts (ATAs) for both the sender and the recipient.
 *
 * This is PURE CRYPTO — no RPC, no signing, no broadcast. The recent blockhash,
 * priority fee, and final signing happen on-device (`vault.sign`). The ATAs are
 * derived via PDA math (`getAssociatedTokenAddressSync`), not read from chain,
 * so this is reproducible offline.
 */
export type SplTransferResult = {
  /** Chain id, always `'Solana'`. */
  chain: 'Solana'
  /** SPL token mint address (base58). */
  mint: string
  /** Owner (sender) wallet address (base58). */
  from: string
  /** Recipient owner wallet address (base58). */
  to: string
  /** Transfer amount in token base units (string to preserve precision). */
  amount: string
  /** Token decimals — required for the on-chain `transferChecked` decimals guard. */
  decimals: number
  /** SPL token program id used (legacy Token Program vs Token-2022). */
  programId: string
  /** Whether the mint uses the Token-2022 program. */
  isToken2022: boolean
  /** Sender's deterministically-derived ATA for this mint (base58). */
  fromTokenAccount: string
  /**
   * Recipient's deterministically-derived ATA for this mint (base58). The
   * recipient ATA may not yet exist on-chain; the on-device signer is
   * responsible for prepending an idempotent create-ATA instruction when
   * needed. We only derive the address here.
   */
  toTokenAccount: string
  /**
   * The unsigned SPL `transferChecked` instruction, serialized to a plain JSON
   * shape (program id + account metas + base64 data). No signatures, no
   * blockhash — those are attached on-device at sign time.
   */
  instruction: {
    programId: string
    keys: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>
    /** base64-encoded instruction data (`transferChecked` discriminator + amount + decimals). */
    data: string
  }
}

export type BuildSplTransferParams = {
  /** SPL token mint address (base58). */
  mint: string
  /** Owner (sender) wallet address (base58). */
  from: string
  /** Recipient owner wallet address (base58). */
  to: string
  /** Transfer amount in token base units. */
  amount: bigint
  /** Token decimals (e.g. 6 for USDC). Validated by the on-chain `transferChecked`. */
  decimals: number
  /**
   * Set `true` when the mint is a Token-2022 mint. Defaults to `false` (legacy
   * Token Program). The ATA derivation and instruction program id both depend
   * on this, so it MUST match the actual mint's owner program.
   *
   * ⚠️ Fund-safety: this is a caller-supplied flag, not auto-detected (the
   * builder does no RPC). If you pass `false` for a Token-2022 mint, the
   * derived ATAs and program id are WRONG (a Token-2022 transfer routed through
   * the legacy program targets a different, likely-uninitialized account →
   * failed tx or, worse, a credit to an unintended account). Resolve this from
   * the mint account's owner program on-chain before calling — do not leave it
   * at the default for an unknown mint.
   */
  isToken2022?: boolean
}

/** SPL token amounts are encoded as a little-endian u64 in the instruction data. */
const U64_MAX = (1n << 64n) - 1n

const isValidSolanaPubkey = (addr: string): boolean => {
  try {
    // PublicKey throws on non-base58 / wrong-length input; on-curve check is
    // intentionally NOT applied (ATAs are off-curve PDAs, owners are on-curve —
    // a plain 32-byte base58 string is the right bar here, mirroring the
    // mcp-ts isValidSolanaAddress guard).

    new PublicKey(addr)
    return true
  } catch {
    return false
  }
}

/**
 * Build an UNSIGNED, ATA-aware Solana SPL token transfer instruction from raw
 * inputs — the SPL escape-hatch sibling to `prepareSendTxFromKeys` (which only
 * covers native SOL).
 *
 * Pure crypto: deterministically derives the sender + recipient ATAs and the
 * `transferChecked` instruction. It NEVER signs and NEVER broadcasts — the
 * returned structure is handed to the on-device signer (`vault.sign`), which
 * attaches the recent blockhash, prepends a create-ATA instruction for the
 * recipient if needed, and produces the signature.
 *
 * Fund-safety guards (ported from mcp-ts `build_spl_transfer_tx`):
 *  - `from`/`to`/`mint` must each be valid 32-byte base58 pubkeys.
 *  - `to !== mint` — sending to the mint account itself credits an ATA owned by
 *    the mint authority (funds lost), so it is rejected explicitly.
 *  - `amount > 0` and `amount <= u64 max` (the on-chain instruction encodes a
 *    little-endian u64, which the SPL layout wraps silently — guarding here
 *    keeps the returned `amount` and the signing bytes in agreement).
 *
 * @example
 * ```ts
 * const tx = buildSplTransfer({
 *   mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
 *   from: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
 *   to: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
 *   amount: 1_000_000n, // 1 USDC (6 decimals)
 *   decimals: 6,
 * })
 * // tx.fromTokenAccount / tx.toTokenAccount are the derived ATAs;
 * // tx.instruction is the unsigned transferChecked instruction.
 * ```
 */
export const buildSplTransfer = (params: BuildSplTransferParams): SplTransferResult => {
  const { mint, from, to, amount, decimals } = params
  const isToken2022 = params.isToken2022 ?? false

  if (!isValidSolanaPubkey(from)) {
    throw new Error(`buildSplTransfer: invalid Solana \`from\` address: ${from}`)
  }
  if (!isValidSolanaPubkey(to)) {
    throw new Error(`buildSplTransfer: invalid Solana \`to\` address: ${to}`)
  }
  if (!isValidSolanaPubkey(mint)) {
    throw new Error(`buildSplTransfer: invalid Solana \`mint\` address: ${mint}`)
  }
  // Fund-safety: a mint IS a valid 32-byte base58 pubkey, so it passes the
  // pubkey check above and isn't on any burn-list. Sending to the mint credits
  // an ATA owned by the mint authority, not the user → funds lost. Reject it.
  if (to === mint) {
    throw new Error(
      `buildSplTransfer: \`to\` is the token mint address (${to}). ` +
        'Send to a wallet address that holds (or will hold) an ATA for this mint — not the mint itself.'
    )
  }
  if (amount <= 0n) {
    throw new Error('buildSplTransfer: amount must be greater than zero')
  }
  // Fund-safety: SPL `transferChecked` writes `amount` as a little-endian u64.
  // `@solana/spl-token` wraps (mod 2^64) silently instead of throwing, so
  // `amount = U64_MAX + 1` would report a huge `amount` string but encode `0`
  // bytes (and `U64_MAX + 1000` would encode `999`) — the returned result and
  // the signing-ready instruction data would disagree. Reject above u64 here so
  // the instruction we hand the on-device signer always matches the reported
  // amount.
  if (amount > U64_MAX) {
    throw new Error(
      `buildSplTransfer: amount ${amount} exceeds the u64 maximum (${U64_MAX}); ` +
        'SPL token amounts must fit in a 64-bit unsigned integer.'
    )
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error(`buildSplTransfer: decimals must be an integer in [0, 255], got ${decimals}`)
  }

  const programId = isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
  const mintPk = new PublicKey(mint)
  const fromPk = new PublicKey(from)
  const toPk = new PublicKey(to)

  // Deterministic ATA derivation — PDA math only, no RPC. `allowOwnerOffCurve`
  // stays false: owners are on-curve wallet addresses, not PDAs.
  const fromTokenAccount = getAssociatedTokenAddressSync(mintPk, fromPk, false, programId)
  const toTokenAccount = getAssociatedTokenAddressSync(mintPk, toPk, false, programId)

  // `transferChecked` carries the mint + decimals so the runtime rejects a
  // decimals mismatch — strictly safer than the bare `transfer`.
  const instruction = createTransferCheckedInstruction(
    fromTokenAccount,
    mintPk,
    toTokenAccount,
    fromPk, // owner / authority — the only signer
    amount,
    decimals,
    [],
    programId
  )

  return {
    chain: 'Solana',
    mint,
    from,
    to,
    amount: amount.toString(),
    decimals,
    programId: programId.toBase58(),
    isToken2022,
    fromTokenAccount: fromTokenAccount.toBase58(),
    toTokenAccount: toTokenAccount.toBase58(),
    instruction: {
      programId: instruction.programId.toBase58(),
      keys: instruction.keys.map((k: AccountMeta) => ({
        pubkey: k.pubkey.toBase58(),
        isSigner: k.isSigner,
        isWritable: k.isWritable,
      })),
      data: Buffer.from(instruction.data).toString('base64'),
    },
  }
}
