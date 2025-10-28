import { NATIVE_MINT, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { address, type Address } from '@solana/web3.js'
import { TW, WalletCore } from '@trustwallet/wallet-core'

import { getSolanaClient } from '@core/chain/chains/solana/client'
import { JUPITER_V6_PROGRAM_ID, RAYDIUM_AMM_PROGRAM_ID } from '../config'
import {
  AddressTableLookup,
  ParsedSolanaTransaction,
  PartialInstruction,
  SolanaToken,
} from '../types'

/**
 * Creates a native SOL token representation
 */
const createNativeSolToken = (): SolanaToken => ({
  address: NATIVE_MINT.toString(),
  name: 'Solana',
  symbol: 'SOL',
  decimals: 9,
  logoURI:
    'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
})

/**
 * Read an unsigned 32-bit little-endian integer from a Buffer
 */
const readU32LE = (buf: Buffer, offset = 0): number => buf.readUInt32LE(offset)

/**
 * Read an unsigned 64-bit little-endian integer from a Buffer
 */
const readU64LE = (buf: Buffer, offset = 0): number =>
  Number(buf.readBigUInt64LE(offset))

/**
 * Resolve Address Lookup Table keys for v0 transactions
 * Fetches the actual addresses from on-chain lookup tables
 *
 * TODO: Currently disabled - waiting for core getSolanaClient() to be updated
 *
 * In web3.js 2.0, the RPC client uses a modular approach. The default client
 * Rpc<SolanaRpcApiForTestClusters> doesn't include all methods like getAddressLookupTable.
 *
 * To fix: Update core/chain/chains/solana/client.ts to explicitly type the client:
 *   export const getSolanaClient = memoize(() => {
 *     return createSolanaRpc<SolanaRpcApi>(solanaRpcUrl)
 *   })
 *
 * This will include the full API. Once core is updated, uncomment the implementation below.
 */
export async function resolveAddressTableKeys(
  lookups: AddressTableLookup[]
): Promise<Address[]> {
  // Temporarily return empty array until core is updated to use full SolanaRpcApi
  // This means v0 transactions with address lookup tables won't parse correctly
  console.warn('Address lookup table resolution temporarily disabled - waiting for core to use full SolanaRpcApi')
  return []

  /* TODO: Uncomment once core getSolanaClient() returns Rpc<SolanaRpcApi>
  const allResolvedKeys: Address[] = [];
  const rpc = getSolanaClient();

  for (const lookup of lookups) {
    try {
      const res = await rpc.getAddressLookupTable(address(lookup.accountKey)).send();

      const lookupTableAccount = res.value;
      if (!lookupTableAccount) {
        continue;
      }

      const table = lookupTableAccount.addresses;

      // v0 ordering: for each lookup, first all writable, then all readonly
      allResolvedKeys.push(
        ...lookup.writableIndexes.map((idx) => table[idx]),
        ...lookup.readonlyIndexes.map((idx) => table[idx])
      );
    } catch (error) {
      console.warn(`Failed to resolve address table ${lookup.accountKey}:`, error);
      continue;
    }
  }

  return allResolvedKeys;
  */
}

/**
 * Build a SolanaToken from a mint address
 * Fetches metadata from Solana network if needed
 */
async function buildToken(mint: string): Promise<SolanaToken> {
  if (mint === NATIVE_MINT.toString()) {
    return createNativeSolToken()
  }

  // For now, return a minimal token representation
  // In a full implementation, you'd fetch token metadata from Jupiter API or on-chain
  return {
    address: mint,
    name: 'Unknown Token',
    symbol: 'UNKNOWN',
    decimals: 9, // Default to 9 decimals
  }
}

/**
 * Parse a Jupiter swap transaction
 * Requires the Jupiter parser to be imported dynamically
 */
async function parseJupiterSwap(
  instructions: PartialInstruction[],
  staticKeys: Address[],
  lookups: AddressTableLookup[]
): Promise<ParsedSolanaTransaction> {
  // Dynamic import to avoid circular dependencies
  const { JupiterInstructionParser } = await import('./jupiter')

  const parser = new JupiterInstructionParser(JUPITER_V6_PROGRAM_ID)
  const { authority, inputMint, outputMint, inAmount, outAmount } =
    await parser.getInstructionParsedData(instructions, staticKeys, lookups)

  return {
    type: 'swap',
    authority,
    inputToken: await buildToken(inputMint),
    outputToken: await buildToken(outputMint),
    inAmount,
    outAmount,
    protocol: 'jupiter',
  }
}

/**
 * Parse a Raydium swap transaction
 * Requires the Raydium parser to be imported dynamically
 */
async function parseRaydiumSwap(
  instructions: PartialInstruction[],
  staticKeys: Address[],
  lookups: AddressTableLookup[]
): Promise<ParsedSolanaTransaction> {
  // Dynamic import to avoid circular dependencies
  const { RaydiumInstructionParser } = await import('./raydium')

  const parser = new RaydiumInstructionParser(RAYDIUM_AMM_PROGRAM_ID)
  const { authority, inputMint, outputMint, inAmount, outAmount } =
    await parser.getInstructionParsedData(instructions, staticKeys, lookups)

  return {
    type: 'swap',
    authority,
    inputToken: await buildToken(inputMint),
    outputToken: await buildToken(outputMint),
    inAmount,
    outAmount,
    protocol: 'raydium',
  }
}

/**
 * Parse an SPL token transfer transaction
 */
async function parseSPLTokenTransfer(
  instructions: PartialInstruction[],
  allKeyStrings: Address[]
): Promise<ParsedSolanaTransaction | null> {
  const rpc = getSolanaClient()

  for (const instruction of instructions) {
    const programIdKey = allKeyStrings[instruction.programId]
    if (programIdKey !== TOKEN_PROGRAM_ID) continue

    // Common SPL Transfer layout: u8 opcode=12; next 8 bytes = amount (LE)
    const raw = Buffer.from(instruction.programData)
    const isTransfer = raw[0] === 12 && raw.length >= 9
    if (!isTransfer) continue

    const mintIndex = instruction.accounts[1]
    const authorityIndex = instruction.accounts[3]
    const receiverATAIndex = instruction.accounts[2]

    const inputMint = allKeyStrings[mintIndex]
    const receiverATA = allKeyStrings[receiverATAIndex]

    try {
      // Get token account info using v2.0 API
      const accountInfo = await rpc
        .getAccountInfo(address(receiverATA), {
          encoding: 'jsonParsed',
        })
        .send()

      if (!accountInfo.value) continue

      const parsed = (accountInfo.value.data as any).parsed
      const receiverAuthority = parsed?.info?.owner ?? ''
      const inAmount = isTransfer ? readU64LE(raw, 1) : 0

      return {
        type: 'transfer',
        authority: allKeyStrings[authorityIndex],
        inputToken: await buildToken(inputMint),
        inAmount,
        receiverAddress: receiverAuthority,
      }
    } catch (error) {
      console.warn('Failed to parse SPL token transfer:', error)
      continue
    }
  }

  return null
}

// System Program ID constant for v2.0
const SYSTEM_PROGRAM_ID = address('11111111111111111111111111111111')

/**
 * Parse a native SOL transfer transaction
 */
function parseNativeSOLTransfer(
  instructions: PartialInstruction[],
  allKeyStrings: Address[]
): ParsedSolanaTransaction | null {
  for (const instruction of instructions) {
    const programIdKey = allKeyStrings[instruction.programId]
    if (programIdKey !== SYSTEM_PROGRAM_ID) continue

    const data = Buffer.from(instruction.programData)
    const opcode = readU32LE(data, 0)

    // SystemInstruction::Transfer (2) or TransferWithSeed (12)
    if (opcode === 2 || opcode === 12) {
      const lamports = readU64LE(data, 4)

      // Accounts:
      // - Transfer: [fromIndex, toIndex]
      // - TransferWithSeed: [fromDerivedIndex, baseIndex, toIndex, baseOwnerIndex]
      const fromIndex = instruction.accounts[0]
      const toIndex =
        opcode === 2 ? instruction.accounts[1] : instruction.accounts[2]

      const from = allKeyStrings[fromIndex]
      const to = allKeyStrings[toIndex]

      return {
        type: 'transfer',
        authority: from,
        inputToken: createNativeSolToken(),
        inAmount: lamports,
        receiverAddress: to,
      }
    }
  }

  return null
}

/**
 * Parse a serialized Solana transaction
 * Supports v0 versioned transactions with Address Lookup Tables
 *
 * @param walletCore - WalletCore instance for transaction decoding
 * @param inputTx - Serialized transaction bytes
 * @returns Parsed transaction with type, tokens, amounts, and addresses
 */
export async function parseSolanaTransaction(
  walletCore: WalletCore,
  inputTx: Uint8Array
): Promise<ParsedSolanaTransaction> {
  // Decode transaction using WalletCore
  const txInputDataArray = Object.values(inputTx)
  const txInputDataBuffer = new Uint8Array(txInputDataArray as any)
  const buffer = Buffer.from(txInputDataBuffer)

  const encodedTx = walletCore.TransactionDecoder.decode(
    walletCore.CoinType.solana,
    buffer
  )

  if (!encodedTx) {
    throw new Error('Failed to decode Solana transaction')
  }

  const decodedTx = TW.Solana.Proto.DecodingTransactionOutput.decode(encodedTx)

  if (!decodedTx.transaction || !decodedTx.transaction.v0) {
    throw new Error('Invalid Solana transaction: missing v0 transaction data')
  }

  const tx = decodedTx.transaction.v0

  // Build complete keyspace for v0 transactions
  const staticKeys = (tx.accountKeys ?? []) as Address[]
  const loadedKeys =
    tx.addressTableLookups && tx.addressTableLookups.length > 0
      ? await resolveAddressTableKeys(
          tx.addressTableLookups as AddressTableLookup[]
        )
      : []

  // Complete keyspace: static first, then loaded
  const allKeys = [...staticKeys, ...loadedKeys]
  const allKeyStrings = allKeys // Already strings in v2.0
  const instructions = tx.instructions as PartialInstruction[]

  // Detect transaction type and parse accordingly

  // 1) Jupiter swap
  if (allKeys.some(k => k === JUPITER_V6_PROGRAM_ID)) {
    return await parseJupiterSwap(
      instructions,
      staticKeys,
      tx.addressTableLookups as AddressTableLookup[]
    )
  }

  // 2) Raydium swap
  if (allKeys.some(k => k === RAYDIUM_AMM_PROGRAM_ID)) {
    return await parseRaydiumSwap(
      instructions,
      staticKeys,
      tx.addressTableLookups as AddressTableLookup[]
    )
  }

  // 3) SPL Token transfer
  if (allKeyStrings.some(k => k === TOKEN_PROGRAM_ID)) {
    const result = await parseSPLTokenTransfer(instructions, allKeyStrings)
    if (result) return result
  }

  // 4) Native SOL transfer
  if (allKeyStrings.some(k => k === SYSTEM_PROGRAM_ID)) {
    const result = parseNativeSOLTransfer(instructions, allKeyStrings)
    if (result) return result
  }

  // 5) Fallback: unknown transaction type
  return {
    type: 'unknown',
    authority: allKeyStrings[0] ?? '',
    inputToken: createNativeSolToken(),
    outputToken: createNativeSolToken(),
    inAmount: 0,
    outAmount: 0,
  }
}
