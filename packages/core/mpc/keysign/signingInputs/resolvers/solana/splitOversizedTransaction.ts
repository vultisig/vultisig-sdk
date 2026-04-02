import {
  getRandomTipAccount,
  getRecommendedTipLamportsSync,
} from '@vultisig/core-chain/chains/solana/jito'
import { TW } from '@trustwallet/wallet-core'

/**
 * Solana's maximum serialized transaction size in bytes.
 * Transactions exceeding this must be split into a JITO bundle.
 */
const SOLANA_MAX_TX_SIZE = 1232

/**
 * Check if a decoded Solana transaction's instruction set would produce
 * an oversized serialized transaction. We use a conservative heuristic:
 * if the base64 source data exceeds the limit, the transaction is oversized.
 */
export function isTransactionOversized(base64Data: string): boolean {
  const bytes = Buffer.from(base64Data, 'base64')
  return bytes.length > SOLANA_MAX_TX_SIZE
}

/**
 * Split an oversized Solana swap transaction's decoded RawMessage into
 * two signing inputs. The second group includes a JITO tip instruction
 * so the bundle gets picked up by validators.
 *
 * Returns the original single-element array if the transaction fits
 * within the size limit.
 */
export function maybeSplitOversizedSolanaSwap(
  transaction: TW.Solana.Proto.IRawMessage,
  recentBlockHash: string,
  base64Data: string,
  signerAddress: string,
): TW.Solana.Proto.SigningInput[] {
  if (!isTransactionOversized(base64Data)) {
    // Not oversized — return single signing input as-is
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

  // Transaction is oversized — split instructions into two groups
  const message = transaction.v0 ?? transaction.legacy
  if (!message?.instructions?.length) {
    throw new Error('Cannot split transaction: no instructions found')
  }

  const allInstructions = message.instructions
  const accountKeys = [...(message.accountKeys ?? [])]
  const header = message.header
  const addressTableLookups =
    transaction.v0?.addressTableLookups ?? []

  // Split instructions roughly in half
  const midpoint = Math.ceil(allInstructions.length / 2)
  const group1Instructions = allInstructions.slice(0, midpoint)
  const group2Instructions = allInstructions.slice(midpoint)

  // Build JITO tip instruction to add to the second group.
  // Uses cached tip floor if available, otherwise a conservative default.
  const tipLamports = getRecommendedTipLamportsSync()
  const tipAccount = getRandomTipAccount()
  const tipInstruction = buildProtoTipInstruction(
    signerAddress,
    tipAccount.toBase58(),
    tipLamports,
    accountKeys,
  )

  const group2WithTip = [...group2Instructions, tipInstruction]

  // Build two signing inputs
  const signingInput1 = buildSigningInputFromInstructions(
    group1Instructions,
    accountKeys,
    header,
    addressTableLookups,
    recentBlockHash,
  )

  const signingInput2 = buildSigningInputFromInstructions(
    group2WithTip,
    accountKeys,
    header,
    addressTableLookups,
    recentBlockHash,
  )

  return [signingInput1, signingInput2]
}

/**
 * Build a JITO tip instruction in TrustWallet proto format.
 * This is a SystemProgram.transfer to a JITO tip account.
 */
function buildProtoTipInstruction(
  fromAddress: string,
  tipAddress: string,
  lamports: number,
  existingAccountKeys: string[],
): TW.Solana.Proto.RawMessage.IInstruction {
  const systemProgramId = '11111111111111111111111111111111'

  // Find or add account indices
  const accounts = [...existingAccountKeys]

  const findOrAddIndex = (key: string): number => {
    let idx = accounts.indexOf(key)
    if (idx === -1) {
      idx = accounts.length
      accounts.push(key)
    }
    return idx
  }

  const programIdIndex = findOrAddIndex(systemProgramId)
  const fromIndex = findOrAddIndex(fromAddress)
  const tipIndex = findOrAddIndex(tipAddress)

  // SystemProgram.transfer instruction data: [2, 0, 0, 0] + lamports as u64 LE
  const data = new Uint8Array(12)
  data[0] = 2 // Transfer instruction discriminator
  const view = new DataView(data.buffer)
  // Write lamports as u64 little-endian (split into two u32)
  view.setUint32(4, lamports & 0xffffffff, true)
  view.setUint32(8, Math.floor(lamports / 0x100000000), true)

  return {
    programId: programIdIndex,
    accounts: [fromIndex, tipIndex],
    programData: data,
  }
}

/**
 * Build a TW.Solana.Proto.SigningInput from a subset of instructions,
 * reusing the original transaction's account keys and ALT lookups.
 */
function buildSigningInputFromInstructions(
  instructions: TW.Solana.Proto.RawMessage.IInstruction[],
  accountKeys: string[],
  header: TW.Solana.Proto.RawMessage.IMessageHeader | null | undefined,
  addressTableLookups: TW.Solana.Proto.RawMessage.IMessageAddressTableLookup[],
  recentBlockHash: string,
): TW.Solana.Proto.SigningInput {
  const rawMessage = TW.Solana.Proto.RawMessage.create({
    v0: TW.Solana.Proto.RawMessage.MessageV0.create({
      header: header
        ? TW.Solana.Proto.RawMessage.MessageHeader.create(header)
        : undefined,
      accountKeys,
      recentBlockhash: recentBlockHash,
      instructions,
      addressTableLookups: addressTableLookups.map(lookup =>
        TW.Solana.Proto.RawMessage.MessageAddressTableLookup.create(lookup)
      ),
    }),
  })

  return TW.Solana.Proto.SigningInput.create({
    v0Msg: true,
    recentBlockhash: recentBlockHash,
    rawMessage,
  })
}
