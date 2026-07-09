import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { AddressLookupTableAccount, PublicKey, VersionedMessage, VersionedTransaction } from '@solana/web3.js'

import { getSolanaClient } from './client'

/** Jupiter v6 aggregator router. Every Jupiter swap routes through this program. */
const JUPITER_V6_PROGRAM_ID = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'
const COMPUTE_BUDGET_PROGRAM_ID = 'ComputeBudget111111111111111111111111111111'
const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111'

/**
 * Programs a legitimate Jupiter swap is expected to invoke as a TOP-LEVEL
 * instruction. Captured empirically (2026-07-09) by fetching real `/swap`
 * responses from Jupiter's public API (`lite-api.jup.ag`) and decoding the
 * returned `VersionedTransaction` across four scenarios:
 *   - a single-hop SOL -> USDC route
 *   - a 3-hop SOL -> BONK route (AlphaQ -> Hadron -> Raydium CLMM)
 *   - a Token-2022 output mint (SOL -> PYUSD)
 *   - a platform-fee-included swap (feeAccount + platformFeeBps set)
 *
 * Every one of them resolved to exactly this program set. `useSharedAccounts`
 * (Jupiter's default) routes the actual AMM legs through the router via CPI,
 * so the individual AMM programs (Raydium, Whirlpool, etc.) never surface as
 * top-level instructions — only the router itself plus the
 * wrapping/bookkeeping instructions (SOL wrap/unwrap, ATA create, compute
 * budget) do. Token-2022 is allow-listed defensively even though it did not
 * surface in any captured fixture (the wSOL leg always uses the legacy Token
 * program): the SDK's own fee-ATA derivation
 * (`packages/core/chain/swap/general/jupiter/api/jupiterFeeAta.ts`)
 * explicitly supports Token-2022 mints, so a route with no wSOL leg could
 * plausibly need it.
 */
export const JUPITER_SWAP_ALLOWED_PROGRAM_IDS: ReadonlySet<string> = new Set([
  JUPITER_V6_PROGRAM_ID,
  COMPUTE_BUDGET_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  TOKEN_PROGRAM_ID.toBase58(),
  TOKEN_2022_PROGRAM_ID.toBase58(),
  ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
])

/**
 * Thrown when a Solana swap message contains a top-level instruction that
 * targets a program outside {@link JUPITER_SWAP_ALLOWED_PROGRAM_IDS}.
 */
export class UnsafeSolanaSwapInstructionError extends Error {
  constructor(
    public readonly instructionIndex: number,
    public readonly programId: string
  ) {
    super(
      `SOL_SWAP_UNEXPECTED_PROGRAM: instruction ${instructionIndex} targets unrecognized program ${programId}; refusing to sign`
    )
    this.name = 'UnsafeSolanaSwapInstructionError'
  }
}

/**
 * Fund-safety guard (audit finding SOL-01, vultisig/vultisig-sdk#1056): a
 * compromised Jupiter proxy could inject an arbitrary instruction (e.g. a
 * drain transfer) into the `VersionedTransaction` returned from `/swap`
 * before it reaches MPC signing. Vultisig's signing UI cannot meaningfully
 * render raw Solana instruction bytes for the user to review, so the
 * transaction would be effectively blind-signed.
 *
 * Asserts every TOP-LEVEL instruction's `programIdIndex` resolves (against
 * static account keys and, for v0 messages, any address-lookup-table-resolved
 * keys) to a program in the allow-list. Does NOT — and cannot, via static
 * inspection alone — see into CPI (a program invoked from inside another
 * instruction); that's exactly what the allow-listed Jupiter router is
 * trusted to CPI into on the user's behalf.
 *
 * Throws {@link UnsafeSolanaSwapInstructionError} on the first unrecognized
 * program or unresolvable account index.
 */
export const assertSafeSolanaSwapInstructions = (
  message: VersionedMessage,
  addressLookupTableAccounts: AddressLookupTableAccount[] = []
): void => {
  const accountKeys =
    message.version === 'legacy' ? message.getAccountKeys() : message.getAccountKeys({ addressLookupTableAccounts })

  message.compiledInstructions.forEach((instruction, index) => {
    const programId: PublicKey | undefined = accountKeys.get(instruction.programIdIndex)
    if (!programId) {
      throw new UnsafeSolanaSwapInstructionError(index, `<unresolved account index ${instruction.programIdIndex}>`)
    }
    const programIdBase58 = programId.toBase58()
    if (!JUPITER_SWAP_ALLOWED_PROGRAM_IDS.has(programIdBase58)) {
      throw new UnsafeSolanaSwapInstructionError(index, programIdBase58)
    }
  })
}

/** Maximum attempts for a LUT fetch before giving up on that table. */
const MAX_LUT_FETCH_ATTEMPTS = 3

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
  console.warn('[assertSafeSolanaSwapInstructions] LUT fetch failed after retries:', errors)
  return null
}

/**
 * Resolve every address-lookup-table referenced by a v0 message. Returns an
 * empty array for legacy messages (which cannot reference LUTs).
 */
export const resolveSolanaAddressLookupTables = async (
  message: VersionedMessage
): Promise<AddressLookupTableAccount[]> => {
  if (message.version !== 0) {
    return []
  }
  const client = getSolanaClient()
  const lutAccounts: AddressLookupTableAccount[] = []
  for (const lut of message.addressTableLookups) {
    const lutAccount = await fetchLutWithRetry(client, lut.accountKey)
    if (lutAccount) {
      lutAccounts.push(lutAccount)
    }
  }
  return lutAccounts
}

/**
 * Convenience wrapper: deserialize a base64-encoded `VersionedTransaction`,
 * resolve any referenced LUTs, and assert its top-level instructions are
 * all allow-listed. See {@link assertSafeSolanaSwapInstructions}.
 */
export const assertSafeSolanaSwapTransactionBase64 = async (txData: string): Promise<void> => {
  const versionedTx = VersionedTransaction.deserialize(Buffer.from(txData, 'base64'))
  const lutAccounts = await resolveSolanaAddressLookupTables(versionedTx.message)
  assertSafeSolanaSwapInstructions(versionedTx.message, lutAccounts)
}
