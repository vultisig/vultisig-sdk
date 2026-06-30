import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import { AddressLookupTableAccount, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { getSolanaClient } from '@vultisig/core-chain/chains/solana/client'

/** Maximum attempts for LUT fetches before giving up. */
const MAX_LUT_FETCH_ATTEMPTS = 3

/**
 * Fetch a LUT account with simple retry (exponential back-off, up to 3 attempts).
 * RPC timeouts are transient; retrying avoids spurious quote failures.
 */
const fetchLutWithRetry = async (
  client: ReturnType<typeof getSolanaClient>,
  accountKey: PublicKey
): Promise<AddressLookupTableAccount | null> => {
  const errors: unknown[] = []
  for (let attempt = 0; attempt < MAX_LUT_FETCH_ATTEMPTS; attempt++) {
    try {
      const result = await client.getAddressLookupTable(accountKey)
      return result.value ?? null
    } catch (err) {
      errors.push(err)
      if (attempt < MAX_LUT_FETCH_ATTEMPTS - 1) {
        await new Promise(resolve => setTimeout(resolve, 200 * 2 ** attempt))
      }
    }
  }
  console.warn('[jupiterFeeAta] LUT fetch failed after retries:', errors)
  return null
}

/**
 * Resolve the SPL token program (Token vs Token-2022) that owns a mint.
 *
 * Failing to resolve the mint (RPC timeout, bad address, closed account) must
 * throw rather than fall back to TOKEN_PROGRAM_ID — a silent fallback would
 * derive the wrong ATA and produce an opaque simulation failure downstream.
 */
const resolveTokenProgramId = async (mintPubkey: PublicKey): Promise<PublicKey> => {
  const client = getSolanaClient()
  const mintInfo = await client.getAccountInfo(mintPubkey)
  if (!mintInfo) {
    throw new Error(`Mint account ${mintPubkey.toBase58()} not found - cannot determine Token vs Token-2022 program`)
  }
  if (mintInfo.owner.equals(TOKEN_PROGRAM_ID)) {
    return TOKEN_PROGRAM_ID
  }
  if (mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    return TOKEN_2022_PROGRAM_ID
  }
  throw new Error(
    `Mint ${mintPubkey.toBase58()} is owned by unsupported program ${mintInfo.owner.toBase58()} - expected Token or Token-2022`
  )
}

export type JupiterFeeAccount = {
  /** Base58 ATA address Jupiter must credit the platform fee to. */
  feeAccount: string
  /** Token program (Token vs Token-2022) that owns the fee-mint. */
  tokenProgramId: PublicKey
  mintPubkey: PublicKey
  ownerPubkey: PublicKey
}

/**
 * Derive the Jupiter platform-fee Associated Token Account for `(owner =
 * feeOwner, mint = outputMint)`. Jupiter charges the affiliate fee in the
 * OUTPUT mint (the only mint allowed for an ExactIn swap besides the input),
 * so the fee mint is always the swap's output mint.
 *
 * The token program is resolved from the mint owner so Token-2022 mints derive
 * the correct ATA. This must be called BEFORE the `/swap` request so the
 * derived `feeAccount` can be passed to Jupiter.
 */
export const deriveJupiterFeeAccount = async ({
  outputMint,
  feeOwner,
}: {
  outputMint: string
  feeOwner: string
}): Promise<JupiterFeeAccount> => {
  const mintPubkey = new PublicKey(outputMint)
  const ownerPubkey = new PublicKey(feeOwner)
  const tokenProgramId = await resolveTokenProgramId(mintPubkey)

  const feeAccount = getAssociatedTokenAddressSync(
    mintPubkey,
    ownerPubkey,
    /* allowOwnerOffCurve */ false,
    tokenProgramId
  ).toBase58()

  return { feeAccount, tokenProgramId, mintPubkey, ownerPubkey }
}

/**
 * Prepend an idempotent `createAssociatedTokenAccount` instruction for the
 * Jupiter fee ATA to the serialized swap transaction.
 *
 * Jupiter's `/swap` endpoint auto-creates the *user's* output ATA but treats
 * the `feeAccount` as a precondition it never initializes — so we must prepend
 * our own create instruction. The idempotent variant is a no-op (no rent
 * charged) when the ATA already exists, making this safe to run on every swap
 * without an existence probe.
 *
 * Rent (~0.002 SOL, the first time per fee mint) is paid by the tx fee-payer
 * (the user), matching the existing LiFi Solana ATA-injection behaviour.
 *
 * `recentBlockhash` is preserved verbatim from Jupiter's quote. The consumer's
 * keysign path refreshes the blockhash before broadcast (same as every other
 * Solana general-swap route), so we do not refresh it here.
 */
export const prependJupiterFeeAta = async ({
  txData,
  feeAccount,
  mintPubkey,
  ownerPubkey,
  tokenProgramId,
}: {
  txData: string
  feeAccount: string
  mintPubkey: PublicKey
  ownerPubkey: PublicKey
  tokenProgramId: PublicKey
}): Promise<string> => {
  const client = getSolanaClient()

  const versionedTx = VersionedTransaction.deserialize(Buffer.from(txData, 'base64'))

  const lutAccounts: AddressLookupTableAccount[] = []
  if (versionedTx.message.version === 0) {
    const lookups = (
      versionedTx.message as {
        addressTableLookups: { accountKey: PublicKey }[]
      }
    ).addressTableLookups
    for (const lut of lookups) {
      const lutAccount = await fetchLutWithRetry(client, lut.accountKey)
      if (lutAccount) {
        lutAccounts.push(lutAccount)
      }
    }
  }

  let decompiledMessage: TransactionMessage
  try {
    decompiledMessage = TransactionMessage.decompile(versionedTx.message, {
      addressLookupTableAccounts: lutAccounts,
    })
  } catch (err) {
    throw new Error(
      `Failed to decompile Jupiter transaction message - one or more LUT accounts could not be resolved (fetched ${lutAccounts.length} of ${(versionedTx.message as { addressTableLookups?: unknown[] }).addressTableLookups?.length ?? 0} referenced LUTs). Original error: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  const createFeeAtaIx = createAssociatedTokenAccountIdempotentInstruction(
    decompiledMessage.payerKey,
    new PublicKey(feeAccount),
    ownerPubkey,
    mintPubkey,
    tokenProgramId
  )

  const updatedMessage = new TransactionMessage({
    payerKey: decompiledMessage.payerKey,
    recentBlockhash: decompiledMessage.recentBlockhash,
    instructions: [createFeeAtaIx, ...decompiledMessage.instructions],
  }).compileToV0Message(lutAccounts.length > 0 ? lutAccounts : undefined)

  // Do NOT copy versionedTx.signatures: the message bytes changed, so any
  // signature over the old bytes is invalid. Jupiter does not pre-sign quotes.
  return Buffer.from(new VersionedTransaction(updatedMessage).serialize()).toString('base64')
}
