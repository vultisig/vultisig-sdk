/**
 * Regression: buildCosmosSendTx must use feeDenom (not denom) in AuthInfo
 * when a separate fee denom is provided.
 *
 * Issue vultisig-sdk#624: TerraClassic USTC (uusd) sends were charging gas
 * fees in USTC because AuthInfo's fee.amount[0].denom matched opts.denom.
 * On TerraClassic fees must be paid in LUNC (uluna), not USTC.
 */
import { AuthInfo } from 'cosmjs-types/cosmos/tx/v1beta1/tx'
import { describe, expect, it } from 'vitest'

import { buildCosmosSendTx } from '../../../../src/platforms/react-native/chains/cosmos/tx'

const BASE_OPTS = {
  chainName: 'TerraClassic',
  chainId: 'columbus-5',
  fromAddress: 'terra1lmmtpndftpk57js8s4dsxh54q6qhh6nd9kamdj',
  toAddress: 'terra10mtp3kjs9jh05cp288alz35308jmr6arjfr43r',
  amount: '1000000',
  denom: 'uusd', // USTC — send denom
  feeAmount: '1500000',
  gasLimit: 2_000_000,
  sequence: 7,
  accountNumber: 42,
  pubKeyBytes: new Uint8Array(33).fill(2),
  memo: '',
}

describe('buildCosmosSendTx feeDenom (sdk#624, sdk#697)', () => {
  it('uses feeDenom in AuthInfo fee when explicitly set', () => {
    const result = buildCosmosSendTx({ ...BASE_OPTS, feeDenom: 'uluna' })
    const authInfo = AuthInfo.decode(result.authInfoBytes)
    const feeCoin = authInfo.fee?.amount[0]
    expect(feeCoin?.denom).toBe('uluna')
    expect(feeCoin?.amount).toBe('1500000')
  })

  it('defaults to the chain fee denom when feeDenom is absent', () => {
    const result = buildCosmosSendTx(BASE_OPTS)
    const authInfo = AuthInfo.decode(result.authInfoBytes)
    const feeCoin = authInfo.fee?.amount[0]
    expect(feeCoin?.denom).toBe('uluna')
  })

  it('falls back to denom for unknown custom chain names', () => {
    const result = buildCosmosSendTx({ ...BASE_OPTS, chainName: 'CustomCosmos' })
    const authInfo = AuthInfo.decode(result.authInfoBytes)
    const feeCoin = authInfo.fee?.amount[0]
    expect(feeCoin?.denom).toBe('uusd')
  })

  it('native LUNC send: fee and send both in uluna (no regression)', () => {
    const result = buildCosmosSendTx({
      ...BASE_OPTS,
      denom: 'uluna',
      feeDenom: 'uluna',
      feeAmount: '100000000',
    })
    const authInfo = AuthInfo.decode(result.authInfoBytes)
    expect(authInfo.fee?.amount[0]?.denom).toBe('uluna')
  })
})
