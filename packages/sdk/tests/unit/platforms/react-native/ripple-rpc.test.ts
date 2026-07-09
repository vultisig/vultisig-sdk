/**
 * Regression test for the `actNotFound` handling in getXrpAccountInfo.
 *
 * XRPL's `account_info` RPC returns `status: "error", error: "actNotFound"`
 * for unfunded addresses — a normal / expected case. The previous
 * implementation threw inside `rippleCall` on any `status === "error"`, so
 * the `funded: false` branch in `getXrpAccountInfo` was unreachable and
 * `getXrpBalance` exploded instead of returning `"0"`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getXrpAccountInfo,
  getXrpBalance,
  submitXrpTx,
  XrpSubmitRejectedError,
} from '../../../../src/platforms/react-native/chains/ripple/rpc'

const RPC_URL = 'https://xrplcluster.com'
const UNFUNDED = 'rUnfundedAccount1234567890abcdef'
const FUNDED = 'rFundedAccount1234567890abcdef'
const TX_HASH = 'ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890'

function mockFetchOnce(body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }))
  )
}

function mockFetchSequence(bodies: unknown[]): void {
  const fn = vi.fn()
  for (const body of bodies) {
    fn.mockImplementationOnce(async () => new Response(JSON.stringify(body), { status: 200 }))
  }
  vi.stubGlobal('fetch', fn)
}

describe('ripple/rpc — account_info error handling', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns funded:false for actNotFound instead of throwing', async () => {
    mockFetchOnce({
      result: {
        status: 'error',
        error: 'actNotFound',
        error_message: 'Account not found.',
      },
    })

    const info = await getXrpAccountInfo(UNFUNDED, RPC_URL)
    expect(info).toEqual({
      address: UNFUNDED,
      sequence: 0,
      balanceDrops: '0',
      flags: 0,
      funded: false,
    })
  })

  it('getXrpBalance returns "0" for unfunded account', async () => {
    mockFetchOnce({
      result: {
        status: 'error',
        error: 'actNotFound',
        error_message: 'Account not found.',
      },
    })

    const bal = await getXrpBalance(UNFUNDED, RPC_URL)
    expect(bal).toBe('0')
  })

  it('returns full info with funded:true for a funded account', async () => {
    mockFetchOnce({
      result: {
        status: 'success',
        account_data: {
          Account: FUNDED,
          Balance: '25000000',
          Flags: 0,
          Sequence: 42,
        },
      },
    })

    const info = await getXrpAccountInfo(FUNDED, RPC_URL)
    expect(info).toEqual({
      address: FUNDED,
      sequence: 42,
      balanceDrops: '25000000',
      flags: 0,
      funded: true,
    })
  })

  it('still throws on genuinely unexpected protocol errors (e.g. rpcInvalidParams)', async () => {
    mockFetchOnce({
      result: {
        status: 'error',
        error: 'invalidParams',
        error_message: 'missing field account',
      },
    })

    await expect(getXrpAccountInfo(FUNDED, RPC_URL)).rejects.toThrow(/invalidParams/)
  })
})

/**
 * Regression tests for XRP-02: `submitXrpTx` used to throw a generic error
 * for any non-`tesSUCCESS`/`terQUEUED` engine result, including `tec*`
 * codes — which mean the tx WAS applied on-ledger (fee + sequence
 * consumed) even though the requested operation itself failed. A caller
 * that treated that generic error as "never broadcast" and retried with
 * the same sequence risked a `tefPAST_SEQ` (or a fund-loss race on a fee
 * change). `submitXrpTx` now verifies on-ledger inclusion by hash before
 * deciding what to surface.
 */
