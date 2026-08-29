/**
 * Hand-rolled BCS (Binary Canonical Serialization) reader for Sui prebuilt
 * `TransactionData` bytes — scoped to ONE job: pin the `sender` field before
 * a consumer blind-signs a backend-supplied PTB.
 *
 * Vendored from `vultiagent-app/src/services/suiPrebuiltBcs.ts`, where it
 * closed app#2131 (later hardened fail-closed in app#2447). The SDK already
 * owns the prebuilt-byte signing/hash contract (`buildSuiSigningHash` in
 * `./tx`) but not this safety helper, so every first-party consumer of that
 * signing contract had to duplicate the parser or skip the bind.
 *
 * Sui's `TransactionDataV1` BCS layout is `{ kind, sender, gasData, expiration }`.
 * `sender` sits AFTER `kind: TransactionKind`, and `TransactionKind::ProgrammableTransaction`
 * is a variable-length `{ inputs: Vec<CallArg>, commands: Vec<Command> }` where
 * every element is itself enum-tagged BCS. There is no fixed offset for `sender`
 * — reaching it means structurally walking (not semantically interpreting) the
 * whole PTB body. This module does exactly that: it decodes ONLY enough of each
 * field to know how many bytes to skip, and reads real values nowhere except the
 * final 32-byte `sender` address.
 *
 * Schema verified byte-for-byte against `@mysten/sui`'s bcs.ts (the same
 * library upstream prebuilt-tx builders use), cross-checked against real PTB
 * fixtures (SplitCoins + TransferObjects, and a MoveCall + MakeMoveVec case
 * exercising nested TypeTag/StructTag recursion) — see the test file.
 *
 * FAIL-CLOSED on any parse error. Sui's BCS PTB schema is intricate (7
 * Command variants, a recursive TypeTag, 3 CallArg variants); a decoder bug
 * or a future protocol variant this reader doesn't know about must NOT
 * become a silent bypass of the sender bind. `extractSuiPrebuiltSender`
 * throws on anything it can't confidently walk; `assertSuiPrebuiltSenderMatchesVault`
 * lets that propagate as a refusal to sign rather than falling back to
 * unbound behavior. A CONFIRMED sender mismatch (successfully decoded,
 * doesn't match) and an UNDECODABLE PTB (drift/malformed/unsupported
 * variant) both refuse the send — the only thing that signs is a PTB this
 * reader could fully walk AND whose sender matches the vault.
 */

const SUI_ADDRESS_BYTES = 32

class BcsCursor {
  private offset = 0

  constructor(private readonly bytes: Uint8Array) {}

  private ensure(n: number): void {
    if (n < 0 || this.offset + n > this.bytes.length) {
      throw new Error(
        `Sui prebuilt BCS: read past end of buffer (offset ${this.offset}, need ${n}, len ${this.bytes.length})`
      )
    }
  }

  readBytes(n: number): Uint8Array {
    this.ensure(n)
    const b = this.bytes.slice(this.offset, this.offset + n)
    this.offset += n
    return b
  }

  skip(n: number): void {
    this.ensure(n)
    this.offset += n
  }

  // ULEB128 - used by BCS for enum variant tags and Vec/String length prefixes
  // ONLY (fixed-width ints like u64 are raw little-endian, not uleb128). Capped
  // at 32 bits: no BCS vector length or enum tag in this schema needs more.
  //
  // Accumulates with `+ Math.pow(2, shift)` arithmetic, NOT `|= x << shift`.
  // JS bitwise operators coerce to int32, so a bitwise accumulator SILENTLY
  // TRUNCATES anything past bit 31 instead of throwing: `80 80 80 80 10`
  // (uleb128 for 2^32) would decode to 0, and a length prefix collapsing to a
  // small value makes the walk land on the WRONG offset and read 32
  // attacker-placed bytes as `sender`. Since the attacker knows this vault's
  // address, they could park it at that offset and turn a decode failure into
  // a false PASS. Arithmetic accumulation + an explicit u32 range check makes
  // the "exceeds 32 bits" contract this comment claims actually true.
  readUleb128(): number {
    let result = 0
    let shift = 0
    for (;;) {
      this.ensure(1)
      const byte = this.bytes[this.offset]!
      this.offset += 1
      result += (byte & 0x7f) * 2 ** shift
      if (result > 0xffffffff) {
        throw new Error('Sui prebuilt BCS: uleb128 value exceeds 32 bits')
      }
      if ((byte & 0x80) === 0) break
      shift += 7
      if (shift > 32) {
        throw new Error('Sui prebuilt BCS: uleb128 value exceeds 32 bits')
      }
    }
    return result
  }
}

