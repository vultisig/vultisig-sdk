import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, expectTypeOf, it } from 'vitest'

import * as seedphrase from '../../../src/seedphrase'
import type { ChainDiscoveryAggregate as RootChainDiscoveryAggregate } from '../../../src/index'
import type { ChainDiscoveryAggregate as SeedphraseChainDiscoveryAggregate, ChainDiscoveryResult } from '../../../src/seedphrase'

const sdkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const sdkPackageJson = JSON.parse(readFileSync(path.join(sdkRoot, 'package.json'), 'utf8'))
const platformRollupConfig = readFileSync(path.join(sdkRoot, 'rollup.platforms.config.js'), 'utf8')
const typesRollupConfig = readFileSync(path.join(sdkRoot, 'rollup.types.config.js'), 'utf8')

describe('@vultisig/sdk/seedphrase public surface', () => {
  it('publishes a dedicated conditional export instead of a root-bundle alias', () => {
    const seedphraseExport = sdkPackageJson.exports['./seedphrase']

    expect(seedphraseExport).toMatchObject({
      types: './dist/seedphrase/index.d.ts',
      node: {
        import: './dist/seedphrase/index.js',
        require: './dist/seedphrase/index.cjs',
      },
      import: './dist/seedphrase/index.js',
      require: './dist/seedphrase/index.cjs',
      default: './dist/seedphrase/index.cjs',
    })
    expect(JSON.stringify(seedphraseExport)).not.toContain('dist/index.node')
    expect(seedphraseExport).not.toHaveProperty('browser')
    expect(seedphraseExport).not.toHaveProperty('worker')
    expect(seedphraseExport).not.toHaveProperty('react-native')
  })

  it('keeps dedicated runtime and declaration bundle generation wired', () => {
    expect(platformRollupConfig).toContain("input: './src/seedphrase/index.ts'")
    expect(platformRollupConfig).toContain("distBase: 'seedphrase'")
    expect(typesRollupConfig).toContain(
      "createSubpathTypesConfig('src/seedphrase/index.ts', 'dist/seedphrase/index.d.ts')"
    )
  })

  it('exposes the canonical runtime helper and import/discovery family', () => {
    expect(Object.keys(seedphrase).sort()).toEqual(
      [
        'BIP39_LANGUAGES',
        'BIP39_WORDLISTS',
        'ChainDiscoveryService',
        'MasterKeyDeriver',
        'SEEDPHRASE_IMPORT_SUPPORTED_CHAINS',
        'SEEDPHRASE_IMPORT_UNSUPPORTED_CHAINS',
        'SEEDPHRASE_WORD_COUNTS',
        'SeedphraseValidator',
        'TransportError',
        'assertSeedphraseImportSupportsChains',
        'cleanMnemonic',
        'detectMnemonicLanguage',
        'findInvalidWords',
        'findInvalidWordsAcrossAllLanguages',
        'getUnsupportedSeedphraseImportChains',
        'getWordlist',
        'isSeedphraseImportSupportedChain',
        'normalizeMnemonic',
        'validateSeedphrase',
      ].sort()
    )
    expect(seedphrase.normalizeMnemonic('  ABANDON\nABANDON  ')).toBe('abandon abandon')
    expect(
      seedphrase.detectMnemonicLanguage(
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
      )
    ).toBe('english')
  })

  it('exports the chain-discovery aggregate type from both the seedphrase subpath and root sdk surface', () => {
    expectTypeOf<SeedphraseChainDiscoveryAggregate>().toEqualTypeOf<{
      results: ChainDiscoveryResult[]
      usePhantomSolanaPath: boolean
      useCosmosPathTerra: boolean
    }>()
    expectTypeOf<RootChainDiscoveryAggregate>().toEqualTypeOf<SeedphraseChainDiscoveryAggregate>()
  })
})
