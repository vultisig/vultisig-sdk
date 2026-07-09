import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import {
  AddressLookupTableAccount,
  MessageCompiledInstruction,
  PublicKey,
  VersionedMessage,
  VersionedTransaction,
} from '@solana/web3.js'

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

/** Programs that can move funds — require destination/authority validation beyond a program-only check. */
const FUND_MOVING_PROGRAM_IDS = new Set([
  SYSTEM_PROGRAM_ID,
  TOKEN_PROGRAM_ID.toBase58(),
  TOKEN_2022_PROGRAM_ID.toBase58(),
])

// SystemProgram instruction type discriminants (LE uint32 at data[0..4])
const SYSTEM_TRANSFER = 2

// Token/Token-2022 instruction discriminants (uint8 at data[0])
const TOKEN_TRANSFER = 3
const TOKEN_APPROVE = 4
const TOKEN_SET_AUTHORITY = 6
const TOKEN_CLOSE_ACCOUNT = 9
const TOKEN_TRANSFER_CHECKED = 12
const TOKEN_APPROVE_CHECKED = 13

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
 * Thrown when a fund-moving instruction (System/Token) in a swap message has
 * a destination or authority that does not belong to the user.
 *
 * Audit finding SOL-01 residual: a program-only allow-list permits injected
 * top-level `SystemProgram.Transfer { from: user, to: attacker }` or
 * `Token.Approve { owner: user, delegate: attacker }` because those programs
 * are allow-listed (needed for SOL wrap/unwrap). This error is thrown when the
 * decoded instruction accounts don't match the user's controlled addresses.
 */
export class UnsafeSolanaSwapFundMovementError extends Error {
  constructor(
    public readonly instructionIndex: number,
    public readonly reason: string
  ) {
    super(`SOL_SWAP_UNSAFE_FUND_MOVEMENT: instruction ${instructionIndex} — ${reason}`)
    this.name = 'UnsafeSolanaSwapFundMovementError'
  }
}

type AccountKeys = ReturnType<VersionedMessage['getAccountKeys']>

const assertSystemInstruction = (
  ix: MessageCompiledInstruction,
  keys: AccountKeys,
  userWallet: PublicKey,
  index: number
): void => {
  if (ix.data.length < 4) return
  const type = new DataView(ix.data.buffer, ix.data.byteOffset, 4).getUint32(0, /* littleEndian */ true)
  if (type !== SYSTEM_TRANSFER) return

  // Transfer accounts[1] = destination. The only legitimate SOL transfer in
  // a Jupiter swap is wrapping: from: userWallet → to: userWallet's wSOL ATA.
  const destIdx = ix.accountKeyIndexes[1]
  if (destIdx === undefined) {
    throw new UnsafeSolanaSwapFundMovementError(index, 'SystemProgram.Transfer: missing destination account index')
  }
  const dest = keys.get(destIdx)
  if (!dest) {
    throw new UnsafeSolanaSwapFundMovementError(
      index,
      `SystemProgram.Transfer: destination index ${destIdx} could not be resolved`
    )
  }
  const wSolAta = getAssociatedTokenAddressSync(NATIVE_MINT, userWallet)
  if (!dest.equals(wSolAta)) {
    throw new UnsafeSolanaSwapFundMovementError(
      index,
      `SystemProgram.Transfer destination ${dest.toBase58()} is not the expected wSOL ATA ${wSolAta.toBase58()} — possible drain injection`
    )
  }
}

