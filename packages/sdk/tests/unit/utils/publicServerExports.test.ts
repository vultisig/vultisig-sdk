import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

const packageJsonPath = resolve(__dirname, '../../../package.json')
const serverEntryPath = resolve(__dirname, '../../../src/server/index.ts')
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
  exports?: Record<string, Record<string, string>>
}
const serverEntrySource = readFileSync(serverEntryPath, 'utf8')

describe('@vultisig/sdk/server public exports', () => {
  it('declares the ./server subpath export with matching runtime and types entries', () => {
    expect(packageJson.exports?.['./server']).toEqual({
      types: './dist/server/index.d.ts',
      import: './dist/server/index.js',
      require: './dist/server/index.cjs',
      default: './dist/server/index.cjs',
    })
  })

  it('keeps the server entry focused on the documented fast-vault and relay helpers', () => {
    expect(serverEntrySource).toContain("export { setupVaultWithServer }")
    expect(serverEntrySource).toContain("export { signWithServer }")
    expect(serverEntrySource).toContain("export { verifyVaultEmailCode }")
    expect(serverEntrySource).toContain("export { sendMpcRelayMessage }")
    expect(serverEntrySource).toContain("export { getMpcRelayMessages }")
    expect(serverEntrySource).toContain("export { deleteMpcRelayMessage }")
    expect(serverEntrySource).toContain("export { joinMpcSession }")
    expect(serverEntrySource).toContain("export { fromMpcServerMessage, toMpcServerMessage }")
  })
})
