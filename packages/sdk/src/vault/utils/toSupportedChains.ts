import { Chain } from '@vultisig/core-chain/Chain'

const supportedChains = new Set<string>(Object.values(Chain))

/**
 * Narrows persisted `VaultData.chains` (an unvalidated `string[]`) to chains this
 * build still supports, dropping any the SDK has since removed.
 *
 * Without this, a chain retired from {@link Chain} survives in storage and is cast
 * straight back into `_userChains`, where every registry lookup keyed on it
 * (`chainFeeCoin`, `cosmosRpcUrl`, `chainRegistry`, …) yields `undefined` and
 * throws at the point of use rather than being ignored here. Every path that
 * restores a vault's chain list must go through it, `fromStorage` included.
 */
export const toSupportedChains = (chains: readonly string[]): Chain[] =>
  chains.filter((chain): chain is Chain => supportedChains.has(chain))
