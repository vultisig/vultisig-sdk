import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import ts from 'typescript'
const base = path.resolve('packages/sdk/src')
const cfg = ts.readConfigFile('packages/sdk/tsconfig.json', ts.sys.readFile)
const parsed = ts.parseJsonConfigFileContent(
  cfg.config,
  ts.sys,
  'packages/sdk',
  undefined,
  'packages/sdk/tsconfig.json'
)
const subpaths = {
  './tools/prep': {
    node: 'platforms/node/prep.ts',
    browser: 'platforms/browser/prep.ts',
    rn: 'platforms/react-native/prep.ts',
    ns: 'prep',
  },
  './seedphrase': { node: 'seedphrase/index.ts', ns: 'seedphrase' },
  './tools/balance': {
    node: 'tools/balance/index.ts',
    browser: 'tools/balance/index.ts',
    rn: 'tools/balance/index.ts',
    ns: 'balance',
  },
  './tools/swap': {
    node: 'tools/swap/index.ts',
    browser: 'tools/swap/index.ts',
    rn: 'tools/swap/index.ts',
    ns: 'swap',
  },
  './tools/decode': {
    node: 'tools/decode/index.ts',
    browser: 'tools/decode/index.ts',
    rn: 'tools/decode/index.ts',
    ns: 'decode',
  },
  './tx': { node: 'tx/index.ts', browser: 'tx/index.ts', rn: 'tx/index.ts', ns: 'tx' },
  './chains/tron': {
    node: 'chains/tron/index.ts',
    browser: 'chains/tron/index.ts',
    rn: 'chains/tron/index.ts',
    ns: 'chainTron',
  },
  './chains/utxo': {
    node: 'chains/utxo/index.ts',
    browser: 'chains/utxo/index.ts',
    rn: 'chains/utxo/index.ts',
    ns: 'chainUtxo',
  },
  './chains/ton': {
    node: 'chains/ton/index.ts',
    browser: 'chains/ton/index.ts',
    rn: 'chains/ton/index.ts',
    ns: 'chainTon',
  },
  './abi': { node: 'abi/index.ts', browser: 'abi/index.ts', rn: 'abi/index.ts', ns: 'abi' },
  './tools/parse': {
    node: 'tools/parse/index.ts',
    browser: 'tools/parse/index.ts',
    rn: 'tools/parse/index.ts',
    ns: 'parse',
  },
  './tools/policy': {
    node: 'tools/policy/index.ts',
    browser: 'tools/policy/index.ts',
    rn: 'tools/policy/index.ts',
    ns: 'policy',
  },
  './tools/price': {
    node: 'tools/price/index.ts',
    browser: 'tools/price/index.ts',
    rn: 'tools/price/index.ts',
    ns: 'price',
  },
  './tools/gas': { node: 'tools/gas/index.ts', browser: 'tools/gas/index.ts', rn: 'tools/gas/index.ts', ns: 'gas' },
  './tools/bridge': {
    node: 'tools/bridge/index.ts',
    browser: 'tools/bridge/index.ts',
    rn: 'tools/bridge/index.ts',
    ns: 'bridge',
  },
  './tools/evm': { node: 'tools/evm/index.ts', ns: 'evm' },
  './tools/cosmos': { node: 'tools/cosmos/index.ts', ns: 'cosmos' },
  './signable-transaction': { node: 'signable-transaction/index.ts', ns: 'signableTransaction' },
  './server': { node: 'server/index.ts', browser: 'server/index.ts', rn: 'server/index.ts', ns: 'server' },
}
const roots = {
  node: 'platforms/node/index.ts',
  browser: 'platforms/browser/index.ts',
  rn: 'platforms/react-native/index.ts',
  chrome: 'platforms/chrome-extension/index.ts',
  electron: 'platforms/electron-main/index.ts',
}
const files = Object.values(subpaths)
  .flatMap(x => [x.node, x.browser, x.rn].filter(Boolean))
  .concat(Object.values(roots))
