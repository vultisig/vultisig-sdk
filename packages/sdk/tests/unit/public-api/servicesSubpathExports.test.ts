import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import * as services from '../../../src/services'

const sdkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const sdkPackageJson = JSON.parse(readFileSync(path.join(sdkRoot, 'package.json'), 'utf8'))
const platformRollupConfig = readFileSync(path.join(sdkRoot, 'rollup.platforms.config.js'), 'utf8')
const typesRollupConfig = readFileSync(path.join(sdkRoot, 'rollup.types.config.js'), 'utf8')

describe('@vultisig/sdk/services public surface', () => {
  it('publishes a dedicated conditional export for the services barrel', () => {
    expect(sdkPackageJson.exports['./services']).toMatchObject({
      types: './dist/services/index.d.ts',
      browser: './dist/services/index.js',
      worker: './dist/services/index.js',
      'react-native': './dist/services/index.js',
      node: {
        import: './dist/services/index.js',
        require: './dist/services/index.cjs',
      },
      import: './dist/services/index.js',
      require: './dist/services/index.cjs',
      default: './dist/services/index.cjs',
    })
    expect(JSON.stringify(sdkPackageJson.exports['./services'])).not.toContain('dist/index.node')
  })

  it('keeps dedicated runtime and declaration bundle generation wired', () => {
    expect(platformRollupConfig).toContain("input: './src/services/index.ts'")
    expect(platformRollupConfig).toContain("distBase: 'services'")
    expect(typesRollupConfig).toContain(
      "createSubpathTypesConfig('src/services/index.ts', 'dist/services/index.d.ts')"
    )
  })

  it('exposes the seedphrase ceremony service family without deep imports', () => {
    expect(services.buildKeygenPairingQrPayload).toBeTypeOf('function')
    expect(services.FastVaultFromSeedphraseService).toBeTypeOf('function')
    expect(services.JoinSecureVaultService).toBeTypeOf('function')
    expect(services.SecureVaultFromSeedphraseService).toBeTypeOf('function')
  })
})