export enum CosmosMsgType {
  MSG_SEND = 'cosmos-sdk/MsgSend',
  THORCHAIN_MSG_SEND = 'thorchain/MsgSend',
  MSG_EXECUTE_CONTRACT = 'wasm/MsgExecuteContract',
  MSG_EXECUTE_CONTRACT_URL = '/cosmwasm.wasm.v1.MsgExecuteContract',
  MSG_TRANSFER_URL = '/ibc.applications.transfer.v1.MsgTransfer',
  MSG_SEND_URL = '/cosmos.bank.v1beta1.MsgSend',
  THORCHAIN_MSG_DEPOSIT = 'thorchain/MsgDeposit',
  THORCHAIN_MSG_DEPOSIT_URL = '/types.MsgDeposit',
  THORCHAIN_MSG_LEAVE_POOL = 'thorchain/MsgLeavePool',
  THORCHAIN_MSG_LEAVE_POOL_URL = '/thorchain.v1.MsgLeavePool',
  THORCHAIN_MSG_SEND_URL = '/types.MsgSend',
  // cosmos-sdk staking + distribution module (proto direct-sign)
  MSG_DELEGATE_URL = '/cosmos.staking.v1beta1.MsgDelegate',
  MSG_UNDELEGATE_URL = '/cosmos.staking.v1beta1.MsgUndelegate',
  MSG_BEGIN_REDELEGATE_URL = '/cosmos.staking.v1beta1.MsgBeginRedelegate',
  MSG_WITHDRAW_DELEGATOR_REWARD_URL = '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward',
}
