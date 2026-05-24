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
async function fetchLutWithRetry(
  client: ReturnType<typeof getSolanaClient>,
  accountKey: PublicKey
): Promise<AddressLookupTableAccount | null> {
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
  // All attempts failed — log every error so transient (RPC timeout) vs
  // permanent ('account not found') failures are distinguishable in logs.
  console.warn('[injectSolanaAtaIfMissing] LUT fetch failed after retries:', errors)
  return null
}

export type InjectSolanaAtaResult = {
  /** Possibly-modified base64-encoded VersionedTransaction. */
  data: string
  /** Whether a createAssociatedTokenAccount instruction was injected. */
  ataInjected: boolean
}

/**
 * Checks whether the destination SPL-token ATA exists and, if not, prepends a
 * `createAssociatedTokenAccountIdempotentInstruction` to the LiFi transaction.
 *
 * The idempotent variant is safe: it succeeds whether or not the ATA already
 * exists at broadcast time (useful when the RPC snapshot is stale).
 *
 * Token-2022 compatibility: the mint account's owner program is resolved at
 * runtime so the correct token program (Token or Token-2022) is used for ATA
 * derivation and instruction creation.
 *
 * @param txData       Base64-encoded serialized VersionedTransaction from LiFi.
 * @param mintAddress  SPL token mint address (e.g. USDC mint on Solana).
 * @param owner        Wallet address that will own the ATA (swap destination).
 * @param payer        Wallet address paying for ATA creation (swap sender).
 * @returns            Modified transaction data + whether an ATA was injected.
 */
export const injectSolanaAtaIfMissing = async (
  txData: string,
  mintAddress: string,
  owner: string,
  payer: string
): Promise<InjectSolanaAtaResult> => {
  const mintPubkey = new PublicKey(mintAddress)
  const ownerPubkey = new PublicKey(owner)
  const payerPubkey = new PublicKey(payer)

  const client = getSolanaClient()

  // Resolve token program from mint account owner (Token vs Token-2022).
  // Failing to resolve the mint (RPC timeout, bad address, closed account) must
  // throw rather than fall back to TOKEN_PROGRAM_ID — a silent fallback would
  // derive the wrong ATA and produce an opaque simulation failure.
  const mintInfo = await client.getAccountInfo(mintPubkey)
  if (!mintInfo) {
    throw new Error(`Mint account ${mintAddress} not found — cannot determine Token vs Token-2022 program`)
  }
  const tokenProgramId = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID

  // allowOwnerOffCurve=true: PDAs are valid ATA owners (e.g. multisig destinations).
  const ataAddress = getAssociatedTokenAddressSync(
    mintPubkey,
    ownerPubkey,
    /* allowOwnerOffCurve */ true,
    tokenProgramId
  )

  const ataInfo = await client.getAccountInfo(ataAddress)

  // ATA already exists — return the original tx data unchanged.
  if (ataInfo !== null) {
    return { data: txData, ataInjected: false }
  }

  // Deserialize the LiFi VersionedTransaction (base64-encoded).
  const txBytes = Buffer.from(txData, 'base64')
  const versionedTx = VersionedTransaction.deserialize(txBytes)

  // Fetch any address lookup tables referenced by the message so we can
  // correctly decompile the V0 message into individual instructions.
  const lutAccounts: AddressLookupTableAccount[] = []
  if (versionedTx.message.version === 0) {
    const lookups = (versionedTx.message as { addressTableLookups: { accountKey: PublicKey }[] }).addressTableLookups
    for (const lut of lookups) {
      const lutAccount = await fetchLutWithRetry(client, lut.accountKey)
      if (lutAccount) {
        lutAccounts.push(lutAccount)
      }
    }
  }

  // Legacy (pre-V0) transactions are implicitly upgraded to V0 here: decompile
  // accepts both legacy and V0 messages, and compileToV0Message always produces
  // a V0 message. LiFi does not send legacy Solana transactions in practice but
  // the path is safe regardless.
  const decompiledMessage = TransactionMessage.decompile(versionedTx.message, {
    addressLookupTableAccounts: lutAccounts,
  })

  const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
    payerPubkey,
    ataAddress,
    ownerPubkey,
    mintPubkey,
    tokenProgramId
  )

  // Prepend the ATA creation instruction so it runs before the swap.
  const updatedMessage = new TransactionMessage({
    payerKey: decompiledMessage.payerKey,
    recentBlockhash: decompiledMessage.recentBlockhash,
    instructions: [createAtaIx, ...decompiledMessage.instructions],
  }).compileToV0Message(lutAccounts.length > 0 ? lutAccounts : undefined)

  const updatedTx = new VersionedTransaction(updatedMessage)
  // NOTE: do NOT copy versionedTx.signatures here. After compileToV0Message the
  // message bytes changed; any signature committed to the old bytes would be
  // invalid. LiFi does not pre-sign Solana quotes so signatures are empty anyway.

  return { data: Buffer.from(updatedTx.serialize()).toString('base64'), ataInjected: true }
}
