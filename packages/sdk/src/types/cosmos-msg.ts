/**
 * Cosmos message type constants for use with prepareSignAminoTx() and prepareSignDirectTx().
 *
 * SDK-owned copy of protocol-level constants. Includes standard Cosmos SDK messages,
 * CosmWasm execution, IBC transfers, and THORChain-specific messages.
 */
export const CosmosMsgType = {
  MsgSend: 'cosmos-sdk/MsgSend',
  ThorchainMsgSend: 'thorchain/MsgSend',
  MsgExecuteContract: 'wasm/MsgExecuteContract',
  MsgExecuteContractUrl: '/cosmwasm.wasm.v1.MsgExecuteContract',
  MsgTransferUrl: '/ibc.applications.transfer.v1.MsgTransfer',
  MsgSendUrl: '/cosmos.bank.v1beta1.MsgSend',
  ThorchainMsgDeposit: 'thorchain/MsgDeposit',
  ThorchainMsgDepositUrl: '/types.MsgDeposit',
  ThorchainMsgSendUrl: '/types.MsgSend',
  ThorchainMsgLeavePool: 'thorchain/MsgLeavePool',
  ThorchainMsgLeavePoolUrl: '/thorchain.v1.MsgLeavePool',
  // cosmos-sdk staking + distribution module (proto direct-sign typeUrls)
  MsgDelegateUrl: '/cosmos.staking.v1beta1.MsgDelegate',
  MsgUndelegateUrl: '/cosmos.staking.v1beta1.MsgUndelegate',
  MsgBeginRedelegateUrl: '/cosmos.staking.v1beta1.MsgBeginRedelegate',
  MsgWithdrawDelegatorRewardUrl: '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward',
} as const

export type CosmosMsgType = (typeof CosmosMsgType)[keyof typeof CosmosMsgType]
