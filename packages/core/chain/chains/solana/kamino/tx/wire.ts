import { MessageV0, PublicKey, VersionedTransaction } from '@solana/web3.js'

import { getSolanaClient } from '../../client'
import { computeBudgetDiscriminators, kaminoAllowedPrograms, kaminoAttributionMemoTagBytes } from './instructions'

/**
 * Wire-level operations over the v0 transaction Kamino's builder returns:
 * parsing, the two injections (compute budget in front, attribution memo
 * behind), and the blockhash replacement that keeps a built transaction
 * signable after a slow ceremony.
 *
 * Injection appends the program as a new static, read-only, unsigned account
 * key. Static keys are ordered by privilege — writable signers, read-only
 * signers, writable non-signers, read-only non-signers — so the read-only
 * unsigned block is the tail, and appending there plus incrementing
 * `numReadonlyUnsignedAccounts` preserves the ordering without moving any
 * existing key.
 *
 * The one consequence is index drift: indexes at or above the old static
 * count addressed lookup-table-loaded accounts, which now begin one slot
 * later, so each is shifted by one. `programIdIndex` values are untouched — a
 * versioned message may not invoke a program loaded from a lookup table, so
 * every program is already a static key below the insertion point. The
 * indexes *inside* each address-table lookup are positions in the table
 * itself, not in this message, so they are untouched too.
 */

/** A failure to parse or edit the wire bytes. */
export class KaminoWireError extends Error {
  constructor(detail: string) {
    super(`Kamino wire transaction: ${detail}`)
    this.name = 'KaminoWireError'
  }
}

/**
 * Parses the base64 transaction the build endpoints return. `undefined` for
 * bytes that are not a v0 versioned transaction — a legacy message invoking
 * the kVaults program must be surfaced as unreadable, never edited or
 * described.
 */
export const parseKaminoWireTransaction = (base64Transaction: string): VersionedTransaction | undefined => {
  try {
    const transaction = VersionedTransaction.deserialize(Buffer.from(base64Transaction, 'base64'))
    return transaction.version === 0 ? transaction : undefined
  } catch {
    return undefined
  }
}

/** Serializes back to the base64 form the keysign payload carries. */
export const serializeKaminoWireTransaction = (transaction: VersionedTransaction): string =>
  Buffer.from(transaction.serialize()).toString('base64')

/**
 * Whether this is the shape the app is willing to sign: one required
 * signature, no read-only signers, every signature slot still an empty
 * placeholder, and — when `feePayer` is given — that account in slot 0.
 */
export const isUnsignedSingleSigner = (transaction: VersionedTransaction, feePayer?: string): boolean => {
  const { header, staticAccountKeys } = transaction.message
  if (header.numRequiredSignatures !== 1 || header.numReadonlySignedAccounts !== 0) return false
  if (transaction.signatures.length !== 1) return false
  if (transaction.signatures.some(signature => signature.some(byte => byte !== 0))) return false
  if (feePayer !== undefined && staticAccountKeys[0]?.toBase58() !== feePayer) return false
  return true
}

/** The number of accounts the message addresses, static and lookup-loaded. */
export const totalKaminoAccountCount = (transaction: VersionedTransaction): number =>
  transaction.message.staticAccountKeys.length +
  transaction.message.addressTableLookups.reduce(
    (count, lookup) => count + lookup.writableIndexes.length + lookup.readonlyIndexes.length,
    0
  )

/**
 * Every account the message addresses, in runtime index order: static keys,
 * then every table's writable loads, then every table's read-only loads.
 * `undefined` when a table is missing from `lookupTables` or an index falls
 * outside it — resolution either accounts for every index or fails whole.
 */
export const resolveKaminoAccountAddresses = ({
  transaction,
  lookupTables,
}: {
  transaction: VersionedTransaction
  /** Table address to that table's full address list. */
  lookupTables: Record<string, string[]>
}): string[] | undefined => {
  const resolved = transaction.message.staticAccountKeys.map(key => key.toBase58())

  const load = (tableAddress: string, indexes: readonly number[]): string[] | undefined => {
    const table = lookupTables[tableAddress]
    if (!table) return undefined
    const addresses: string[] = []
    for (const index of indexes) {
      const address = table[index]
      if (address === undefined) return undefined
      addresses.push(address)
    }
    return addresses
  }

  for (const kind of ['writableIndexes', 'readonlyIndexes'] as const) {
    for (const lookup of transaction.message.addressTableLookups) {
      const addresses = load(lookup.accountKey.toBase58(), lookup[kind])
      if (!addresses) return undefined
      resolved.push(...addresses)
    }
  }
  return resolved
}

