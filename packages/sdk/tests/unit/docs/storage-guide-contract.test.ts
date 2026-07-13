import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { FileStorage } from '../../../src/platforms/node/storage'
import { Vultisig } from '../../../src/Vultisig'

const guidePath = fileURLToPath(new URL('../../../../../docs/SDK-USERS-GUIDE.md', import.meta.url))
const guide = readFileSync(guidePath, 'utf8')
const typescriptBlocks = [...guide.matchAll(/```typescript\n([\s\S]*?)```/g)].map(match => match[1])
const fileStorageBlocks = typescriptBlocks.filter(block => /new FileStorage\(/.test(block))

describe('SDK users guide storage contract', () => {
  it('uses platform defaults unless custom storage is required', () => {
    expect(guide).not.toContain('storage: new FileStorage()')
  })

  it('imports every FileStorage example from a platform subpath', () => {
    expect(fileStorageBlocks.length).toBeGreaterThan(0)
    for (const block of fileStorageBlocks) {
      expect(block).toMatch(
        /import\s*{[^}]*\bFileStorage\b[^}]*}\s*from\s*['"]@vultisig\/sdk\/(?:node|electron(?:\/main)?)['"]/
      )
    }
  })

  it('uses only supported FileStorage constructor shapes', () => {
    for (const block of fileStorageBlocks) {
      const calls = [...block.matchAll(/new FileStorage\(([^)]*)\)/g)]
      expect(calls.length).toBeGreaterThan(0)
      for (const [, rawArgs] of calls) {
        const args = rawArgs.trim()
        expect(args === '' || (args.startsWith('{') && args.endsWith('}'))).toBe(true)
      }
    }
  })

  it('constructs the documented Node storage configuration', () => {
    const storage = new FileStorage({ basePath: '/tmp/vultisig-sdk-users-guide-contract' })
    const sdk = new Vultisig({ storage })

    expect(storage.basePath).toBe('/tmp/vultisig-sdk-users-guide-contract')
    sdk.dispose()
  })
})
