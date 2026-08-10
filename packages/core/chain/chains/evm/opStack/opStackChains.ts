import { Chain, EvmChain } from '@vultisig/core-chain/Chain'
import { isOneOf } from '@vultisig/lib-utils/array/isOneOf'

/**
 * EVM chains that settle to Ethereum through the OP stack and therefore expose
 * the `GasPriceOracle` predeploy. op-geth bills these chains' transactions an
 * L1 data-availability cost — and, from Isthmus onwards, an operator fee — on
 * top of L2 execution gas, and adds both to the balance check it runs before a
 * transaction executes.
 *
 * Membership is asserted, not detected: the predeploy answers on exactly these
 * four and has no code on every other EVM chain in the registry. An omission is
 * safe but silent — the chain reserves nothing extra, which is how every chain
 * behaved before the oracle was read at all — so a newly added OP-stack rollup
 * has to be listed here or its max sends will under-reserve.
 */
export const opStackChains = [EvmChain.Optimism, EvmChain.Base, EvmChain.Blast, EvmChain.Mantle] as const

export type OpStackChain = (typeof opStackChains)[number]

/** Narrows a chain to one whose node prices an L1 data fee through the `GasPriceOracle` predeploy. */
export const isOpStackChain = (chain: Chain): chain is OpStackChain => isOneOf(chain, opStackChains)
