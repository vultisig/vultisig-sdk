#!/usr/bin/env node
/**
 * Regenerates the Robinhood stock-token catalog from the public registry.
 * Emits TS/Swift/Kotlin blocks to stdout for manual paste-over.
 *
 * Decimals are read on-chain per token — the registry doesn't carry them.
 * Prices resolve via CoinGecko contract lookup on the `robinhood` platform,
 * so no priceProviderId is set.
 *
 * Logos: the registry's own logoUrl serves the identical Robinhood feather
 * for every token, so per-stock art comes from FMP keyed by ticker instead.
 * FEATHER_FALLBACK lists tickers where the FMP image is the wrong company
 * (Robinhood tokenizes private companies whose symbols collide with listed
 * ones), a photo, or illegible at icon size — verified visually 2026-07-24.
 * Re-verify any NEW ticker's FMP image before trusting it.
 */
const REGISTRY_URL = 'https://api.robinhood.com/rhj/assets'
const RPC_URL = 'https://rpc.mainnet.chain.robinhood.com'
const CHAIN_ID = 4663
const RPC_CONCURRENCY = 10

const FEATHER_FALLBACK = new Set([
  'P', // Everpure; FMP serves Pandora
  'SKHY', // SK hynix; FMP art too low-res
  'TSEM', // Tower Semiconductor; FMP serves a photo
  'USO', // USCF wordmark illegible at icon size
  'XNDU', // Xanadu (private); FMP image unverifiable
])

const stockLogoUrl = a =>
  FEATHER_FALLBACK.has(a.tokenSymbol)
    ? a.logoUrl
    : `https://financialmodelingprep.com/image-stock/${a.tokenSymbol}.png`

const fetchDecimals = async contractAddress => {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_call',
      params: [{ to: contractAddress, data: '0x313ce567' }, 'latest'],
      id: 1,
    }),
  })
  const { result } = await res.json()
  if (!result || result === '0x') throw new Error(`decimals() failed for ${contractAddress}`)
  return parseInt(result, 16)
}

const res = await fetch(REGISTRY_URL)
if (!res.ok) throw new Error(`registry fetch failed: ${res.status}`)
const body = await res.json()
const assets = Array.isArray(body) ? body : Object.values(body).find(Array.isArray)

const rows = assets
  .filter(a => a.status === 'ASSET_STATUS_ACTIVE')
  .map(a => ({ ...a, deployment: (a.deployments ?? []).find(d => d.chainId === CHAIN_ID) }))
  .filter(a => a.deployment)
  .sort((a, b) => a.tokenSymbol.localeCompare(b.tokenSymbol))

for (let i = 0; i < rows.length; i += RPC_CONCURRENCY) {
  await Promise.all(
    rows.slice(i, i + RPC_CONCURRENCY).map(async a => (a.decimals = await fetchDecimals(a.deployment.contractAddress)))
  )
}

console.log(`// ${rows.length} active stock tokens on chain ${CHAIN_ID}\n`)

console.log('===== TS (knownTokens/index.ts, inside [Chain.Robinhood]) =====')
for (const a of rows) {
  console.log(`    '${a.deployment.contractAddress}': {
      ticker: '${a.tokenSymbol}',
      logo: '${stockLogoUrl(a)}',
      decimals: ${a.decimals},
    },`)
}

console.log('\n===== Swift (iOS TokensStore.swift) =====')
for (const a of rows) {
  console.log(`        CoinMeta(
            chain: .robinhood,
            ticker: "${a.tokenSymbol}",
            logo: "${stockLogoUrl(a)}",
            decimals: ${a.decimals},
            priceProviderId: "",
            contractAddress: "${a.deployment.contractAddress}",
            isNativeToken: false
        ),`)
}

console.log('\n===== Kotlin (android Coins.kt, object Robinhood.STOCK_TOKENS) =====')
for (const a of rows) {
  console.log(`            Coin(
                chain = Chain.Robinhood,
                ticker = "${a.tokenSymbol}",
                logo = "${stockLogoUrl(a)}",
                address = "",
                decimal = ${a.decimals},
                hexPublicKey = "",
                priceProviderID = "",
                contractAddress = "${a.deployment.contractAddress}",
                isNativeToken = false,
            ),`)
}
