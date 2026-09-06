import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  verifyBroadcastByHash: vi.fn(),
}))

vi.mock('@vultisig/core-chain/chains/ripple/client', () => ({
  getRippleClient: () => ({
    request: mocks.request,
  }),
}))

vi.mock('../verifyBroadcastByHash', () => ({
  verifyBroadcastByHash: mocks.verifyBroadcastByHash,
}))

import { OtherChain } from '../../../Chain'
import { BroadcastErrorCode } from '../resolver'
import { broadcastRippleTx, isRippleInFlightEngineResult } from './ripple'

describe('broadcastRippleTx', () => {
  const tx = { encoded: new Uint8Array([0x12, 0x00, 0x00]) } as any
  const chain = OtherChain.Ripple

  beforeEach(() => {
    vi.clearAllMocks()
  })

  function submitResponse(engine_result: string, engine_result_code: number): unknown {
    return {
      result: {
        engine_result,
        engine_result_code,
        engine_result_message: `${engine_result} (test fixture)`,
        tx_json: { hash: 'DEADBEEF' },
      },
    }
  }

  describe('engine-level results', () => {
    it('returns an accepted result on tesSUCCESS (engine_result_code === 0)', async () => {
      mocks.request.mockResolvedValue(submitResponse('tesSUCCESS', 0))

      await expect(broadcastRippleTx({ chain, tx })).resolves.toEqual({
        status: 'accepted',
        finality: 'pending',
        txHash: 'DEADBEEF',
      })

      expect(mocks.request).toHaveBeenCalledWith({
        command: 'submit',
        tx_blob: expect.any(String),
      })
      // Critical: no verify-by-hash on the happy path.
      expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
    })

    it('returns a definitive failure on temREDUNDANT (self-send)', async () => {
      // Regression for the silent-broadcast bug: previously every non-success
      // engine result was caught + sent through verifyBroadcastByHash, which
      // swallows on `getRippleTxStatus` returning 'pending' for txnNotFound.
      // Users saw "Transaction broadcast: HASH" for txs the chain refused.
      mocks.request.mockResolvedValue(submitResponse('temREDUNDANT', -275))

      await expect(broadcastRippleTx({ chain, tx })).resolves.toMatchObject({
        status: 'failed',
        code: BroadcastErrorCode.Rejected,
        retryable: false,
        cause: expect.objectContaining({ message: expect.stringMatching(/temREDUNDANT/) }),
      })

      // verifyBroadcastByHash MUST NOT be called for authoritative
      // preflight rejections — engine codes are the chain's "no".
      expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
    })

    it('returns a definitive failure on tecNO_DST_INSUF_XRP (claim-class failure)', async () => {
      mocks.request.mockResolvedValue(submitResponse('tecNO_DST_INSUF_XRP', 125))

      await expect(broadcastRippleTx({ chain, tx })).resolves.toMatchObject({
        status: 'failed',
        code: BroadcastErrorCode.Rejected,
        retryable: false,
        cause: expect.objectContaining({ message: expect.stringMatching(/tecNO_DST_INSUF_XRP/) }),
      })
      expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
    })

    it('returns a definitive failure on temBAD_FEE (malformed)', async () => {
      mocks.request.mockResolvedValue(submitResponse('temBAD_FEE', -298))

      await expect(broadcastRippleTx({ chain, tx })).resolves.toMatchObject({
        status: 'failed',
        code: BroadcastErrorCode.Rejected,
        retryable: false,
        cause: expect.objectContaining({ message: expect.stringMatching(/temBAD_FEE/) }),
      })
      expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
    })

    it('returns a definitive result on terPRE_SEQ (retry-later — not a peer race)', async () => {
      // terPRE_SEQ means our sequence is ahead of the account's current
      // sequence; the gap might fill in later. This is NOT a peer-race
      // duplicate (which is tefALREADY / tefPAST_SEQ). Propagate so the
      // caller knows to retry with a fresh sequence.
      mocks.request.mockResolvedValue(submitResponse('terPRE_SEQ', -396))

      await expect(broadcastRippleTx({ chain, tx })).resolves.toMatchObject({
        status: 'failed',
        code: BroadcastErrorCode.Rejected,
        retryable: false,
        cause: expect.objectContaining({ message: expect.stringMatching(/terPRE_SEQ/) }),
      })
      expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
    })

    it('returns accepted on terQUEUED because XRPL accepted the tx into the queue', async () => {
      mocks.request.mockResolvedValue(submitResponse('terQUEUED', -89))

      await expect(broadcastRippleTx({ chain, tx })).resolves.toEqual({
        status: 'accepted',
        finality: 'pending',
        txHash: 'DEADBEEF',
      })

      expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
    })

    it('classifies only terQUEUED as an in-flight retry-later result', () => {
      expect(isRippleInFlightEngineResult('terQUEUED')).toBe(true)
      expect(isRippleInFlightEngineResult('terPRE_SEQ')).toBe(false)
      expect(isRippleInFlightEngineResult('tesSUCCESS')).toBe(false)
    })

    it('retains a useful cause including engine_result + engine_result_message', async () => {
      mocks.request.mockResolvedValue({
        result: {
          engine_result: 'temINVALID_FLAG',
          engine_result_code: -283,
          engine_result_message: 'The transaction has an invalid flag.',
          tx_json: { hash: 'DEADBEEF' },
        },
      })

      await expect(broadcastRippleTx({ chain, tx })).resolves.toMatchObject({
        status: 'failed',
        cause: expect.objectContaining({
          message: expect.stringMatching(
            /Ripple broadcast rejected: temINVALID_FLAG — The transaction has an invalid flag\./
          ),
        }),
      })
    })
  })

  describe('peer-race duplicate-detection results', () => {
    // These ARE legitimate cases for verify-by-hash: in MPC keysign multiple
    // devices broadcast the same signed tx; the slow ones get a duplicate
    // rejection from XRPL even though the fast one's broadcast landed it.
    // Verify-by-hash confirms the tx is on-chain before swallowing the
    // duplicate error.

    it('routes tefALREADY through verifyBroadcastByHash (MPC peer-race recovery)', async () => {
      mocks.request.mockResolvedValue(submitResponse('tefALREADY', -198))
      mocks.verifyBroadcastByHash.mockResolvedValue('verified-hash')

      await expect(broadcastRippleTx({ chain, tx })).resolves.toMatchObject({
        status: 'accepted',
        txHash: 'verified-hash',
      })

      expect(mocks.verifyBroadcastByHash).toHaveBeenCalledTimes(1)
      expect(mocks.verifyBroadcastByHash).toHaveBeenCalledWith({
        chain,
        tx,
        error: expect.objectContaining({ message: expect.stringMatching(/tefALREADY/) }),
      })
    })

    it('routes tefPAST_SEQ through verifyBroadcastByHash (peer consumed our sequence)', async () => {
      mocks.request.mockResolvedValue(submitResponse('tefPAST_SEQ', -190))
      mocks.verifyBroadcastByHash.mockResolvedValue('verified-hash')

      await expect(broadcastRippleTx({ chain, tx })).resolves.toMatchObject({
        status: 'accepted',
        txHash: 'verified-hash',
      })

      expect(mocks.verifyBroadcastByHash).toHaveBeenCalledTimes(1)
    })

    it('propagates verify-by-hash throw when the tx is genuinely not on-chain', async () => {
      // verifyBroadcastByHash re-throws when the chain confirms the tx
      // is NOT present (i.e. duplicate-detection was wrong; the tx really
      // failed). The broadcast resolver should let that throw bubble up.
      mocks.request.mockResolvedValue(submitResponse('tefALREADY', -198))
      const verifyError = new Error('Ripple broadcast rejected: tefALREADY — fixture')
      mocks.verifyBroadcastByHash.mockRejectedValue(verifyError)

      await expect(broadcastRippleTx({ chain, tx })).resolves.toEqual({
        status: 'failed',
        code: BroadcastErrorCode.Rejected,
        retryable: false,
        cause: verifyError,
      })
    })
  })

  describe('RPC-level errors', () => {
    it('routes network errors through verifyBroadcastByHash', async () => {
      // Network blip / connection drop before XRPL responds. Another MPC
      // peer's broadcast may have landed the tx — verify before failing.
      const networkError = new Error('ECONNRESET')
      mocks.request.mockRejectedValue(networkError)
      mocks.verifyBroadcastByHash.mockResolvedValue('verified-hash')

      await expect(broadcastRippleTx({ chain, tx })).resolves.toMatchObject({
        status: 'accepted',
        txHash: 'verified-hash',
      })

      expect(mocks.verifyBroadcastByHash).toHaveBeenCalledTimes(1)
      expect(mocks.verifyBroadcastByHash).toHaveBeenCalledWith({
        chain,
        tx,
        error: networkError,
      })
    })

    it('propagates verify-by-hash throw on network error when tx is genuinely missing', async () => {
      const networkError = new Error('connection reset')
      mocks.request.mockRejectedValue(networkError)
      const verifyError = new Error('verified: tx not on-chain')
      mocks.verifyBroadcastByHash.mockRejectedValue(verifyError)

      await expect(broadcastRippleTx({ chain, tx })).resolves.toEqual({
        status: 'failed',
        code: BroadcastErrorCode.Transport,
        retryable: true,
        cause: verifyError,
      })
    })

    it('does not label an ambiguous local request failure as retryable', async () => {
      const localError = new TypeError('Cannot read properties of undefined')
      mocks.request.mockRejectedValue(localError)
      mocks.verifyBroadcastByHash.mockRejectedValue(localError)

      await expect(broadcastRippleTx({ chain, tx })).resolves.toEqual({
        status: 'failed',
        code: BroadcastErrorCode.Rejected,
        retryable: false,
        cause: localError,
      })
    })
  })

  describe('malformed submit responses', () => {
    it('does not throw on missing engine_result_code (treat as success)', async () => {
      // Defensive: a malformed response shape (or future XRPL API change)
      // shouldn't cause a hard failure. Default to "no rejection signal,
      // assume tesSUCCESS" — the worst case is a tx that didn't actually
      // land, but the caller can re-query status. (Mirrors the pre-fix
      // semantics for missing engine_result_code.)
      mocks.request.mockResolvedValue({ result: { tx_json: { hash: 'X' } } })

      await expect(broadcastRippleTx({ chain, tx })).resolves.toEqual({
        status: 'accepted',
        finality: 'pending',
        txHash: 'X',
      })
      expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
    })

    it('handles missing engine_result_message gracefully in the error string', async () => {
      mocks.request.mockResolvedValue({
        result: {
          engine_result: 'temREDUNDANT',
          engine_result_code: -275,
          // no engine_result_message
          tx_json: { hash: 'X' },
        },
      })

      await expect(broadcastRippleTx({ chain, tx })).resolves.toMatchObject({
        status: 'failed',
        cause: expect.objectContaining({
          message: expect.stringMatching(/Ripple broadcast rejected: temREDUNDANT$/),
        }),
      })
    })
  })
})