const p = ts.createProgram([...new Set(files.map(x => path.resolve(base, x)))], {
  ...parsed.options,
  noEmit: true,
  incremental: false,
})
const c = p.getTypeChecker()
function exp(file) {
  const s = p.getSourceFile(path.resolve(base, file))
  const m = c.getSymbolAtLocation(s)
  return Object.fromEntries(c.getExportsOfModule(m).map(s => [s.getName(), s]))
}
function kind(s) {
  if (s.flags & ts.SymbolFlags.Alias) s = c.getAliasedSymbol(s)
  return (s.flags & ts.SymbolFlags.Value ? 1 : 0) | (s.flags & ts.SymbolFlags.Type ? 2 : 0)
}
const rootExports = Object.fromEntries(Object.entries(roots).map(([k, f]) => [k, exp(f)]))
function nsHas(root, ns, name, want) {
  let sym = root[ns]
  if (!sym) return false
  let a = sym.flags & ts.SymbolFlags.Alias ? c.getAliasedSymbol(sym) : sym
  let found = c.getExportsOfModule(a).find(x => x.getName() === name)
  if (found && (kind(found) & want) === want) return true
  let t = c.getTypeOfSymbolAtLocation(sym, sym.valueDeclaration || sym.declarations?.[0])
  let prop = t.getProperty(name)
  return !!prop && (kind(prop) & want) === want
}
let data = []
for (let [sub, d] of Object.entries(subpaths)) {
  let conditions = { node: d.node, browser: d.browser, chrome: d.browser, electron: d.node, rn: d.rn }
  let entry = { subpath: sub, conditions: {} }
  for (let [cond, src] of Object.entries(conditions)) {
    if (!src) continue
    let source = exp(src),
      root = rootExports[cond]
    let symbols = []
    for (let [name, sym] of Object.entries(source)) {
      if (name === 'default') continue
      let want = kind(sym)
      let direct =
        root[name] &&
        (kind(root[name]) & want) === want &&
        (root[name].flags & ts.SymbolFlags.Alias ? c.getAliasedSymbol(root[name]) : root[name]) ===
          (sym.flags & ts.SymbolFlags.Alias ? c.getAliasedSymbol(sym) : sym)
      let aliasName =
        sub === './tools/policy' ? { AssetRef: 'PolicyAssetRef', Envelope: 'PolicyEnvelope' }[name] : undefined
      let aliasMatch =
        aliasName &&
        root[aliasName] &&
        (kind(root[aliasName]) & want) === want &&
        (root[aliasName].flags & ts.SymbolFlags.Alias ? c.getAliasedSymbol(root[aliasName]) : root[aliasName]) ===
          (sym.flags & ts.SymbolFlags.Alias ? c.getAliasedSymbol(sym) : sym)
      let replacement = direct
        ? name
        : aliasMatch
          ? aliasName
          : nsHas(root, d.ns, name, want)
            ? d.ns + '.' + name
            : null
      symbols.push({ name, kind: want, replacement })
    }
    entry.conditions[cond] = { source: src, symbols }
  }
  data.push(entry)
}
const inventoryPath = path.resolve('packages/sdk/public-subpath-migration.json')
const recorded = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'))
assert.deepEqual(
  data,
  recorded,
  'public subpath symbol inventory changed; update the migration mapping and verify every replacement'
)
for (const entry of data) {
  for (const [condition, details] of Object.entries(entry.conditions)) {
    for (const symbol of details.symbols) {
      assert.ok(
        symbol.replacement,
        entry.subpath + ' ' + condition + ' ' + symbol.name + ' has no supported root replacement'
      )
    }
  }
}
const manifest = JSON.parse(fs.readFileSync('packages/sdk/package.json', 'utf8'))
assert.deepEqual(Object.keys(manifest.exports), [
  '.',
  './node',
  './browser',
  './react-native',
  './rn-preamble',
  './electron',
  './electron/main',
  './chrome-extension',
  './vite',
  './tools/defi',
])
const runtimeConfig = fs.readFileSync('packages/sdk/rollup.platforms.config.js', 'utf8')
const typesConfig = fs.readFileSync('packages/sdk/rollup.types.config.js', 'utf8')
for (const { subpath } of data) {
  const distBase = subpath.slice(2)
  assert.ok(!runtimeConfig.includes(`distBase: '${distBase}'`), subpath + ' still has a runtime entry')
  assert.ok(!typesConfig.includes(`dist/${distBase}/index.d.ts`), subpath + ' still has a declaration entry')
}
console.log('19 removed SDK subpaths: every recorded symbol has a root replacement')
