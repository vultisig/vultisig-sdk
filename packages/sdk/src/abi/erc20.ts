/**
 * ERC-20 Token Standard ABI.
 *
 * Re-exports viem's built-in erc20Abi which is already used across
 * the core packages. For simple ERC-20 approvals, you can still use
 * the built-in erc20ApprovePayload with prepareSendTx().
 */
export { erc20Abi as ERC20_ABI } from 'viem'