function skipVector(c: BcsCursor, skipElement: () => void): void {
  const len = c.readUleb128()
  for (let i = 0; i < len; i++) skipElement()
}

// byteVector / string: uleb128 length prefix + raw bytes. BCS encodes strings
// as their raw utf8 bytes behind the same length-prefixed vector<u8> framing.
function skipByteVector(c: BcsCursor): void {
  const len = c.readUleb128()
  c.skip(len)
}

// Address (SuiAddress): fixed 32 raw bytes, NO length prefix.
function skipAddress(c: BcsCursor): void {
  c.skip(SUI_ADDRESS_BYTES)
}

// TypeTag (Move type tag enum). Recursive via `vector` (nested TypeTag) and
// `struct` (StructTag, which itself nests `vector<TypeTag>` typeParams).
function skipTypeTag(c: BcsCursor): void {
  const tag = c.readUleb128()
  switch (tag) {
    case 0: // bool
    case 1: // u8
    case 2: // u64
    case 3: // u128
    case 4: // address
    case 5: // signer
    case 8: // u16
    case 9: // u32
    case 10: // u256
      return
    case 6: // vector(TypeTag)
      skipTypeTag(c)
      return
    case 7: // struct(StructTag)
      skipStructTag(c)
      return
    default:
      throw new Error(`Sui prebuilt BCS: unknown TypeTag variant ${tag}`)
  }
}

function skipStructTag(c: BcsCursor): void {
  skipAddress(c) // address
  skipByteVector(c) // module (string)
  skipByteVector(c) // name (string)
  skipVector(c, () => skipTypeTag(c)) // typeParams
}

// Argument: references into inputs/results, never raw data directly.
function skipArgument(c: BcsCursor): void {
  const tag = c.readUleb128()
  switch (tag) {
    case 0: // GasCoin
      return
    case 1: // Input(u16)
      c.skip(2)
      return
    case 2: // Result(u16)
      c.skip(2)
      return
    case 3: // NestedResult(u16, u16)
      c.skip(4)
      return
    default:
      throw new Error(`Sui prebuilt BCS: unknown Argument variant ${tag}`)
  }
}

function skipSuiObjectRef(c: BcsCursor): void {
  skipAddress(c) // objectId
  c.skip(8) // version: u64 (fixed 8-byte LE)
  skipByteVector(c) // digest (ObjectDigest = length-prefixed byteVector)
}

function skipSharedObjectRef(c: BcsCursor): void {
  skipAddress(c) // objectId
  c.skip(8) // initialSharedVersion: u64
  c.skip(1) // mutable: bool
}

function skipObjectArg(c: BcsCursor): void {
  const tag = c.readUleb128()
  switch (tag) {
    case 0: // ImmOrOwnedObject
      skipSuiObjectRef(c)
      return
    case 1: // SharedObject
      skipSharedObjectRef(c)
      return
    case 2: // Receiving
      skipSuiObjectRef(c)
      return
    default:
      throw new Error(`Sui prebuilt BCS: unknown ObjectArg variant ${tag}`)
  }
}

function skipFundsWithdrawal(c: BcsCursor): void {
  // Reservation: { MaxAmountU64(u64) }
  const reservationTag = c.readUleb128()
  if (reservationTag !== 0) {
    throw new Error(`Sui prebuilt BCS: unknown Reservation variant ${reservationTag}`)
  }
  c.skip(8)
  // WithdrawalType: { Balance(TypeTag) }
  const withdrawalTypeTag = c.readUleb128()
  if (withdrawalTypeTag !== 0) {
    throw new Error(`Sui prebuilt BCS: unknown WithdrawalType variant ${withdrawalTypeTag}`)
  }
  skipTypeTag(c)
  // WithdrawFrom: { Sender, Sponsor }
  const withdrawFromTag = c.readUleb128()
  if (withdrawFromTag !== 0 && withdrawFromTag !== 1) {
    throw new Error(`Sui prebuilt BCS: unknown WithdrawFrom variant ${withdrawFromTag}`)
  }
}

