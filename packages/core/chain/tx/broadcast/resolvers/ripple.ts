import { OtherChain } from '@vultisig/core-chain/Chain'
import { getRippleClient } from '@vultisig/core-chain/chains/ripple/client'

import { BroadcastTxResolver } from '../resolver'
import { verifyBroadcastByHash } from '../verifyBroadcastByHash'

export const broadcastRippleTx: BroadcastTxResolver<
  OtherChain.Ripple
> = async ({ chain, tx }) => {
  const client = await getRippleClient()

  try {
    // XRPL's `submit` resolves successfully even when the tx is rejected
    // (e.g. `tefPAST_SEQ` / `tefALREADY` for duplicates, `tec*` for fee or
    // balance failures). The rejection is carried in the response payload,
    // not via a thrown error — inspect `engine_result` / `engine_result_code`
    // so non-success outcomes still take the hash-verify path.
    const response = await client.request({
      command: 'submit',
      tx_blob: Buffer.from(tx.encoded).toString('hex'),
    })
    const engineResultCode = response?.result?.engine_result_code
    if (typeof engineResultCode === 'number' && engineResultCode !== 0) {
      const engineResult = response.result.engine_result ?? 'unknown'
      const engineResultMessage = response.result.engine_result_message ?? ''
      throw new Error(
        `Ripple broadcast rejected: ${engineResult}${engineResultMessage ? ` — ${engineResultMessage}` : ''}`
      )
    }
  } catch (error) {
    await verifyBroadcastByHash({ chain, tx, error })
  }
}
