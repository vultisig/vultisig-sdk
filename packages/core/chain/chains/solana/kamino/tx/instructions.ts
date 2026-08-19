import { PublicKey } from '@solana/web3.js'

import { kaminoConfig } from '../config'

/**
 * Every program a Kamino Earn transaction is allowed to invoke.
 *
 * This is an allow-list, not a catalogue: an instruction whose program is not
 * one of these is a refusal. That matters because the transaction is built by
 * Kamino and signed verbatim, so the program set is the outer boundary on what
 * the user's single signature can authorise. Anything outside it is code we
 * never agreed to run.
 */
export const kaminoAllowedPrograms = {
  system: '11111111111111111111111111111111',
  token: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  token2022: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  associatedToken: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  computeBudget: 'ComputeBudget111111111111111111111111111111',
  kvault: kaminoConfig.programId,
  farms: kaminoConfig.farmsProgramId,
  /**
   * SPL Memo v3, carrying this app's attribution tag. Never present in what
   * Kamino builds — the app appends it, which is why a memo arriving from the
   * API is a refusal rather than something to pass through.
   */
  memo: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
} as const

/** One of the allow-listed programs, named. */
export type KaminoAllowedProgram = keyof typeof kaminoAllowedPrograms

const programByAddress = new Map<string, KaminoAllowedProgram>(
  (Object.entries(kaminoAllowedPrograms) as [KaminoAllowedProgram, string][]).map(([name, address]) => [address, name])
)

/** Resolves a program id to its allow-list name, `undefined` when foreign. */
export const kaminoAllowedProgram = (programId: string): KaminoAllowedProgram | undefined =>
  programByAddress.get(programId)

/**
 * Programs whose instructions Kamino's builder composes itself, rather than
 * reaching them through a CPI from its own programs.
 *
 * The distinction is the crux of the writable-account check. What `kvault` and
 * `farms` do with the accounts they are handed is the protocol we chose to
 * trust; what appears at the *top level* of the transaction is whatever the
 * builder decided to put there, so every account those instructions can write
 * to has to be one we can name.
 */
export const isBuilderComposedProgram = (program: KaminoAllowedProgram): boolean =>
  program === 'system' || program === 'token' || program === 'token2022' || program === 'associatedToken'

/**
 * The attribution tag this app writes into every Kamino transaction it builds.
 *
 * Kamino's kvault API takes no referrer or partner parameter, so attribution
 * is client-side: one SPL Memo instruction carrying this literal, appended
 * after the API has built the transaction and before it is validated and
 * signed.
 *
 * The bytes are the whole point. This tag is the filter every downstream
 * measurement of Vultisig-originated deposits keys on, and it has to be
 * byte-identical on every platform. So it is written once, and the injector,
 * the validator and the verify-screen decoder all read it from here rather
 * than each spelling it out. It is matched whole and compared as bytes, so it
 * is case-sensitive: `8K2MZ` is a different memo.
 */
export const kaminoAttributionMemoTag = '8k2mz'

/** The tag's exact bytes — what the injector writes and the checks compare. */
export const kaminoAttributionMemoTagBytes: Uint8Array = new TextEncoder().encode(kaminoAttributionMemoTag)

/**
 * Instruction discriminators for the programs a Kamino Earn transaction uses.
 *
 * The Anchor ones are `sha256("global:<name>")[0..8]`, and each was also read
 * back out of a mainnet-simulated transaction built by the Kamino API, so the
 * constant and the observation agree. That agreement is the point: a constant
 * copied out of a captured transaction matches the shape it was copied from
 * and asserts nothing; one derived from the instruction's name and *then*
 * found in the bytes says the bytes are that instruction.
 */
