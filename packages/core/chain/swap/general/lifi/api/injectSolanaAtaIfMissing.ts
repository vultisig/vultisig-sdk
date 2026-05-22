import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token'
import { AddressLookupTableAccount, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { getSolanaClient } from '@vultisig/core-chain/chains/solana/client'

/**
 * Checks whether the destination SPL-token ATA exists and, if not, prepends a
 * `createAssociatedTokenAccountIdempotentInstruction` to the LiFi transaction.
 *
 * The idempotent variant is safe: it succeeds whether or not the ATA already
 * exists at broadcast time (useful when the RPC snapshot is stale).
 *
 * @param txData   Base64-encoded serialized VersionedTransaction from LiFi.
 * @param mintAddress  SPL token mint address (e.g. USDC mint on Solana).
 * @param owner    Wallet address that will own the ATA (the swap destination).
 * @param payer    Wallet address paying for the ATA creation (the swap sender).
 * @returns        Possibly-modified base64-encoded transaction.
 */
export const injectSolanaAtaIfMissing = async (
  txData: string,
  mintAddress: string,
  owner: string,
  payer: string
): Promise<string> => {
  const mintPubkey = new PublicKey(mintAddress)
  const ownerPubkey = new PublicKey(owner)
  const payerPubkey = new PublicKey(payer)

  const ataAddress = getAssociatedTokenAddressSync(mintPubkey, ownerPubkey, /* allowOwnerOffCurve */ false)

  const client = getSolanaClient()
  const ataInfo = await client.getAccountInfo(ataAddress)

  // ATA already exists — return the original tx data unchanged.
  if (ataInfo !== null) {
    return txData
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
      const lutInfo = await client.getAddressLookupTable(lut.accountKey)
      if (lutInfo.value) {
        lutAccounts.push(lutInfo.value)
      }
    }
  }

  const decompiledMessage = TransactionMessage.decompile(versionedTx.message, {
    addressLookupTableAccounts: lutAccounts,
  })

  const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
    payerPubkey,
    ataAddress,
    ownerPubkey,
    mintPubkey
  )

  // Prepend the ATA creation instruction so it runs before the swap.
  const updatedMessage = new TransactionMessage({
    payerKey: decompiledMessage.payerKey,
    recentBlockhash: decompiledMessage.recentBlockhash,
    instructions: [createAtaIx, ...decompiledMessage.instructions],
  }).compileToV0Message(lutAccounts.length > 0 ? lutAccounts : undefined)

  const updatedTx = new VersionedTransaction(updatedMessage)

  // Copy over any existing signatures (fee-payer partial sigs from LiFi, if any).
  updatedTx.signatures = versionedTx.signatures

  return Buffer.from(updatedTx.serialize()).toString('base64')
}
