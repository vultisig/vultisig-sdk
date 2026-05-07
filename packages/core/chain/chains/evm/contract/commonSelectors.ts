/**
 * Static lookup table of common EVM function selectors with human-readable
 * action labels.
 *
 * Layering for transaction-intent display:
 *
 *   1. Blockaid simulation (security/blockaid/...) — primary source. Provides
 *      semantic asset diffs, approval exposures, and high-level
 *      `transaction_actions` (`'swap'`, `'approval'`, `'mint'`, ...). Run by
 *      consumers (e.g. the Windows extension UI) before this layer. Note that
 *      Blockaid does NOT decode the called function's name/arguments — only
 *      its observable effects.
 *
 *   2. This static selector table — offline fast-path used by
 *      `getEvmContractCallInfo` when the caller still needs the function
 *      name + decoded arguments (e.g. Blockaid is unavailable, the chain is
 *      unsupported, or the UI shows the raw call alongside Blockaid's
 *      summary). Resolves instantly with no network round-trip.
 *
 *   3. 4byte directory API (`getEvmContractCallSignatures`) — final fallback
 *      for selectors not in the static table.
 *
 * Selectors are the first 4 bytes of keccak256 over the canonical function
 * signature (no spaces, no parameter names). Lowercase hex with `0x` prefix.
 */

export type EvmActionLabel =
  | 'Token Approval'
  | 'Token Transfer'
  | 'Token Swap'
  | 'Cross-Chain Swap'
  | 'Wrap ETH'
  | 'Unwrap WETH'
  | 'Stake'
  | 'Claim Rewards'
  | 'Exit Stake'
  | 'Lending Supply'
  | 'Lending Withdraw'
  | 'NFT Transfer'
  | 'Multicall'

export type CommonEvmSelector = {
  signature: string
  actionLabel: EvmActionLabel
}

export const commonEvmSelectors: Readonly<Record<string, CommonEvmSelector>> = {
  // ERC-20 approvals
  '0x095ea7b3': {
    signature: 'approve(address,uint256)',
    actionLabel: 'Token Approval',
  },
  '0x39509351': {
    signature: 'increaseAllowance(address,uint256)',
    actionLabel: 'Token Approval',
  },
  '0xa457c2d7': {
    signature: 'decreaseAllowance(address,uint256)',
    actionLabel: 'Token Approval',
  },
  '0xd505accf': {
    signature: 'permit(address,address,uint256,uint256,uint8,bytes32,bytes32)',
    actionLabel: 'Token Approval',
  },
  // ERC-721 / ERC-1155 marketplace approval (OpenSea, Blur, Magic Eden)
  '0xa22cb465': {
    signature: 'setApprovalForAll(address,bool)',
    actionLabel: 'Token Approval',
  },

  // ERC-20 transfers
  '0xa9059cbb': {
    signature: 'transfer(address,uint256)',
    actionLabel: 'Token Transfer',
  },
  '0x23b872dd': {
    signature: 'transferFrom(address,address,uint256)',
    actionLabel: 'Token Transfer',
  },

  // Uniswap V2 swaps
  '0x38ed1739': {
    signature: 'swapExactTokensForTokens(uint256,uint256,address[],address,uint256)',
    actionLabel: 'Token Swap',
  },
  '0x7ff36ab5': {
    signature: 'swapExactETHForTokens(uint256,address[],address,uint256)',
    actionLabel: 'Token Swap',
  },
  '0x18cbafe5': {
    signature: 'swapExactTokensForETH(uint256,uint256,address[],address,uint256)',
    actionLabel: 'Token Swap',
  },
  '0xfb3bdb41': {
    signature: 'swapETHForExactTokens(uint256,address[],address,uint256)',
    actionLabel: 'Token Swap',
  },
  '0x8803dbee': {
    signature: 'swapTokensForExactTokens(uint256,uint256,address[],address,uint256)',
    actionLabel: 'Token Swap',
  },
  '0x4a25d94a': {
    signature: 'swapTokensForExactETH(uint256,uint256,address[],address,uint256)',
    actionLabel: 'Token Swap',
  },
  '0x5c11d795': {
    signature: 'swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)',
    actionLabel: 'Token Swap',
  },
  '0xb6f9de95': {
    signature: 'swapExactETHForTokensSupportingFeeOnTransferTokens(uint256,address[],address,uint256)',
    actionLabel: 'Token Swap',
  },

  // Uniswap V3 swaps
  '0x414bf389': {
    signature: 'exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))',
    actionLabel: 'Token Swap',
  },
  '0xc04b8d59': {
    signature: 'exactInput((bytes,address,uint256,uint256,uint256))',
    actionLabel: 'Token Swap',
  },

  // Uniswap Universal Router
  '0x3593564c': {
    signature: 'execute(bytes,bytes[],uint256)',
    actionLabel: 'Token Swap',
  },

  // THORChain Router (cross-chain native swaps)
  '0x44bc937b': {
    signature: 'depositWithExpiry(address,address,uint256,string,uint256)',
    actionLabel: 'Cross-Chain Swap',
  },

  // Aave V3 lending
  '0x617ba037': {
    signature: 'supply(address,uint256,address,uint16)',
    actionLabel: 'Lending Supply',
  },
  '0x69328dec': {
    signature: 'withdraw(address,uint256,address)',
    actionLabel: 'Lending Withdraw',
  },

  // WETH wrap / unwrap
  '0xd0e30db0': {
    signature: 'deposit()',
    actionLabel: 'Wrap ETH',
  },
  '0x2e1a7d4d': {
    signature: 'withdraw(uint256)',
    actionLabel: 'Unwrap WETH',
  },

  // Synthetix-style staking
  '0xa694fc3a': {
    signature: 'stake(uint256)',
    actionLabel: 'Stake',
  },
  '0x3d18b912': {
    signature: 'getReward()',
    actionLabel: 'Claim Rewards',
  },
  '0xe9fad8ee': {
    signature: 'exit()',
    actionLabel: 'Exit Stake',
  },

  // ERC-721 / ERC-1155 transfers
  '0x42842e0e': {
    signature: 'safeTransferFrom(address,address,uint256)',
    actionLabel: 'NFT Transfer',
  },
  '0xb88d4fde': {
    signature: 'safeTransferFrom(address,address,uint256,bytes)',
    actionLabel: 'NFT Transfer',
  },
  '0xf242432a': {
    signature: 'safeTransferFrom(address,address,uint256,uint256,bytes)',
    actionLabel: 'NFT Transfer',
  },
  '0x2eb2c2d6': {
    signature: 'safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)',
    actionLabel: 'NFT Transfer',
  },

  // Aggregator / batched calls
  '0xac9650d8': {
    signature: 'multicall(bytes[])',
    actionLabel: 'Multicall',
  },
}

export const lookupCommonEvmSelector = (hexSignature: string): CommonEvmSelector | null => {
  return commonEvmSelectors[hexSignature.toLowerCase()] ?? null
}