export const kaminoDiscriminators = {
  /** `kvault::deposit(u64 tokenAmount)`. */
  kvaultDeposit: Uint8Array.from([0xf2, 0x23, 0xc6, 0x89, 0x52, 0xe1, 0xf2, 0xb6]),
  /**
   * `kvault::withdraw(u64 shareAmount)` — the argument is in SHARES, the
   * inverse of deposit's unit. One of TWO instructions a withdraw arrives as;
   * this is the one the builder emits when the request does not fit the
   * vault's liquid buffer, because only this one carries the accounts needed
   * to pull the shortfall out of a lending reserve.
   */
  kvaultWithdraw: Uint8Array.from([0xb7, 0x12, 0x46, 0x9c, 0x94, 0x6d, 0xa1, 0x22]),
  /**
   * `kvault::withdraw_from_available(u64 shareAmount)` — the same withdraw,
   * served entirely out of the vault's liquid buffer. Which of the two arrives
   * is a fact about the VAULT's liquidity at build time, not about the user's
   * request, and both are in live use — so both are accepted, and both mean
   * the same thing to the person signing.
   */
  kvaultWithdrawFromAvailable: Uint8Array.from([0x13, 0x83, 0x70, 0x9b, 0xaa, 0xdc, 0x22, 0x39]),
  /** `farms::initialize_user` — creates the user's farm state. Absent when it already exists. */
  farmsInitializeUser: Uint8Array.from([0x6f, 0x11, 0xb9, 0xfa, 0x3c, 0x7a, 0x26, 0xfe]),
  /** `farms::stake(u64 amount)`. Kamino always passes `u64::MAX`, meaning "stake the whole share balance". */
  farmsStake: Uint8Array.from([0xce, 0xb0, 0xca, 0x12, 0xc8, 0xd1, 0xb3, 0x6c]),
  /**
   * `farms::unstake(u128 stakeSharesScaled)` — releases shares from the farm
   * into the user's pending-withdrawal balance. Its argument is the only
   * `u128` in this feature, and it is scaled: the farms program holds stake at
   * `WAD`, so the value is share base units multiplied by `10^18`. Reading
   * those 16 bytes as a `u64` truncates silently.
   */
  farmsUnstake: Uint8Array.from([0x5a, 0x5f, 0x6b, 0x2a, 0xcd, 0x7c, 0x32, 0xe1]),
  /**
   * `farms::withdraw_unstaked_deposits` — moves what `unstake` released into
   * the user's share account, where the vault withdraw can then burn it.
   * Takes no argument: it always moves the whole pending balance.
   */
  farmsWithdrawUnstakedDeposits: Uint8Array.from([0x24, 0x66, 0xbb, 0x31, 0xdc, 0x24, 0x84, 0x43]),
} as const

/**
 * The fixed-point scale the farms program holds stake at: `10^18`. Everything
 * else in this feature is an integer count of base units; this one is not, so
 * the conversion is written out rather than inferred at each call site.
 */
export const kaminoFarmsStakeScale = 10n ** 18n

/** Associated Token Program `CreateIdempotent`. */
export const createIdempotentAtaDiscriminator = 1

/** SPL Token `SyncNative` — reconciles a wSOL account's balance with its lamports. */
export const tokenSyncNativeDiscriminator = 17

/** SPL Token `CloseAccount` — unwraps wSOL back to native SOL, or reclaims rent. */
export const tokenCloseAccountDiscriminator = 9

/** System Program `Transfer`: a 4-byte little-endian enum index. */
export const systemTransferDiscriminator = Uint8Array.from([2, 0, 0, 0])

/** ComputeBudget `SetComputeUnitLimit` / `SetComputeUnitPrice` one-byte tags. */
export const computeBudgetDiscriminators = { setUnitLimit: 2, setUnitPrice: 3 } as const

const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((byte, index) => byte === b[index])

/** Whether `data` starts with the 8-byte Anchor discriminator `prefix`. */
export const hasAnchorDiscriminator = (data: Uint8Array, prefix: Uint8Array): boolean =>
  data.length >= 8 && bytesEqual(data.slice(0, 8), prefix)

/** Whether `data` is exactly the attribution tag — matched whole, as bytes. */
export const isAttributionMemoData = (data: Uint8Array): boolean => bytesEqual(data, kaminoAttributionMemoTagBytes)

const littleEndianBigInt = (bytes: Uint8Array): bigint => {
  let value = 0n
  for (let index = bytes.length - 1; index >= 0; index--) {
    value = (value << 8n) | BigInt(bytes[index])
  }
  return value
}

/**
 * An Anchor instruction's `u64` argument: the 8 bytes after the
 * discriminator, little-endian. `undefined` unless the payload is exactly
 * discriminator + argument.
 */
export const anchorU64Argument = (data: Uint8Array): bigint | undefined => {
  if (data.length !== 16) return undefined
  return littleEndianBigInt(data.slice(8, 16))
}

/**
 * An Anchor instruction's `u128` argument: the 16 bytes after the
 * discriminator, little-endian, exact.
 *
 * Separate from `anchorU64Argument` and never a fallback for it. A `u128`
 * argument read through the `u64` reader would take the low 8 bytes of a
 * 16-byte field and report a plausible-looking number that is not the one on
 * the wire — so the two readers are keyed on the exact payload length and
 * neither accepts the other's.
 */
export const anchorU128Argument = (data: Uint8Array): bigint | undefined => {
  if (data.length !== 24) return undefined
  return littleEndianBigInt(data.slice(8, 24))
}