// CallArg: an input to the PTB - a plain value (Pure), an object reference
// (Object), or a funds-withdrawal reservation (FundsWithdrawal).
function skipCallArg(c: BcsCursor): void {
  const tag = c.readUleb128()
  switch (tag) {
    case 0: // Pure { bytes: byteVector }
      skipByteVector(c)
      return
    case 1: // Object(ObjectArg)
      skipObjectArg(c)
      return
    case 2: // FundsWithdrawal
      skipFundsWithdrawal(c)
      return
    default:
      throw new Error(`Sui prebuilt BCS: unknown CallArg variant ${tag}`)
  }
}

function skipProgrammableMoveCall(c: BcsCursor): void {
  skipAddress(c) // package
  skipByteVector(c) // module (string)
  skipByteVector(c) // function (string)
  skipVector(c, () => skipTypeTag(c)) // typeArguments
  skipVector(c, () => skipArgument(c)) // arguments
}

// Option<TypeTag> - BCS encodes Option the same as a 2-variant enum
// (None=0, Some=1<value>); a uleb128 tag read handles both since 0/1 fit in
// one byte either way.
function skipOptionTypeTag(c: BcsCursor): void {
  const tag = c.readUleb128()
  if (tag === 0) return // None
  if (tag === 1) {
    skipTypeTag(c) // Some
    return
  }
  throw new Error(`Sui prebuilt BCS: unknown Option<TypeTag> tag ${tag}`)
}

// Command: the 7 PTB command variants. This is where value actually moves
// (TransferObjects/SplitCoins/MergeCoins) or arbitrary Move code runs
// (MoveCall) - we still only SKIP here (no semantic interpretation), sender
// is the only field this module binds.
function skipCommand(c: BcsCursor): void {
  const tag = c.readUleb128()
  switch (tag) {
    case 0: // MoveCall(ProgrammableMoveCall)
      skipProgrammableMoveCall(c)
      return
    case 1: // TransferObjects { objects: Vec<Argument>, address: Argument }
      skipVector(c, () => skipArgument(c))
      skipArgument(c)
      return
    case 2: // SplitCoins { coin: Argument, amounts: Vec<Argument> }
      skipArgument(c)
      skipVector(c, () => skipArgument(c))
      return
    case 3: // MergeCoins { destination: Argument, sources: Vec<Argument> }
      skipArgument(c)
      skipVector(c, () => skipArgument(c))
      return
    case 4: // Publish { modules: Vec<byteVector>, dependencies: Vec<Address> }
      skipVector(c, () => skipByteVector(c))
      skipVector(c, () => skipAddress(c))
      return
    case 5: // MakeMoveVec { type: Option<TypeTag>, elements: Vec<Argument> }
      skipOptionTypeTag(c)
      skipVector(c, () => skipArgument(c))
      return
    case 6: // Upgrade { modules: Vec<byteVector>, dependencies: Vec<Address>, package: Address, ticket: Argument }
      skipVector(c, () => skipByteVector(c))
      skipVector(c, () => skipAddress(c))
      skipAddress(c)
      skipArgument(c)
      return
    default:
      throw new Error(`Sui prebuilt BCS: unknown Command variant ${tag}`)
  }
}

function skipProgrammableTransaction(c: BcsCursor): void {
  skipVector(c, () => skipCallArg(c)) // inputs
  skipVector(c, () => skipCommand(c)) // commands
}

/**
 * Decode `TransactionData::V1.sender` from prebuilt Sui `TransactionData` BCS
 * bytes, walking (but not interpreting) the full `ProgrammableTransaction`
 * body first since `sender` follows it in the struct.
 *
 * Throws on ANY structural surprise (truncated buffer, out-of-range vector
 * length, unrecognized enum variant) - callers decide what "can't decode"
 * means for their fail posture; this function makes no assumption about it.
 *
 * Returns a lowercase `0x`-prefixed 64-hex-char address, matching the format
 * `deriveSuiAddress` (in `./tx`) returns.
 */
