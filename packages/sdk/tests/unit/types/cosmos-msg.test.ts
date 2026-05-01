import { describe, expect, it } from 'vitest'

import { CosmosMsgType } from '../../../src/types/cosmos-msg'

describe('CosmosMsgType', () => {
  it('should have correct MsgSend value', () => {
    expect(CosmosMsgType.MsgSend).toBe('cosmos-sdk/MsgSend')
  })

  it('should have correct ThorchainMsgSend value', () => {
    expect(CosmosMsgType.ThorchainMsgSend).toBe('thorchain/MsgSend')
  })

  it('should have correct MsgExecuteContract value', () => {
    expect(CosmosMsgType.MsgExecuteContract).toBe('wasm/MsgExecuteContract')
  })

  it('should have correct URL-style message types', () => {
    expect(CosmosMsgType.MsgExecuteContractUrl).toBe('/cosmwasm.wasm.v1.MsgExecuteContract')
    expect(CosmosMsgType.MsgTransferUrl).toBe('/ibc.applications.transfer.v1.MsgTransfer')
    expect(CosmosMsgType.MsgSendUrl).toBe('/cosmos.bank.v1beta1.MsgSend')
  })

  it('should have correct THORChain deposit types', () => {
    expect(CosmosMsgType.ThorchainMsgDeposit).toBe('thorchain/MsgDeposit')
    expect(CosmosMsgType.ThorchainMsgDepositUrl).toBe('/types.MsgDeposit')
    expect(CosmosMsgType.ThorchainMsgSendUrl).toBe('/types.MsgSend')
  })

  it('should have correct THORChain leave pool types', () => {
    expect(CosmosMsgType.ThorchainMsgLeavePool).toBe('thorchain/MsgLeavePool')
    expect(CosmosMsgType.ThorchainMsgLeavePoolUrl).toBe('/thorchain.v1.MsgLeavePool')
  })

  it('should have correct cosmos staking + distribution module types', () => {
    expect(CosmosMsgType.MsgDelegateUrl).toBe('/cosmos.staking.v1beta1.MsgDelegate')
    expect(CosmosMsgType.MsgUndelegateUrl).toBe('/cosmos.staking.v1beta1.MsgUndelegate')
    expect(CosmosMsgType.MsgBeginRedelegateUrl).toBe('/cosmos.staking.v1beta1.MsgBeginRedelegate')
    expect(CosmosMsgType.MsgWithdrawDelegatorRewardUrl).toBe('/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward')
  })

  it('should have exactly 15 message types', () => {
    expect(Object.keys(CosmosMsgType)).toHaveLength(15)
  })
})