/**
 * Whether the account at a runtime index may be written to, from the header
 * privileges (static region) or the lookup section it was loaded through.
 */
export const isKaminoAccountWritable = ({
  transaction,
  index,
}: {
  transaction: VersionedTransaction
  index: number
}): boolean => {
  const { header, staticAccountKeys, addressTableLookups } = transaction.message
  const staticCount = staticAccountKeys.length

  if (index < staticCount) {
    const writableSigners = header.numRequiredSignatures - header.numReadonlySignedAccounts
    if (index < writableSigners) return true
    if (index < header.numRequiredSignatures) return false
    return index < staticCount - header.numReadonlyUnsignedAccounts
  }

  const writableLoads = addressTableLookups.reduce((count, lookup) => count + lookup.writableIndexes.length, 0)
  return index < staticCount + writableLoads
}

/**
 * Deadline for one lookup-table read. This sits on the signing critical path
 * and the RPC client itself carries no timeout, so an unbounded call would
 * let a stalled node wedge the prepare indefinitely. Matches the HTTP layer's
 * default deadline — comfortably above a healthy read, still bounding a hang.
 */
const lookupTableReadTimeoutMs = 20_000

/**
 * The contents of every lookup table the transaction reads from, via RPC.
 *
 * Every failure surfaces as `KaminoWireError` — a missing table, a stalled
 * node past the deadline, or a transport error — so callers see one rejection
 * type from resolution rather than raw RPC errors.
 */
export const resolveKaminoLookupTables = async (
  transaction: VersionedTransaction
): Promise<Record<string, string[]>> => {
  const client = getSolanaClient()
  const tables: Record<string, string[]> = {}
  for (const lookup of transaction.message.addressTableLookups) {
    const address = lookup.accountKey.toBase58()
    if (tables[address]) continue

    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () =>
          reject(
            new KaminoWireError(`address lookup table ${address} read timed out after ${lookupTableReadTimeoutMs}ms`)
          ),
        lookupTableReadTimeoutMs
      )
    })
    try {
      const table = await Promise.race([client.getAddressLookupTable(lookup.accountKey), deadline])
      if (!table.value) throw new KaminoWireError(`address lookup table ${address} not found`)
      tables[address] = table.value.state.addresses.map(key => key.toBase58())
    } catch (error) {
      if (error instanceof KaminoWireError) throw error
      throw new KaminoWireError(`address lookup table ${address} could not be read: ${extractErrorMessage(error)}`)
    } finally {
      clearTimeout(timeoutId)
    }
  }
  return tables
}

const extractErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

type CompiledInstruction = {
  programIdIndex: number
  accountKeyIndexes: number[]
  data: Uint8Array
}

/**
 * Appends `programKey` as a new static, read-only, unsigned account key and
 * rebuilds the message with `leading` instructions in front of the existing
 * ones and `trailing` behind them. Both callbacks receive the index the new
 * key lands at. See the module doc for why lookup-region indexes shift.
 */
const injectProgram = (
  transaction: VersionedTransaction,
  programKey: string,
  leading: (programIdIndex: number) => CompiledInstruction[],
  trailing: (programIdIndex: number) => CompiledInstruction[]
): VersionedTransaction => {
  const message = transaction.message
  const staticCount = message.staticAccountKeys.length
  const shift = (index: number): number => (index >= staticCount ? index + 1 : index)

  const shifted = message.compiledInstructions.map(instruction => ({
    programIdIndex: instruction.programIdIndex,
    accountKeyIndexes: instruction.accountKeyIndexes.map(shift),
    data: instruction.data,
  }))

  const injected = new MessageV0({
    header: {
      numRequiredSignatures: message.header.numRequiredSignatures,
      numReadonlySignedAccounts: message.header.numReadonlySignedAccounts,
      numReadonlyUnsignedAccounts: message.header.numReadonlyUnsignedAccounts + 1,
    },
    staticAccountKeys: [...message.staticAccountKeys, new PublicKey(programKey)],
    recentBlockhash: message.recentBlockhash,
    compiledInstructions: [...leading(staticCount), ...shifted, ...trailing(staticCount)],
    addressTableLookups: message.addressTableLookups,
  })
  return new VersionedTransaction(injected)
}

