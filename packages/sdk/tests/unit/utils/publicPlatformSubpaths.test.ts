import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const sdkRoot = path.resolve(dirname, '../../..')

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(path.join(sdkRoot, relativePath), 'utf8')) as Record<string, any>
}

describe('@vultisig/sdk platform subpath exports', () => {
  it('points browser-family runtime and type conditions at dedicated d.ts bundles', () => {
    const pkg = readJson('package.json')
    const exportsMap = pkg.exports as Record<string, { types?: string | Record<string, string> }>
    const rootTypes = exportsMap['.']?.types as Record<string, string>

    expect(rootTypes.browser).toBe('./dist/index.browser.d.ts')
    expect(rootTypes.worker).toBe('./dist/index.browser.d.ts')
    expect(rootTypes['chrome-extension']).toBe('./dist/index.chrome-extension.d.ts')
    expect(exportsMap['./browser']?.types).toBe('./dist/index.browser.d.ts')
    expect(exportsMap['./chrome-extension']?.types).toBe('./dist/index.chrome-extension.d.ts')
  })
})
