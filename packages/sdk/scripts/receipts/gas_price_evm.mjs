/**
 * Runnable receipt for `sdk.gas.price` (evmGasPrice).
 *
 * Fetches the LIVE gas price for Ethereum + Base via the SDK's own per-chain
 * RPC client and prints wei + gwei. This is the curl-equivalent: a real
 * network read exercising the new primitive end-to-end.
 *
 *   Run from packages/sdk:
 *     node --import tsx scripts/receipts/gas_price_evm.mjs
 */
import { evmGasPrice } from '../../src/tools/evm/gasPrice.ts'

const chains = ['Ethereum', 'Base']

console.log('sdk.gas.price — live EVM gas price\n')

for (const chain of chains) {
  try {
    const { gasPriceWei, gasPriceGwei } = await evmGasPrice(chain)
    console.log(`  ${chain.padEnd(10)}  ${gasPriceGwei} gwei  (${gasPriceWei} wei)`)
  } catch (err) {
    console.error(`  ${chain.padEnd(10)}  ERROR: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  }
}
