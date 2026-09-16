import { Erc20ApprovePayload } from '../../types/vultisig/keysign/v1/erc20_approve_payload_pb'

/**
 * The amount of every `approve` transaction an `erc20ApprovePayload` stands
 * for, in nonce order: `'0'` first when `resetAllowanceFirst` asks for the
 * USDT-style zero reset, then the requested amount. Signers and broadcasters
 * share this so they agree on how many legs precede the main transaction.
 */
export const getErc20ApproveAmounts = ({ amount, resetAllowanceFirst }: Erc20ApprovePayload) =>
  resetAllowanceFirst ? ['0', amount] : [amount]
