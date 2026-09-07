import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const sdkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const sdkPackageJson = JSON.parse(readFileSync(path.join(sdkRoot, 'package.json'), 'utf8'))
const platformRollupConfig = readFileSync(path.join(sdkRoot, 'rollup.platforms.config.js'), 'utf8')
const typesRollupConfig = readFileSync(path.join(sdkRoot, 'rollup.types.config.js'), 'utf8')

describe('public API subpath exports', () => {
  it('publishes dedicated export-map entries for every narrow public surface', () => {
    const parseExport = sdkPackageJson.exports['./tools/parse']
    const defiExport = sdkPackageJson.exports['./tools/defi']
    const bridgeExport = sdkPackageJson.exports['./tools/bridge']
    const gasExport = sdkPackageJson.exports['./tools/gas']
    const balanceExport = sdkPackageJson.exports['./tools/balance']
    const tronExport = sdkPackageJson.exports['./chains/tron']
    const utxoExport = sdkPackageJson.exports['./chains/utxo']
    const tonExport = sdkPackageJson.exports['./chains/ton']
    const abiExport = sdkPackageJson.exports['./abi']
    const decodeExport = sdkPackageJson.exports['./tools/decode']
    const policyExport = sdkPackageJson.exports['./tools/policy']
    const txExport = sdkPackageJson.exports['./tx']
    const serverExport = sdkPackageJson.exports['./server']

    expect(parseExport).toMatchObject({
      types: './dist/tools/parse/index.d.ts',
      import: './dist/tools/parse/index.js',
      require: './dist/tools/parse/index.cjs',
      default: './dist/tools/parse/index.cjs',
    })
    expect(defiExport).toMatchObject({
      types: './dist/tools/defi/index.d.ts',
      import: './dist/tools/defi/index.js',
      require: './dist/tools/defi/index.cjs',
      default: './dist/tools/defi/index.cjs',
    })
    expect(bridgeExport).toMatchObject({
      types: './dist/tools/bridge/index.d.ts',
      import: './dist/tools/bridge/index.js',
      require: './dist/tools/bridge/index.cjs',
      default: './dist/tools/bridge/index.cjs',
    })
    expect(gasExport).toMatchObject({
      types: './dist/tools/gas/index.d.ts',
      import: './dist/tools/gas/index.js',
      require: './dist/tools/gas/index.cjs',
      default: './dist/tools/gas/index.cjs',
    })
    expect(balanceExport).toMatchObject({
      types: './dist/tools/balance/index.d.ts',
      import: './dist/tools/balance/index.js',
      require: './dist/tools/balance/index.cjs',
      default: './dist/tools/balance/index.cjs',
    })
    expect(tronExport).toMatchObject({
      types: './dist/chains/tron/index.d.ts',
      import: './dist/chains/tron/index.js',
      require: './dist/chains/tron/index.cjs',
      default: './dist/chains/tron/index.cjs',
    })
    expect(utxoExport).toMatchObject({
      types: './dist/chains/utxo/index.d.ts',
      import: './dist/chains/utxo/index.js',
      require: './dist/chains/utxo/index.cjs',
      default: './dist/chains/utxo/index.cjs',
    })
    expect(tonExport).toMatchObject({
      types: './dist/chains/ton/index.d.ts',
      import: './dist/chains/ton/index.js',
      require: './dist/chains/ton/index.cjs',
      default: './dist/chains/ton/index.cjs',
    })
    expect(abiExport).toMatchObject({
      types: './dist/abi/index.d.ts',
      import: './dist/abi/index.js',
      require: './dist/abi/index.cjs',
      default: './dist/abi/index.cjs',
    })
    expect(decodeExport).toMatchObject({
      types: './dist/tools/decode/index.d.ts',
      import: './dist/tools/decode/index.js',
      require: './dist/tools/decode/index.cjs',
      default: './dist/tools/decode/index.cjs',
    })
    expect(policyExport).toMatchObject({
      types: './dist/tools/policy/index.d.ts',
      import: './dist/tools/policy/index.js',
      require: './dist/tools/policy/index.cjs',
      default: './dist/tools/policy/index.cjs',
    })
    expect(txExport).toMatchObject({
      types: './dist/tx/index.d.ts',
      import: './dist/tx/index.js',
      require: './dist/tx/index.cjs',
      default: './dist/tx/index.cjs',
    })
    expect(serverExport).toMatchObject({
      types: './dist/server/index.d.ts',
      import: './dist/server/index.js',
      require: './dist/server/index.cjs',
      default: './dist/server/index.cjs',
    })

    expect(JSON.stringify(parseExport)).not.toContain('dist/index.node')
    expect(JSON.stringify(defiExport)).not.toContain('dist/index.node')
    expect(JSON.stringify(bridgeExport)).not.toContain('dist/index.node')
    expect(JSON.stringify(gasExport)).not.toContain('dist/index.node')
    expect(JSON.stringify(balanceExport)).not.toContain('dist/index.node')
    expect(JSON.stringify(tronExport)).not.toContain('dist/index.node')
    expect(JSON.stringify(utxoExport)).not.toContain('dist/index.node')
    expect(JSON.stringify(tonExport)).not.toContain('dist/index.node')
    expect(JSON.stringify(abiExport)).not.toContain('dist/index.node')
    expect(JSON.stringify(decodeExport)).not.toContain('dist/index.node')
    expect(JSON.stringify(policyExport)).not.toContain('dist/index.node')
    expect(JSON.stringify(txExport)).not.toContain('dist/index.node')
    expect(JSON.stringify(serverExport)).not.toContain('dist/index.node')
  })

  it('keeps dedicated JS and d.ts bundle generation wired for every narrow public surface', () => {
    expect(platformRollupConfig).toContain("input: './src/tools/parse/index.ts'")
    expect(platformRollupConfig).toContain("distBase: 'tools/parse'")
    expect(platformRollupConfig).toContain("input: './src/tools/defi/index.ts'")
    expect(platformRollupConfig).toContain("distBase: 'tools/defi'")
    expect(platformRollupConfig).toContain("input: './src/tools/bridge/index.ts'")
    expect(platformRollupConfig).toContain("distBase: 'tools/bridge'")
    expect(platformRollupConfig).toContain("input: './src/tools/gas/index.ts'")
    expect(platformRollupConfig).toContain("distBase: 'tools/gas'")
    expect(platformRollupConfig).toContain("input: './src/tools/balance/index.ts'")
    expect(platformRollupConfig).toContain("distBase: 'tools/balance'")
    expect(platformRollupConfig).toContain("input: './src/chains/tron/index.ts'")
    expect(platformRollupConfig).toContain("distBase: 'chains/tron'")
    expect(platformRollupConfig).toContain("input: './src/chains/utxo/index.ts'")
    expect(platformRollupConfig).toContain("distBase: 'chains/utxo'")
    expect(platformRollupConfig).toContain("input: './src/chains/ton/index.ts'")
    expect(platformRollupConfig).toContain("distBase: 'chains/ton'")
    expect(platformRollupConfig).toContain("input: './src/abi/index.ts'")
    expect(platformRollupConfig).toContain("distBase: 'abi'")
    expect(platformRollupConfig).toContain("input: './src/tools/decode/index.ts'")
    expect(platformRollupConfig).toContain("distBase: 'tools/decode'")
    expect(platformRollupConfig).toContain("input: './src/tools/policy/index.ts'")
    expect(platformRollupConfig).toContain("distBase: 'tools/policy'")
    expect(platformRollupConfig).toContain("input: './src/tx/index.ts'")
    expect(platformRollupConfig).toContain("distBase: 'tx'")
    expect(platformRollupConfig).toContain("input: './src/server/index.ts'")
    expect(platformRollupConfig).toContain("distBase: 'server'")

    expect(typesRollupConfig).toContain(
      "createSubpathTypesConfig('src/tools/parse/index.ts', 'dist/tools/parse/index.d.ts')"
    )
    expect(typesRollupConfig).toContain(
      "createSubpathTypesConfig('src/tools/defi/index.ts', 'dist/tools/defi/index.d.ts')"
    )
    expect(typesRollupConfig).toContain(
      "createSubpathTypesConfig('src/tools/bridge/index.ts', 'dist/tools/bridge/index.d.ts')"
    )
    expect(typesRollupConfig).toContain(
      "createSubpathTypesConfig('src/tools/gas/index.ts', 'dist/tools/gas/index.d.ts')"
    )
    expect(typesRollupConfig).toContain(
      "createSubpathTypesConfig('src/tools/balance/index.ts', 'dist/tools/balance/index.d.ts')"
    )
    expect(typesRollupConfig).toContain(
      "createSubpathTypesConfig('src/chains/tron/index.ts', 'dist/chains/tron/index.d.ts')"
    )
    expect(typesRollupConfig).toContain(
      "createSubpathTypesConfig('src/chains/utxo/index.ts', 'dist/chains/utxo/index.d.ts')"
    )
    expect(typesRollupConfig).toContain(
      "createSubpathTypesConfig('src/chains/ton/index.ts', 'dist/chains/ton/index.d.ts')"
    )
    expect(typesRollupConfig).toContain("createSubpathTypesConfig('src/abi/index.ts', 'dist/abi/index.d.ts')")
    expect(typesRollupConfig).toContain(
      "createSubpathTypesConfig('src/tools/decode/index.ts', 'dist/tools/decode/index.d.ts')"
    )
    expect(typesRollupConfig).toContain(
      "createSubpathTypesConfig('src/tools/policy/index.ts', 'dist/tools/policy/index.d.ts')"
    )
    expect(typesRollupConfig).toContain("createSubpathTypesConfig('src/tx/index.ts', 'dist/tx/index.d.ts')")
    expect(typesRollupConfig).toContain("createSubpathTypesConfig('src/server/index.ts', 'dist/server/index.d.ts')")
  })
})
