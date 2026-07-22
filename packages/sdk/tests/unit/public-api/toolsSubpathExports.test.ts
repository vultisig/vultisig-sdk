import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const sdkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const sdkPackageJson = JSON.parse(readFileSync(path.join(sdkRoot, 'package.json'), 'utf8'))
const platformRollupConfig = readFileSync(path.join(sdkRoot, 'rollup.platforms.config.js'), 'utf8')
const typesRollupConfig = readFileSync(path.join(sdkRoot, 'rollup.types.config.js'), 'utf8')

describe('public API tools subpath exports', () => {
  it('publishes dedicated export-map entries for parse, defi, and swap', () => {
    const parseExport = sdkPackageJson.exports['./tools/parse']
    const defiExport = sdkPackageJson.exports['./tools/defi']
    const swapExport = sdkPackageJson.exports['./tools/swap']

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
    expect(swapExport).toMatchObject({
      types: './dist/tools/swap/index.d.ts',
      import: './dist/tools/swap/index.js',
      require: './dist/tools/swap/index.cjs',
      default: './dist/tools/swap/index.cjs',
    })

    expect(JSON.stringify(parseExport)).not.toContain('dist/index.node')
    expect(JSON.stringify(defiExport)).not.toContain('dist/index.node')
    expect(JSON.stringify(swapExport)).not.toContain('dist/index.node')
  })

  it('keeps dedicated JS and d.ts bundle generation wired for all three subpaths', () => {
    expect(platformRollupConfig).toContain("input: './src/tools/parse/index.ts'")
    expect(platformRollupConfig).toContain("distBase: 'tools/parse'")
    expect(platformRollupConfig).toContain("input: './src/tools/defi/index.ts'")
    expect(platformRollupConfig).toContain("distBase: 'tools/defi'")
    expect(platformRollupConfig).toContain("input: './src/tools/swap/index.ts'")
    expect(platformRollupConfig).toContain("distBase: 'tools/swap'")

    expect(typesRollupConfig).toContain(
      "createSubpathTypesConfig('src/tools/parse/index.ts', 'dist/tools/parse/index.d.ts')"
    )
    expect(typesRollupConfig).toContain(
      "createSubpathTypesConfig('src/tools/defi/index.ts', 'dist/tools/defi/index.d.ts')"
    )
    expect(typesRollupConfig).toContain(
      "createSubpathTypesConfig('src/tools/swap/index.ts', 'dist/tools/swap/index.d.ts')"
    )
  })
})
