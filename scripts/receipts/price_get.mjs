#!/usr/bin/env -S npx tsx
/**
 * Runnable receipt for sdk.price.get + sdk.price.batch.
 *
 * Hits the LIVE Vultisig CoinGecko proxy (the production read path) and prints
 * real USD prices for ETH, BTC, and USDC. This is the curl-equivalent proof
 * that the primitive resolves real on-the-wire data, not a mock.
 *
 * Run from the repo root:
 *   npx tsx scripts/receipts/price_get.mjs
 */
import { getPrice, getPricesBatch } from '../../packages/sdk/src/tools/price/getPrice.ts'

const fmt = q => `${q.resolvedSymbol.padEnd(5)} $${q.usd.toLocaleString('en-US', { maximumFractionDigits: 2 })}` +
  `  (24h ${q.usd24hChange >= 0 ? '+' : ''}${q.usd24hChange.toFixed(2)}%)` +
  (q.usdMarketCap ? `  mcap $${(q.usdMarketCap / 1e9).toFixed(2)}B` : '')

const main = async () => {
  console.log('=== sdk.price.get (single, native ticker) ===')
  const eth = await getPrice({ symbol: 'ETH' })
  console.log(fmt(eth))

  console.log('\n=== sdk.price.get (single, EVM contract: USDC on Ethereum) ===')
  const usdcByContract = await getPrice({
    tokenContract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    chain: 'Ethereum',
  })
  console.log(fmt(usdcByContract) + `  [${usdcByContract.chain} ${usdcByContract.contractAddress}]`)

  console.log('\n=== sdk.price.batch (ETH + BTC + USDC) ===')
  const batch = await getPricesBatch([{ symbol: 'ETH' }, { symbol: 'BTC' }, { symbol: 'USDC' }])
  for (const r of batch) {
    if (r.ok) console.log(fmt(r.quote))
    else console.log(`FAIL ${JSON.stringify(r.query)} -> ${r.error}`)
  }

  console.log('\n=== sdk.price.batch (graceful partial failure: BTC ok, BOGUS fails) ===')
  const partial = await getPricesBatch([{ symbol: 'BTC' }, { symbol: 'NOTACOIN' }])
  for (const r of partial) {
    if (r.ok) console.log(`OK   ${fmt(r.quote)}`)
    else console.log(`FAIL ${JSON.stringify(r.query)} -> ${r.error}`)
  }

  if (!eth.usd || !usdcByContract.usd || !batch.every(r => r.ok)) {
    throw new Error('receipt sanity check failed: expected live prices for ETH/BTC/USDC')
  }
  console.log('\nOK: live prices resolved.')
}

main().catch(err => {
  console.error('receipt error:', err)
  process.exit(1)
})
