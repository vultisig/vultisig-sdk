import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const sdkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const sdkPackageJson = JSON.parse(readFileSync(path.join(sdkRoot, 'package.json'), 'utf8'))
const typesRollupConfig = readFileSync(path.join(sdkRoot, 'rollup.types.config.js'), 'utf8')

describe('browser-family declaration exports', () => {
  it('maps root type conditions and explicit subpaths to platform bundles', () => {
    expect(sdkPackageJson.exports['.'].types).toEqual({
      'chrome-extension': './dist/index.chrome-extension.d.ts',
      browser: './dist/index.browser.d.ts',
      worker: './dist/index.browser.d.ts',
      'react-native': './dist/index.react-native.d.ts',
      default: './dist/index.d.ts',
    })
    expect(sdkPackageJson.exports['./browser'].types).toBe('./dist/index.browser.d.ts')
    expect(sdkPackageJson.exports['./chrome-extension'].types).toBe('./dist/index.chrome-extension.d.ts')
  })

  it('builds declarations from the matching platform entrypoints', () => {
    expect(typesRollupConfig).toContain("input: 'src/platforms/browser/index.ts'")
    expect(typesRollupConfig).toContain("file: 'dist/index.browser.d.ts'")
    expect(typesRollupConfig).toContain("input: 'src/platforms/chrome-extension/index.ts'")
    expect(typesRollupConfig).toContain("file: 'dist/index.chrome-extension.d.ts'")
  })
})
