import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import {
  AddressLookupTableAccount,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { injectSolanaAtaIfMissing } from './injectSolanaAtaIfMissing'

// Mock the Solana client so we control RPC responses.
vi.mock('@vultisig/core-chain/chains/solana/client', () => ({
  getSolanaClient: vi.fn(),
}))

const { getSolanaClient } = await import('@vultisig/core-chain/chains/solana/client')

// ---- helpers ----------------------------------------------------------------

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const payer = Keypair.generate().publicKey.toBase58()
const owner = Keypair.generate().publicKey.toBase58()
const blockhash = '11111111111111111111111111111111'

/** Minimal mint account info response — owner is the Token program (legacy). */
const MOCK_MINT_INFO = { owner: TOKEN_PROGRAM_ID, data: Buffer.alloc(82) }

/**
 * Build a minimal base64-encoded V0 VersionedTransaction that represents
 * a swap tx (one no-op SystemProgram.transfer instruction for the test).
 */
function buildMinimalLifiTx(): string {
  const payerKey = new PublicKey(payer)
  // A minimal instruction so the transaction is valid enough to serialize.
  const ix = SystemProgram.transfer({
    fromPubkey: payerKey,
    toPubkey: payerKey,
    lamports: 0,
  })
  const message = new TransactionMessage({
    payerKey,
    recentBlockhash: blockhash,
    instructions: [ix],
  }).compileToV0Message()
  const tx = new VersionedTransaction(message)
  return Buffer.from(tx.serialize()).toString('base64')
}

/**
 * Build a V0 VersionedTransaction that references a LUT. The LUT address is
 * embedded in the message's addressTableLookups so the decompile path actually
 * exercises the LUT-fetch branch. We include a single address from the LUT in
 * the instruction so the entry makes it into the compiled message.
 */
function buildLutLifiTx(lutKey: PublicKey, lutAddress: PublicKey): string {
  const payerKey = new PublicKey(payer)
  // An instruction that uses the LUT-provided address so the compiler includes
  // the LUT reference in the compiled V0 message.
  const ix = SystemProgram.transfer({
    fromPubkey: payerKey,
    toPubkey: lutAddress,
    lamports: 0,
  })
  const lut = new AddressLookupTableAccount({
    key: lutKey,
    state: {
      deactivationSlot: BigInt('18446744073709551615'),
      lastExtendedSlot: 0,
      lastExtendedSlotStartIndex: 0,
      authority: undefined,
      addresses: [lutAddress],
    },
  })
  const message = new TransactionMessage({
    payerKey,
    recentBlockhash: blockhash,
    instructions: [ix],
  }).compileToV0Message([lut])
  const tx = new VersionedTransaction(message)
  return Buffer.from(tx.serialize()).toString('base64')
}

// ---- tests ------------------------------------------------------------------

describe('injectSolanaAtaIfMissing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the original tx data unchanged and ataInjected=false when the ATA already exists', async () => {
    const mockClient = {
      // First call: mint account info. Second call: ATA exists (non-null + healthy owner).
      getAccountInfo: vi
        .fn()
        .mockResolvedValueOnce(MOCK_MINT_INFO)
        .mockResolvedValueOnce({
          owner: TOKEN_PROGRAM_ID,
          data: Buffer.alloc(165),
        }),
      getAddressLookupTable: vi.fn().mockResolvedValue({ value: null }),
    }
    vi.mocked(getSolanaClient).mockReturnValue(mockClient as any)

    const originalData = buildMinimalLifiTx()
    const result = await injectSolanaAtaIfMissing(originalData, USDC_MINT, owner, payer)

    expect(result.data).toBe(originalData)
    expect(result.ataInjected).toBe(false)
    expect(mockClient.getAccountInfo).toHaveBeenCalledTimes(2)
  })

  it('prepends createAssociatedTokenAccountIdempotentInstruction when ATA is missing', async () => {
    const mockClient = {
      // First call: mint account info. Second call: ATA does not exist (null).
      getAccountInfo: vi.fn().mockResolvedValueOnce(MOCK_MINT_INFO).mockResolvedValueOnce(null),
      getAddressLookupTable: vi.fn().mockResolvedValue({ value: null }),
    }
    vi.mocked(getSolanaClient).mockReturnValue(mockClient as any)

    const originalData = buildMinimalLifiTx()
    const result = await injectSolanaAtaIfMissing(originalData, USDC_MINT, owner, payer)

    expect(result.ataInjected).toBe(true)
    // Result data must differ from original (instruction was injected).
    expect(result.data).not.toBe(originalData)

    // Deserialize result and verify ATA instruction is the first one.
    const patchedTx = VersionedTransaction.deserialize(Buffer.from(result.data, 'base64'))
    const patchedMsg = TransactionMessage.decompile(patchedTx.message)

    // Original had 1 instruction; patched must have 2.
    expect(patchedMsg.instructions.length).toBe(2)

    // First instruction must reference the ATA address and USDC mint.
    const ataAddress = getAssociatedTokenAddressSync(
      new PublicKey(USDC_MINT),
      new PublicKey(owner),
      true,
      TOKEN_PROGRAM_ID
    )
    const firstIx = patchedMsg.instructions[0]
    const accountKeys = firstIx.keys.map(k => k.pubkey.toBase58())
    expect(accountKeys).toContain(ataAddress.toBase58())
    expect(accountKeys).toContain(USDC_MINT)
  })

  it('checks the correct ATA address derived from mint + owner', async () => {
    const mockClient = {
      getAccountInfo: vi.fn().mockResolvedValueOnce(MOCK_MINT_INFO).mockResolvedValueOnce(null),
      getAddressLookupTable: vi.fn().mockResolvedValue({ value: null }),
    }
    vi.mocked(getSolanaClient).mockReturnValue(mockClient as any)

    await injectSolanaAtaIfMissing(buildMinimalLifiTx(), USDC_MINT, owner, payer)

    const expectedAta = getAssociatedTokenAddressSync(
      new PublicKey(USDC_MINT),
      new PublicKey(owner),
      true,
      TOKEN_PROGRAM_ID
    )
    expect(mockClient.getAccountInfo).toHaveBeenCalledWith(expectedAta)
  })

  it('re-encodes the transaction as valid base64', async () => {
    const mockClient = {
      getAccountInfo: vi.fn().mockResolvedValueOnce(MOCK_MINT_INFO).mockResolvedValueOnce(null),
      getAddressLookupTable: vi.fn().mockResolvedValue({ value: null }),
    }
    vi.mocked(getSolanaClient).mockReturnValue(mockClient as any)

    const result = await injectSolanaAtaIfMissing(buildMinimalLifiTx(), USDC_MINT, owner, payer)

    // Must be valid base64 and deserializable.
    expect(() => {
      VersionedTransaction.deserialize(Buffer.from(result.data, 'base64'))
    }).not.toThrow()
  })

  it('throws when caller-supplied payer does not match the tx fee-payer', async () => {
    // Build a tx whose fee-payer is `payer`, but pass a DIFFERENT pubkey as
    // the `payer` arg to injectSolanaAtaIfMissing. The contract violation
    // must surface as a clear thrown error, not a downstream simulation
    // failure. (#519 r3 — NeO should-fix.)
    const wrongPayer = Keypair.generate().publicKey.toBase58()
    const mockClient = {
      // mint exists, ATA does not (so we proceed to decompile + payer check)
      getAccountInfo: vi.fn().mockResolvedValueOnce(MOCK_MINT_INFO).mockResolvedValueOnce(null),
      getAddressLookupTable: vi.fn().mockResolvedValue({ value: null }),
    }
    vi.mocked(getSolanaClient).mockReturnValue(mockClient as any)

    await expect(injectSolanaAtaIfMissing(buildMinimalLifiTx(), USDC_MINT, owner, wrongPayer)).rejects.toThrow(
      /Payer mismatch/
    )
  })

  it('throws when the mint is owned by an unsupported token program', async () => {
    // Custom token program — neither TOKEN_PROGRAM_ID nor TOKEN_2022_PROGRAM_ID.
    // Silent fallback to TOKEN_PROGRAM_ID would derive the WRONG ATA and produce
    // an opaque simulation failure. (#519 r-N NeO blocking #1.)
    const unsupportedProgram = Keypair.generate().publicKey
    const mockClient = {
      getAccountInfo: vi.fn().mockResolvedValueOnce({
        owner: unsupportedProgram,
        data: Buffer.alloc(82),
      }),
      getAddressLookupTable: vi.fn().mockResolvedValue({ value: null }),
    }
    vi.mocked(getSolanaClient).mockReturnValue(mockClient as any)

    await expect(injectSolanaAtaIfMissing(buildMinimalLifiTx(), USDC_MINT, owner, payer)).rejects.toThrow(
      /unsupported program/
    )
  })

  it('throws when the ATA address is squatted by an account with a different owner', async () => {
    // ATA address exists but is owned by a non-token program (seed collision
    // for a different PDA, or manual pre-allocation). Returning early without
    // injection would later fail with an opaque "invalid account data" error
    // at simulation. (#519 r-N NeO blocking #2.)
    const squatter = Keypair.generate().publicKey
    const mockClient = {
      getAccountInfo: vi
        .fn()
        .mockResolvedValueOnce(MOCK_MINT_INFO)
        .mockResolvedValueOnce({ owner: squatter, data: Buffer.alloc(0) }),
      getAddressLookupTable: vi.fn().mockResolvedValue({ value: null }),
    }
    vi.mocked(getSolanaClient).mockReturnValue(mockClient as any)

    await expect(injectSolanaAtaIfMissing(buildMinimalLifiTx(), USDC_MINT, owner, payer)).rejects.toThrow(
      /exists but is owned by/
    )
  })

  it('treats ATA as existing when account owner matches the token program', async () => {
    // Healthy ATA — owner matches TOKEN_PROGRAM_ID — return ataInjected=false.
    const mockClient = {
      getAccountInfo: vi
        .fn()
        .mockResolvedValueOnce(MOCK_MINT_INFO)
        .mockResolvedValueOnce({
          owner: TOKEN_PROGRAM_ID,
          data: Buffer.alloc(165),
        }),
      getAddressLookupTable: vi.fn().mockResolvedValue({ value: null }),
    }
    vi.mocked(getSolanaClient).mockReturnValue(mockClient as any)

    const originalData = buildMinimalLifiTx()
    const result = await injectSolanaAtaIfMissing(originalData, USDC_MINT, owner, payer)

    expect(result.ataInjected).toBe(false)
    expect(result.data).toBe(originalData)
  })

  it('tolerates a throwing getAddressLookupTable and still injects the ATA', async () => {
    // The minimal tx has no LUT references, so the LUT loop does not run.
    // This test verifies that if getAddressLookupTable were to throw on a tx
    // that DOES reference LUTs, fetchLutWithRetry swallows the error rather
    // than propagating it — the function still completes and injects the ATA.
    const mockClient = {
      getAccountInfo: vi.fn().mockResolvedValueOnce(MOCK_MINT_INFO).mockResolvedValueOnce(null),
      getAddressLookupTable: vi.fn().mockRejectedValue(new Error('RPC timeout')),
    }
    vi.mocked(getSolanaClient).mockReturnValue(mockClient as any)

    const result = await injectSolanaAtaIfMissing(buildMinimalLifiTx(), USDC_MINT, owner, payer)

    // Must still inject the ATA even if LUT fetching failed/didn't run.
    expect(result.ataInjected).toBe(true)
  })

  it('throws with a clear error when LUT decompile fails due to missing LUT accounts', async () => {
    // This test actually exercises the LUT path: buildLutLifiTx embeds a real
    // LUT reference in the V0 message. The mock returns null for the LUT fetch
    // (simulates all retries exhausted), so decompile will throw because it
    // cannot resolve the LUT-referenced accounts — and we expect a clear
    // re-thrown error rather than the SDK's opaque message.
    // (#519 r-N NeO should-fix #1 + should-fix #4.)
    const lutKey = Keypair.generate().publicKey
    const lutAddress = Keypair.generate().publicKey
    const txData = buildLutLifiTx(lutKey, lutAddress)

    const mockClient = {
      // mint account exists, ATA does not (so we proceed to decompile)
      getAccountInfo: vi.fn().mockResolvedValueOnce(MOCK_MINT_INFO).mockResolvedValueOnce(null),
      // LUT fetch returns null — simulates exhausted retries
      getAddressLookupTable: vi.fn().mockResolvedValue({ value: null }),
    }
    vi.mocked(getSolanaClient).mockReturnValue(mockClient as any)

    await expect(injectSolanaAtaIfMissing(txData, USDC_MINT, owner, payer)).rejects.toThrow(
      /Failed to decompile LiFi transaction message/
    )
    // Confirm LUT fetch was actually attempted (LUT path exercised).
    expect(mockClient.getAddressLookupTable).toHaveBeenCalledWith(lutKey)
  })

  it('successfully injects ATA when LUT is fetched and decompile succeeds', async () => {
    // Exercises the full LUT path: a tx with a real LUT reference is fetched,
    // the LUT account is returned, decompile succeeds, and the ATA is injected.
    // (#519 r-N NeO should-fix #4 — LUT path actually exercised.)
    const lutKey = Keypair.generate().publicKey
    const lutAddress = Keypair.generate().publicKey
    const txData = buildLutLifiTx(lutKey, lutAddress)

    const lut = new AddressLookupTableAccount({
      key: lutKey,
      state: {
        deactivationSlot: BigInt('18446744073709551615'),
        lastExtendedSlot: 0,
        lastExtendedSlotStartIndex: 0,
        authority: undefined,
        addresses: [lutAddress],
      },
    })

    const mockClient = {
      getAccountInfo: vi.fn().mockResolvedValueOnce(MOCK_MINT_INFO).mockResolvedValueOnce(null),
      getAddressLookupTable: vi.fn().mockResolvedValue({ value: lut }),
    }
    vi.mocked(getSolanaClient).mockReturnValue(mockClient as any)

    const result = await injectSolanaAtaIfMissing(txData, USDC_MINT, owner, payer)

    expect(result.ataInjected).toBe(true)
    expect(mockClient.getAddressLookupTable).toHaveBeenCalledWith(lutKey)
  })

  it('throws when the owner address is off the ed25519 curve (PDA or invalid key)', async () => {
    // Off-curve addresses (PDAs) should not be used as swap destinations in
    // Vultisig LiFi flows. Passing one with allowOwnerOffCurve silently would
    // derive an ATA the user can't sign for. (#519 r-N NeO should-fix #2.)
    //
    // We construct an off-curve public key by finding a PDA (createProgramAddress
    // always produces an off-curve address by definition).
    const programId = SystemProgram.programId
    const pdaOwner = PublicKey.findProgramAddressSync([Buffer.from('test')], programId)[0]
    expect(PublicKey.isOnCurve(pdaOwner.toBytes())).toBe(false)

    const mockClient = {
      getAccountInfo: vi.fn().mockResolvedValueOnce(MOCK_MINT_INFO),
      getAddressLookupTable: vi.fn(),
    }
    vi.mocked(getSolanaClient).mockReturnValue(mockClient as any)

    await expect(injectSolanaAtaIfMissing(buildMinimalLifiTx(), USDC_MINT, pdaOwner.toBase58(), payer)).rejects.toThrow(
      /off the ed25519 curve/
    )
  })
})
