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
  FEATHER_FALLBACK.has(a.tokenSymbol) ? a.logoUrl : `https://financialmodelingprep.com/image-stock/${a.tokenSymbol}.png`

// Registry fields land verbatim inside generated TS/Swift/Kotlin string
// literals — reject anything that could break out of or corrupt them.
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const TICKER_RE = /^[A-Za-z0-9.-]{1,12}$/
const isSafeLogoUrl = url => {
  if (!/^[A-Za-z0-9:/._%?=&-]+$/.test(url)) return false
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}
const validateRow = a => {
  if (!ADDRESS_RE.test(a.deployment.contractAddress))
    throw new Error(`invalid contractAddress for ${a.tokenSymbol}: ${a.deployment.contractAddress}`)
  if (!TICKER_RE.test(a.tokenSymbol)) throw new Error(`invalid tokenSymbol: ${JSON.stringify(a.tokenSymbol)}`)
  const logo = stockLogoUrl(a)
  if (!isSafeLogoUrl(logo)) throw new Error(`unsafe logoUrl for ${a.tokenSymbol}: ${JSON.stringify(logo)}`)
}

const fetchDecimals = async contractAddress => {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_call',
      params: [{ to: contractAddress, data: '0x313ce567' }, 'latest'],
      id: 1,
    }),
  })
  if (!res.ok) throw new Error(`decimals() RPC ${res.status} for ${contractAddress}`)
  const { result, error } = await res.json()
  if (error) throw new Error(`decimals() RPC error for ${contractAddress}: ${error.message ?? error.code}`)
  if (typeof result !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(result))
    throw new Error(`decimals() malformed result for ${contractAddress}: ${result}`)
  const decimals = parseInt(result, 16)
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 255)
    throw new Error(`decimals() out of range for ${contractAddress}: ${decimals}`)
  return decimals
}

const res = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(15_000) })
if (!res.ok) throw new Error(`registry fetch failed: ${res.status}`)
const body = await res.json()
const assets = Array.isArray(body) ? body : Object.values(Object(body)).find(Array.isArray)
if (!Array.isArray(assets) || assets.length === 0)
  throw new Error(`registry payload has no asset array — schema drift? keys: ${Object.keys(Object(body))}`)

const activeAssets = assets.filter(a => a?.status === 'ASSET_STATUS_ACTIVE')
activeAssets.forEach(a => {
  if (!Array.isArray(a.deployments))
    throw new Error(`invalid deployments for ${JSON.stringify(a?.tokenSymbol)} — schema drift?`)
})

const rows = activeAssets
  .map(a => ({
    ...a,
    deployment: a.deployments.find(d => d?.chainId === CHAIN_ID),
  }))
  .filter(a => a.deployment)
if (rows.length === 0) throw new Error(`no active assets with a chain-${CHAIN_ID} deployment — schema drift?`)
rows.forEach(validateRow)
rows.sort((a, b) => a.tokenSymbol.localeCompare(b.tokenSymbol))

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
