import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const sdkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const rootEntry = readFileSync(path.join(sdkRoot, 'src/index.ts'), 'utf8')
const toolsEntry = readFileSync(path.join(sdkRoot, 'src/tools/index.ts'), 'utf8')
const prepEntry = readFileSync(path.join(sdkRoot, 'src/tools/prep/index.ts'), 'utf8')

describe('max-send public export parity', () => {
  it('exposes the cached-balance helper from prep, tools, and root entries', () => {
    expect(prepEntry).toContain('computeMaxSendFromBalance')
    expect(prepEntry).toContain('ComputeMaxSendFromBalanceParams')
    expect(toolsEntry).toContain('computeMaxSendFromBalance')
    expect(toolsEntry).toContain('ComputeMaxSendFromBalanceParams')
    expect(rootEntry).toContain('computeMaxSendFromBalance')
    expect(rootEntry).toContain('ComputeMaxSendFromBalanceParams')
  })
})