describe('ripple/rpc — submitXrpTx tec* on-ledger verification (XRP-02)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('resolves tesSUCCESS without a ledger lookup', async () => {
    mockFetchSequence([
      {
        result: {
          engine_result: 'tesSUCCESS',
          engine_result_message: 'The transaction was applied.',
          tx_json: { hash: TX_HASH },
          accepted: true,
        },
      },
    ])

    const result = await submitXrpTx('DEADBEEF', RPC_URL)
    expect(result).toEqual({
      engineResult: 'tesSUCCESS',
      engineResultMessage: 'The transaction was applied.',
      txHash: TX_HASH,
      accepted: true,
    })
  })

  it('a validated tecUNFUNDED_PAYMENT throws a typed on-ledger-consumed error, not a generic one', async () => {
    mockFetchSequence([
      {
        result: {
          engine_result: 'tecUNFUNDED_PAYMENT',
          engine_result_message: 'Insufficient funds.',
          tx_json: { hash: TX_HASH },
        },
      },
      {
        result: {
          validated: true,
          meta: { TransactionResult: 'tecUNFUNDED_PAYMENT' },
        },
      },
    ])

    const rejection = await submitXrpTx('DEADBEEF', RPC_URL).catch((e: unknown) => e)
    expect(rejection).toBeInstanceOf(XrpSubmitRejectedError)
    const error = rejection as XrpSubmitRejectedError
    expect(error.reason).toBe('on-ledger-tec')
    expect(error.engineResult).toBe('tecUNFUNDED_PAYMENT')
    expect(error.txHash).toBe(TX_HASH)
    expect(error.message).toMatch(/applied on-ledger.*fee \+ sequence consumed.*Do not retry with the same sequence/s)
  })

  it('a validated tecPATH_DRY throws the same typed on-ledger-consumed error', async () => {
    mockFetchSequence([
      {
        result: {
          engine_result: 'tecPATH_DRY',
          engine_result_message: 'Path could not send partial amount.',
          tx_json: { hash: TX_HASH },
        },
      },
      {
        result: {
          validated: true,
          meta: { TransactionResult: 'tecPATH_DRY' },
        },
      },
    ])

    const rejection = await submitXrpTx('DEADBEEF', RPC_URL).catch((e: unknown) => e)
    expect(rejection).toBeInstanceOf(XrpSubmitRejectedError)
    const error = rejection as XrpSubmitRejectedError
    expect(error.reason).toBe('on-ledger-tec')
    expect(error.engineResult).toBe('tecPATH_DRY')
  })

  it('a tec* result not yet validated (still pending) is not misclassified as a hard on-ledger failure', async () => {
    mockFetchSequence([
      {
        result: {
          engine_result: 'tecUNFUNDED_PAYMENT',
          engine_result_message: 'Insufficient funds.',
          tx_json: { hash: TX_HASH },
        },
      },
      {
        // Found by hash, but the ledger it's in hasn't validated yet —
        // XRPL ledgers close ~every 4s, so this is the expected state for
        // a lookup performed immediately after submit.
        result: {
          validated: false,
        },
      },
    ])

    const rejection = await submitXrpTx('DEADBEEF', RPC_URL).catch((e: unknown) => e)
    expect(rejection).toBeInstanceOf(XrpSubmitRejectedError)
    const error = rejection as XrpSubmitRejectedError
    expect(error.reason).toBe('pending-validation')
    expect(error.reason).not.toBe('on-ledger-tec')
    expect(error.message).toMatch(/has not reached a validated ledger yet/)
  })

  it('a validated tec* result that canonical-ordering-flipped to tesSUCCESS resolves as success, not a thrown error', async () => {
    // The preliminary `tec*` from `submit` is provisional — XRPL applies
    // transactions in canonical order within a ledger, so an earlier tx
    // (e.g. funding the account) can make this one succeed by the time it
    // validates. Trusting the original submit result here would wrongly
    // report a failed transfer that actually completed.
    mockFetchSequence([
      {
        result: {
          engine_result: 'tecUNFUNDED_PAYMENT',
          engine_result_message: 'Insufficient funds.',
          tx_json: { hash: TX_HASH },
        },
      },
      {
        result: {
          validated: true,
          meta: { TransactionResult: 'tesSUCCESS' },
        },
      },
    ])

    const result = await submitXrpTx('DEADBEEF', RPC_URL)
    expect(result.engineResult).toBe('tesSUCCESS')
    expect(result.accepted).toBe(true)
    expect(result.txHash).toBe(TX_HASH)
  })

  it('a tec* result whose ledger lookup errors (txnNotFound) is NOT claimed safe to retry — distinct reason from a real preflight rejection', async () => {
    mockFetchSequence([
      {
        result: {
          engine_result: 'tecUNFUNDED_PAYMENT',
          engine_result_message: 'Insufficient funds.',
          tx_json: { hash: TX_HASH },
        },
      },
      {
        result: {
          status: 'error',
          error: 'txnNotFound',
          error_message: 'Transaction not found.',
        },
      },
    ])

    const rejection = await submitXrpTx('DEADBEEF', RPC_URL).catch((e: unknown) => e)
    expect(rejection).toBeInstanceOf(XrpSubmitRejectedError)
    const error = rejection as XrpSubmitRejectedError
    expect(error.reason).toBe('tec-lookup-unconfirmed')
    expect(error.reason).not.toBe('not-on-ledger')
    expect(error.message).toMatch(/could not be confirmed on-ledger/)
    expect(error.message).not.toMatch(/safe to retry/i)
  })

  it('a non-tec* rejection (e.g. temMALFORMED) throws directly without a ledger lookup', async () => {
    mockFetchSequence([
      {
        result: {
          engine_result: 'temMALFORMED',
          engine_result_message: 'Malformed transaction.',
        },
      },
    ])

    const rejection = await submitXrpTx('DEADBEEF', RPC_URL).catch((e: unknown) => e)
    expect(rejection).toBeInstanceOf(XrpSubmitRejectedError)
    const error = rejection as XrpSubmitRejectedError
    expect(error.reason).toBe('not-on-ledger')
    expect(error.message).toMatch(/XRP submit rejected: temMALFORMED/)
  })
})
