import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const sdkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const sdkPackageJson = JSON.parse(readFileSync(path.join(sdkRoot, 'package.json'), 'utf8'))
const platformRollupConfig = readFileSync(path.join(sdkRoot, 'rollup.platforms.config.js'), 'utf8')
const typesRollupConfig = readFileSync(path.join(sdkRoot, 'rollup.types.config.js'), 'utf8')

describe('public API tools subpath exports', () => {
  it('publishes dedicated export-map entries for every public tools subpath', () => {
    const parseExport = sdkPackageJson.exports['./tools/parse']
    const defiExport = sdkPackageJson.exports['./tools/defi']
    const bridgeExport = sdkPackageJson.exports['./tools/bridge']
    const gasExport = sdkPackageJson.exports['./tools/gas']
    const policyExport = sdkPackageJson.exports['./tools/policy']
    const swapExport = sdkPackageJson.exports['./tools/swap']
    const prepExport = sdkPackageJson.exports['./tools/prep']

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
    expect(policyExport).toMatchObject({
      types: './dist/tools/policy/index.d.ts',
      import: './dist/tools/policy/index.js',
      require: './dist/tools/policy/index.cjs',
      default: './dist/tools/policy/index.cjs',
    })
    expect(swapExport).toMatchObject({
      types: './dist/tools/swap/index.d.ts',
      import: './dist/tools/swap/index.js',
      require: './dist/tools/swap/index.cjs',
      default: './dist/tools/swap/index.cjs',
    })
    expect(prepExport).toMatchObject({
      types: './dist/tools/prep/index.d.ts',
      import: './dist/tools/prep/index.js',
      require: './dist/tools/prep/index.cjs',
      default: './dist/tools/prep/index.cjs',
    })

    expect(JSON.stringify(parseExport)).not.toContain('dist/index.node')
    expect(JSON.stringify(defiExport)).not.toContain('dist/index.node')
    expect(JSON.stringify(bridgeExport)).not.toContain('dist/index.node')
    expect(JSON.stringify(gasExport)).not.toContain('dist/index.node')
    expect(JSON.stringify(policyExport)).not.toContain('dist/index.node')
    expect(JSON.stringify(swapExport)).not.toContain('dist/index.node')
    expect(JSON.stringify(prepExport)).not.toContain('dist/index.node')
  })

  it('keeps dedicated JS and d.ts bundle generation wired for every public tools subpath', () => {
    expect(platformRollupConfig).toContain("input: './src/tools/parse/index.ts'")
    expect(platformRollupConfig).toContain("distBase: 'tools/parse'")
    expect(platformRollupConfig).toContain("input: './src/tools/defi/index.ts'")
    expect(platformRollupConfig).toContain("distBase: 'tools/defi'")
    expect(platformRollupConfig).toContain("input: './src/tools/bridge/index.ts'")
    expect(platformRollupConfig).toContain("distBase: 'tools/bridge'")
    expect(platformRollupConfig).toContain("input: './src/tools/gas/index.ts'")
    expect(platformRollupConfig).toContain("distBase: 'tools/gas'")
    expect(platformRollupConfig).toContain("input: './src/tools/policy/index.ts'")
    expect(platformRollupConfig).toContain("distBase: 'tools/policy'")
    expect(platformRollupConfig).toContain("input: './src/tools/swap/index.ts'")
    expect(platformRollupConfig).toContain("distBase: 'tools/swap'")
    expect(platformRollupConfig).toContain("input: './src/tools/prep/index.ts'")
    expect(platformRollupConfig).toContain("distBase: 'tools/prep'")

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
      "createSubpathTypesConfig('src/tools/policy/index.ts', 'dist/tools/policy/index.d.ts')"
    )
    expect(typesRollupConfig).toContain(
      "createSubpathTypesConfig('src/tools/swap/index.ts', 'dist/tools/swap/index.d.ts')"
    )
    expect(typesRollupConfig).toContain(
      "createSubpathTypesConfig('src/tools/prep/index.ts', 'dist/tools/prep/index.d.ts')"
    )
    expect(sdkPackageJson.scripts['build:types']).toContain('--max-processes 1')
    expect(sdkPackageJson.scripts['build:types']).toContain('BUILD_TYPES_TARGET=swap')
    expect(sdkPackageJson.scripts['build:types']).toContain('BUILD_TYPES_TARGET=prep')
  })
})