const invokesProgram = (transaction: VersionedTransaction, programKey: string): boolean => {
  const keys = transaction.message.staticAccountKeys.map(key => key.toBase58())
  return transaction.message.compiledInstructions.some(instruction => keys[instruction.programIdIndex] === programKey)
}

const hasStaticKey = (transaction: VersionedTransaction, key: string): boolean =>
  transaction.message.staticAccountKeys.some(existing => existing.toBase58() === key)

const u32LittleEndian = (value: number): Uint8Array => {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value, true)
  return bytes
}

const u64LittleEndian = (value: bigint): Uint8Array => {
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setBigUint64(0, value, true)
  return bytes
}

/**
 * Injects the app's ComputeBudget pair in front of the existing instructions.
 *
 * Kamino's builder emits no ComputeBudget instruction, so a transaction that
 * already carries the program — as a key or as an instruction — is not one
 * this app built the fee for, and appending a second pair would double-charge
 * rather than repair it.
 */
export const injectKaminoComputeBudget = ({
  transaction,
  unitLimit,
  unitPriceMicroLamports,
}: {
  transaction: VersionedTransaction
  unitLimit: number
  unitPriceMicroLamports: bigint
}): VersionedTransaction => {
  const program = kaminoAllowedPrograms.computeBudget
  if (hasStaticKey(transaction, program) || invokesProgram(transaction, program)) {
    throw new KaminoWireError('compute budget already present')
  }
  return injectProgram(
    transaction,
    program,
    programIdIndex => [
      {
        programIdIndex,
        accountKeyIndexes: [],
        data: Uint8Array.from([computeBudgetDiscriminators.setUnitLimit, ...u32LittleEndian(unitLimit)]),
      },
      {
        programIdIndex,
        accountKeyIndexes: [],
        data: Uint8Array.from([computeBudgetDiscriminators.setUnitPrice, ...u64LittleEndian(unitPriceMicroLamports)]),
      },
    ],
    () => []
  )
}

/**
 * Appends the attribution memo behind every existing instruction: one SPL
 * Memo instruction carrying exactly the tag, no accounts.
 *
 * The key and the instruction are two ways for a memo to already be here, and
 * appending a second one would both duplicate the account and leave the
 * transaction carrying two attributions — so either form is a refusal.
 */
export const injectKaminoAttributionMemo = (transaction: VersionedTransaction): VersionedTransaction => {
  const program = kaminoAllowedPrograms.memo
  if (hasStaticKey(transaction, program) || invokesProgram(transaction, program)) {
    throw new KaminoWireError('attribution memo already present')
  }
  return injectProgram(
    transaction,
    program,
    () => [],
    programIdIndex => [
      {
        programIdIndex,
        accountKeyIndexes: [],
        data: kaminoAttributionMemoTagBytes,
      },
    ]
  )
}

/**
 * The same transaction over a new recent blockhash.
 *
 * The build endpoints embed a blockhash worth ~60–90 seconds, and an MPC
 * ceremony can outlive it — so the blockhash is replaced immediately before
 * keysign rather than trusted to survive the wait. Nothing else in the
 * message changes.
 */
export const withKaminoRecentBlockhash = ({
  transaction,
  recentBlockhash,
}: {
  transaction: VersionedTransaction
  recentBlockhash: string
}): VersionedTransaction => {
  const message = transaction.message
  return new VersionedTransaction(
    new MessageV0({
      header: message.header,
      staticAccountKeys: message.staticAccountKeys,
      recentBlockhash,
      compiledInstructions: message.compiledInstructions,
      addressTableLookups: message.addressTableLookups,
    })
  )
}

/** Fetches the current blockhash and stamps it onto the transaction. */
export const refreshKaminoRecentBlockhash = async (
  transaction: VersionedTransaction
): Promise<VersionedTransaction> => {
  const { blockhash } = await getSolanaClient().getLatestBlockhash()
  return withKaminoRecentBlockhash({ transaction, recentBlockhash: blockhash })
}
