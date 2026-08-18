/**
 * Backwards-compatible Uniswap module path for the shared DEX ERC-20 readers.
 * Keeping these as re-exports ensures V2 and V3 enforce one metadata contract.
 */
export { decodeAddress, decodeBytes32String, readDecimals, readSymbol } from '../_erc20'
