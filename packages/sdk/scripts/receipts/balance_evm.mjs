// Runnable receipt for sdk.balance.evm (getEvmBalances).
//
// Hits REAL Ethereum RPC (https://api.vultisig.com/eth/, the SDK default) and
// reads native ETH + USDC for vitalik.eth (0xd8dA…6045). This is the
// curl-equivalent: a live multi-token EVM balance read through the actual
// primitive, no mocks.
//
// Run from packages/sdk:  yarn tsx scripts/receipts/balance_evm.mjs
import { getEvmBalances } from '../../src/tools/evm/balanceEvm.ts'

const VITALIK = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' // 6 decimals
const DAI = '0x6B175474E89094C44Da98b954EedeAC495271d0F' // 18 decimals

const balances = await getEvmBalances('Ethereum', {
  address: VITALIK,
  tokens: [USDC, DAI],
})

console.log(`sdk.balance.evm — Ethereum — ${VITALIK} (vitalik.eth)\n`)
for (const b of balances) {
  const kind = b.contractAddress ? `ERC-20 ${b.contractAddress}` : 'native'
  console.log(`  ${b.symbol.padEnd(6)} ${b.balance.padStart(24)}  (${b.decimals}d, raw=${b.raw})  [${kind}]`)
}
