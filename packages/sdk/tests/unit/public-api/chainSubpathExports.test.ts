import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const sdkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const sdkPackageJson = JSON.parse(readFileSync(path.join(sdkRoot, 'package.json'), 'utf8'))
const platformRollupConfig = readFileSync(path.join(sdkRoot, 'rollup.platforms.config.js'), 'utf8')
const typesRollupConfig = readFileSync(path.join(sdkRoot, 'rollup.types.config.js'), 'utf8')

describe('public API chain subpath exports', () => {
  it('publishes dedicated export-map entries for tron and utxo chain barrels', () => {
    const tronExport = sdkPackageJson.exports['./chains/tron']
    const utxoExport = sdkPackageJson.exports['./chains/utxo']

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

    expect(JSON.stringify(tronExport)).not.toContain('dist/index.node')
    expect(JSON.stringify(utxoExport)).not.toContain('dist/index.node')
  })

  it('keeps dedicated JS and d.ts bundle generation wired for both chain subpaths', () => {
    expect(platformRollupConfig).toContain("input: './src/chains/tron/index.ts'")
    expect(platformRollupConfig).toContain("distBase: 'chains/tron'")
    expect(platformRollupConfig).toContain("input: './src/chains/utxo/index.ts'")
    expect(platformRollupConfig).toContain("distBase: 'chains/utxo'")

    expect(typesRollupConfig).toContain(
      "createSubpathTypesConfig('src/chains/tron/index.ts', 'dist/chains/tron/index.d.ts')"
    )
    expect(typesRollupConfig).toContain(
      "createSubpathTypesConfig('src/chains/utxo/index.ts', 'dist/chains/utxo/index.d.ts')"
    )
  })
})