export function extractSuiPrebuiltSender(txBytes: Uint8Array): string {
  const c = new BcsCursor(txBytes)
  const transactionDataTag = c.readUleb128() // TransactionData::V1 = 0
  if (transactionDataTag !== 0) {
    throw new Error(`Sui prebuilt BCS: unsupported TransactionData variant ${transactionDataTag}`)
  }
  const transactionKindTag = c.readUleb128() // TransactionKind::ProgrammableTransaction = 0
  if (transactionKindTag !== 0) {
    throw new Error(`Sui prebuilt BCS: unsupported TransactionKind variant ${transactionKindTag}`)
  }
  skipProgrammableTransaction(c)
  const senderBytes = c.readBytes(SUI_ADDRESS_BYTES)
  const hex = Array.from(senderBytes, b => b.toString(16).padStart(2, '0')).join('')
  return `0x${hex}`
}

/**
 * Fail-closed sender bind for a prebuilt Sui sign path: refuses to sign a
 * backend-supplied PTB that isn't sent from the expected address —
 * INCLUDING when the PTB can't be confidently decoded at all.
 *
 * SCOPE — what this does and does NOT buy, stated precisely so nobody reads
 * it as "the prebuilt Sui path is WYSIWYS":
 *
 * - It does NOT stop a drain. Sui requires the sender's own signature on a
 *   transaction, so any PTB that actually spends the expected address's
 *   coins must already carry `sender == expectedSenderAddress` — which
 *   PASSES this bind. The recipient, the amounts, and the MoveCall targets
 *   inside the PTB are still completely unbound. A hostile backend can
 *   still get the signer to sign a transfer to an attacker address. Binding
 *   recipient/amount means resolving `Argument::Input(idx)` back through
 *   `inputs` — deliberately out of scope here.
 * - What it DOES close is the sponsored-transaction shape: `TransactionData`
 *   carries `gasData.owner` separately from `sender`, and a tx whose
 *   `gas owner` is the expected address but whose `sender` is an attacker
 *   is valid on-chain once the attacker adds their own sender signature.
 *   The expected address's signature is then accepted as the GAS SPONSOR
 *   signature, paying the attacker's gas up to `gasData.budget`. Without
 *   this bind that signature would be produced blind.
 *
 * - decode succeeds + sender matches → passes silently (the normal case).
 * - decode succeeds + sender does NOT match → throws. A confidently-decoded,
 *   confirmed mismatch is never safe to sign.
 * - decode fails (malformed bytes, or a valid-but-unrecognized PTB shape
 *   this reader's scoped BCS schema doesn't cover, i.e. decode DRIFT) →
 *   throws. A PTB this reader cannot fully walk is, by definition, a PTB
 *   whose sender cannot be confirmed — signing it anyway is exactly the
 *   bypass this guard exists to prevent.
 */
export function assertSuiPrebuiltSenderMatchesVault(txBytes: Uint8Array, expectedSenderAddress: string): void {
  let decodedSender: string
  try {
    decodedSender = extractSuiPrebuiltSender(txBytes)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    // A decode failure is refused, not skipped - see the docblock above. Leave
    // a breadcrumb so a decoder regression or an unseen Sui protocol variant
    // is greppable in a bug report even though the send is already blocked.
    console.error(`[SuiTx] prebuilt Sui sender bind FAILED (fail-closed, refusing to sign): ${reason}`)
    throw new Error(
      `Funds NOT sent: could not verify the sender of this prebuilt Sui transaction (${reason}). ` +
        `Refusing to sign an unverified prebuilt transaction.`
    )
  }
  if (decodedSender.toLowerCase() !== expectedSenderAddress.toLowerCase()) {
    throw new Error(
      `Funds NOT sent: prebuilt Sui transaction sender ${decodedSender} does not match the expected address ` +
        `${expectedSenderAddress}. Refusing to sign - the backend-supplied transaction does not belong to this vault.`
    )
  }
}

export const testing = {
  BcsCursor,
  skipProgrammableTransaction,
}
