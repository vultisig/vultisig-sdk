/**
 * Uniswap Universal Router command byte mask — the high bit is an "allow
 * revert" flag, leaving the lower 6 bits as the command identifier.
 */
export const COMMAND_TYPE_MASK = 0x3f

/**
 * Universal Router command opcodes we care about for aggregate swap intent.
 * Source: https://github.com/Uniswap/universal-router/blob/main/contracts/libraries/Commands.sol
 */
export const URCommand = {
  V3_SWAP_EXACT_IN: 0x00,
  V3_SWAP_EXACT_OUT: 0x01,
  V2_SWAP_EXACT_IN: 0x08,
  V2_SWAP_EXACT_OUT: 0x09,
  WRAP_ETH: 0x0b,
  UNWRAP_WETH: 0x0c,
  V4_SWAP: 0x10,
} as const

/**
 * V4 action opcodes encoded inside a V4_SWAP command's `actions` byte string.
 * Source: https://github.com/Uniswap/v4-periphery/blob/main/src/libraries/Actions.sol
 */
export const V4Action = {
  SWAP_EXACT_IN_SINGLE: 0x06,
  SWAP_EXACT_IN: 0x07,
  SWAP_EXACT_OUT_SINGLE: 0x08,
  SWAP_EXACT_OUT: 0x09,
} as const

/**
 * Sentinel address V4 and this decoder use to represent native ETH. Zero
 * address matches the Currency.unwrap convention in v4-core.
 */
export const NATIVE_TOKEN_ADDRESS =
  '0x0000000000000000000000000000000000000000'

/**
 * Sentinel sometimes passed as amountIn to signal "use the router's full
 * balance of the input token". Shows up in both V3/V2 and V4 swaps.
 */
export const CONTRACT_BALANCE_SENTINEL =
  1n << 255n
