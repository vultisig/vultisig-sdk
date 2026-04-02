import { TW } from '@trustwallet/wallet-core'

/**
 * Solana's maximum serialized transaction size in bytes.
 */
const SOLANA_MAX_TX_SIZE = 1232

/**
 * Handle potentially oversized Solana swap transactions.
 *
 * If the transaction exceeds Solana's 1232-byte limit, logs a warning.
 * Instruction-level splitting into JITO bundles requires rebuilding
 * Solana message headers and account orderings at the proto level, which
 * is fragile. A proper implementation should use @solana/web3.js
 * TransactionInstruction objects (as in shapeshift/web#12136).
 *
 * For now, returns the transaction as a single signing input regardless
 * of size — the broadcast layer's JITO sendTransaction provides MEV
 * protection, and oversized transactions will fail at the RPC level with
 * a clear error rather than producing corrupt split transactions.
 *
 * TODO: Implement proper instruction-level splitting using @solana/web3.js
 * when the swap provider (LiFi/recipes) returns individual instructions
 * alongside the serialized transaction.
 */
export function maybeSplitOversizedSolanaSwap(
  transaction: TW.Solana.Proto.IRawMessage,
  recentBlockHash: string,
  base64Data: string,
  _signerAddress: string,
): TW.Solana.Proto.SigningInput[] {
  if (Buffer.from(base64Data, 'base64').length > SOLANA_MAX_TX_SIZE) {
    console.warn(
      `[Solana] Transaction exceeds ${SOLANA_MAX_TX_SIZE}-byte limit. ` +
      'Attempting broadcast as-is — may fail if too large for a single transaction.'
    )
  }

  if (transaction.legacy) {
    transaction.legacy.recentBlockhash = recentBlockHash
  } else if (transaction.v0) {
    transaction.v0.recentBlockhash = recentBlockHash
  }

  return [
    TW.Solana.Proto.SigningInput.create({
      v0Msg: true,
      recentBlockhash: recentBlockHash,
      rawMessage: transaction,
    }),
  ]
}
