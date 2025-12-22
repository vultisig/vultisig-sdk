/**
 * Command exports - all command logic for CLI and Interactive Shell
 */

// Balance commands
export type { BalanceOptions, PortfolioOptions } from './balance'
export { executeBalance, executePortfolio } from './balance'

// Chain commands
export type { ChainsOptions } from './chains'
export { executeAddresses, executeChains } from './chains'

// Token commands
export type { AddTokenOptions, TokensOptions } from './tokens'
export { addToken, executeTokens, listTokens, removeToken } from './tokens'

// Transaction commands
export { executeSend, sendTransaction } from './transaction'

// Vault management commands
export type { FastVaultOptions, SecureVaultOptions } from './vault-management'
export {
  executeCreateFast,
  executeCreateSecure,
  executeExport,
  executeImport,
  executeInfo,
  executeRename,
  executeSwitch,
  executeVaults,
  executeVerify,
} from './vault-management'

// Swap commands
export type { SwapOptions, SwapQuoteOptions } from './swap'
export { executeSwap, executeSwapChains, executeSwapQuote } from './swap'

// Settings commands
export type { AddressBookEntry, AddressBookOptions } from './settings'
export { executeAddressBook, executeCurrency, executeServer } from './settings'