/**
 * An Anchor instruction that carries no argument at all: exactly the
 * discriminator and nothing after it. Checked rather than assumed — the
 * sequence matches on the first eight bytes, so trailing bytes would
 * otherwise ride along unread.
 */
export const hasNoAnchorArgument = (data: Uint8Array): boolean => data.length === 8

/** `Transfer` payload: the 4-byte discriminant plus a `u64` lamport amount. */
export const systemTransferLamports = (data: Uint8Array): bigint | undefined => {
  if (data.length !== 12) return undefined
  if (!bytesEqual(data.slice(0, 4), systemTransferDiscriminator)) return undefined
  return littleEndianBigInt(data.slice(4, 12))
}

/** `SetComputeUnitLimit`'s `u32` argument. */
export const computeUnitLimitArgument = (data: Uint8Array): number | undefined => {
  if (data.length !== 5 || data[0] !== computeBudgetDiscriminators.setUnitLimit) return undefined
  return Number(littleEndianBigInt(data.slice(1, 5)))
}

/**
 * `SetComputeUnitPrice`'s `u64` argument, in micro-lamports per compute unit.
 * The fee it produces is `price × limit`, so this is a spend.
 */
export const computeUnitPriceArgument = (data: Uint8Array): bigint | undefined => {
  if (data.length !== 9 || data[0] !== computeBudgetDiscriminators.setUnitPrice) return undefined
  return littleEndianBigInt(data.slice(1, 9))
}

/**
 * The farms program's per-user account, derived rather than trusted.
 *
 * `farms::unstake` and `farms::withdraw_unstaked_deposits` both take it, and
 * it is the account that decides WHICH stake they move. Its address is a
 * program address over the farm and the owner, so recomputing it locally
 * binds both instructions to one farm and one user at once — and it does so
 * offline, which the farm slot itself cannot: the farm is an
 * address-lookup-table entry in every captured transaction, and the verify
 * screen has no way to resolve one.
 */
export const deriveKaminoFarmsUserState = ({ farm, owner }: { farm: string; owner: string }): string | undefined => {
  try {
    const [address] = PublicKey.findProgramAddressSync(
      [new TextEncoder().encode('user'), new PublicKey(farm).toBytes(), new PublicKey(owner).toBytes()],
      new PublicKey(kaminoAllowedPrograms.farms)
    )
    return address.toBase58()
  } catch {
    return undefined
  }
}

/**
 * Positions of the accounts each instruction is checked and decoded on.
 *
 * An Anchor instruction's account list is fixed by its IDL — only the
 * trailing `remaining_accounts` vary, which is why the observed lists differ
 * in length between vaults while these prefixes do not. Each index was read
 * out of transactions the Kamino API built for all three launch vaults.
 *
 * Shared rather than duplicated: the validator checks against these before
 * signing and the decoder reads the same slots back out of the signed bytes.
 * Two copies that drifted would let the verify screen describe a different
 * instruction from the one that was validated.
 *
 * The two withdraw instructions share one map rather than merely agreeing:
 * the program's IDL declares `withdraw`'s account list as
 * `withdraw_from_available`'s fourteen accounts followed by the reserve-exit
 * group, so the first fourteen slots of the longer instruction ARE the
 * shorter one's, and every pinned index lies inside that shared prefix.
 */
export const kaminoInstructionAccounts = {
  kvaultDeposit: {
    user: 0,
    vault: 1,
    tokenMint: 3,
    sharesMint: 5,
    userTokenAccount: 6,
    userShareAccount: 7,
    minimumCount: 8,
  },
  kvaultWithdraw: {
    user: 0,
    vault: 1,
    userTokenAccount: 5,
    tokenMint: 6,
    userShareAccount: 7,
    sharesMint: 8,
    minimumCount: 9,
  },
  farmsInitializeUser: { authority: 0, farm: 5, minimumCount: 6 },
  farmsStake: { owner: 0, farm: 2, userShareAccount: 4, sharesMint: 5, minimumCount: 6 },
  farmsUnstake: { owner: 0, userState: 1, farm: 2, minimumCount: 3 },
  farmsWithdrawUnstakedDeposits: { owner: 0, userState: 1, farm: 2, userShareAccount: 3, minimumCount: 4 },
  associatedToken: { payer: 0, account: 1, wallet: 2, mint: 3, tokenProgram: 5, count: 6 },
  systemTransfer: { source: 0, destination: 1, count: 2 },
  closeAccount: { account: 0, destination: 1, authority: 2, count: 3 },
} as const