const assertTokenInstruction = (
  ix: MessageCompiledInstruction,
  keys: AccountKeys,
  userWallet: PublicKey,
  index: number
): void => {
  if (ix.data.length === 0) return
  const type = ix.data[0]!

  // Reject instructions that can delegate or transfer authority — these are
  // never present as top-level instructions in legitimate Jupiter shared-accounts swaps.
  if (type === TOKEN_APPROVE || type === TOKEN_APPROVE_CHECKED) {
    throw new UnsafeSolanaSwapFundMovementError(
      index,
      `Token.${type === TOKEN_APPROVE ? 'Approve' : 'ApproveChecked'} is not a legitimate top-level Jupiter swap instruction — possible authority delegation to attacker`
    )
  }
  if (type === TOKEN_SET_AUTHORITY) {
    throw new UnsafeSolanaSwapFundMovementError(
      index,
      'Token.SetAuthority is not a legitimate top-level Jupiter swap instruction — possible account seizure'
    )
  }

  // Transfer (type=3): accounts[2]=authority must be the user
  if (type === TOKEN_TRANSFER) {
    const authIdx = ix.accountKeyIndexes[2]
    if (authIdx === undefined)
      throw new UnsafeSolanaSwapFundMovementError(index, 'Token.Transfer: missing authority account index')
    const auth = keys.get(authIdx)
    if (!auth || !auth.equals(userWallet)) {
      throw new UnsafeSolanaSwapFundMovementError(
        index,
        `Token.Transfer authority ${auth?.toBase58() ?? '<unresolved>'} is not the user wallet ${userWallet.toBase58()}`
      )
    }
  }

  // TransferChecked (type=12): accounts[3]=authority must be the user
  if (type === TOKEN_TRANSFER_CHECKED) {
    const authIdx = ix.accountKeyIndexes[3]
    if (authIdx === undefined)
      throw new UnsafeSolanaSwapFundMovementError(index, 'Token.TransferChecked: missing authority account index')
    const auth = keys.get(authIdx)
    if (!auth || !auth.equals(userWallet)) {
      throw new UnsafeSolanaSwapFundMovementError(
        index,
        `Token.TransferChecked authority ${auth?.toBase58() ?? '<unresolved>'} is not the user wallet ${userWallet.toBase58()}`
      )
    }
  }

  // CloseAccount (type=9): accounts[2]=authority must be the user
  if (type === TOKEN_CLOSE_ACCOUNT) {
    const authIdx = ix.accountKeyIndexes[2]
    if (authIdx === undefined)
      throw new UnsafeSolanaSwapFundMovementError(index, 'Token.CloseAccount: missing authority account index')
    const auth = keys.get(authIdx)
    if (!auth || !auth.equals(userWallet)) {
      throw new UnsafeSolanaSwapFundMovementError(
        index,
        `Token.CloseAccount authority ${auth?.toBase58() ?? '<unresolved>'} is not the user wallet ${userWallet.toBase58()}`
      )
    }
  }

  // SyncNative (17), InitializeAccount (1), and other Token instructions
  // that do not move funds to an arbitrary destination: allowed.
}

/**
 * Fund-safety guard (audit finding SOL-01, vultisig/vultisig-sdk#1056): a
 * compromised Jupiter proxy could inject an arbitrary instruction (e.g. a
 * drain transfer) into the `VersionedTransaction` returned from `/swap`
 * before it reaches MPC signing. Vultisig's signing UI cannot meaningfully
 * render raw Solana instruction bytes for the user to review, so the
 * transaction would be effectively blind-signed.
 *
 * Two-layer defense:
 *
 * 1. **Program allow-list**: every top-level instruction's `programIdIndex`
 *    must resolve to a program in {@link JUPITER_SWAP_ALLOWED_PROGRAM_IDS}.
 *    Throws {@link UnsafeSolanaSwapInstructionError} on any unrecognized program.
 *
 * 2. **Destination/authority validation for fund-moving programs**: a
 *    program-only check is insufficient because `SystemProgram`,
 *    `TOKEN_PROGRAM_ID`, and `TOKEN_2022_PROGRAM_ID` are allow-listed (they
 *    perform legitimate SOL wrap/unwrap) but also implement drain/seize
 *    primitives (`Transfer`, `Approve`, `SetAuthority`). For each instruction
 *    targeting those programs, the decoded accounts are validated:
 *    - `SystemProgram.Transfer`: destination must be the user's wSOL ATA.
 *    - `Token.Transfer/TransferChecked`: authority must be the user wallet.
 *    - `Token.CloseAccount`: authority must be the user wallet.
 *    - `Token.Approve/ApproveChecked/SetAuthority`: rejected outright.
 *    Throws {@link UnsafeSolanaSwapFundMovementError} on any violation.
 *
 * Does NOT — and cannot, via static inspection alone — see into CPI (a
 * program invoked from inside another instruction); that's exactly what the
 * allow-listed Jupiter router is trusted to CPI into on the user's behalf.
 */
export const assertSafeSolanaSwapInstructions = (
  message: VersionedMessage,
  addressLookupTableAccounts: AddressLookupTableAccount[] = [],
  userWallet: PublicKey
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

    // Layer 2: for fund-moving programs, validate destination/authority
    if (FUND_MOVING_PROGRAM_IDS.has(programIdBase58)) {
      if (programIdBase58 === SYSTEM_PROGRAM_ID) {
        assertSystemInstruction(instruction, accountKeys, userWallet, index)
      } else {
        assertTokenInstruction(instruction, accountKeys, userWallet, index)
      }
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
 * all allow-listed and fund-movement-safe. See {@link assertSafeSolanaSwapInstructions}.
 */
export const assertSafeSolanaSwapTransactionBase64 = async (txData: string, userWallet: PublicKey): Promise<void> => {
  const versionedTx = VersionedTransaction.deserialize(Buffer.from(txData, 'base64'))
  const lutAccounts = await resolveSolanaAddressLookupTables(versionedTx.message)
  assertSafeSolanaSwapInstructions(versionedTx.message, lutAccounts, userWallet)
}
