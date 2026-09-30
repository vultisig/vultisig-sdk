import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, expectTypeOf, it } from 'vitest'

import type { ChainDiscoveryAggregate as RootChainDiscoveryAggregate } from '../../../src/index'
import type {
  ChainDiscoveryAggregate as SeedphraseChainDiscoveryAggregate,
  ChainDiscoveryResult,
  SeedphraseImportPreludeInput,
  SeedphraseImportPreludeProgressLabels,
  SeedphraseImportPreludeResult,
} from '../../../src/seedphrase'
import * as seedphrase from '../../../src/seedphrase'
import { prepareSeedphraseImportPrelude } from '../../../src/seedphrase/prepareSeedphraseImportPrelude'

const sdkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const sdkPackageJson = JSON.parse(readFileSync(path.join(sdkRoot, 'package.json'), 'utf8'))
const platformRollupConfig = readFileSync(path.join(sdkRoot, 'rollup.platforms.config.js'), 'utf8')
const typesRollupConfig = readFileSync(path.join(sdkRoot, 'rollup.types.config.js'), 'utf8')

describe('seedphrase root migration surface', () => {
  it('maps the former package subpath to the complete root namespace', () => {
    expect(Object.hasOwn(sdkPackageJson.exports, './seedphrase')).toBe(false)
    expect(readFileSync(path.join(sdkRoot, 'src/index.ts'), 'utf8')).toContain(
      "export * as seedphrase from './seedphrase'"
    )
    expect(platformRollupConfig).not.toContain("distBase: 'seedphrase'")
    expect(typesRollupConfig).not.toContain('dist/seedphrase/index.d.ts')
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
        'prepareSeedphraseImportPrelude',
        'validateSeedphrase',
      ].sort()
    )
    expect(seedphrase.normalizeMnemonic('  ABANDON\nABANDON  ')).toBe('abandon abandon')
    expect(
      seedphrase.detectMnemonicLanguage(
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
      )
    ).toBe('english')
    expect(seedphrase.prepareSeedphraseImportPrelude).toBe(prepareSeedphraseImportPrelude)
  })

  it('exports the preflight input, progress, and result types', () => {
    expectTypeOf<SeedphraseImportPreludeInput>().toHaveProperty('mnemonic')
    expectTypeOf<SeedphraseImportPreludeProgressLabels>().toHaveProperty('validating')
    expectTypeOf<SeedphraseImportPreludeResult>().toHaveProperty('chainsToImport')
  })

  it('exports the chain-discovery aggregate type from the source module and root sdk surface', () => {
    expectTypeOf<SeedphraseChainDiscoveryAggregate>().toEqualTypeOf<{
      results: ChainDiscoveryResult[]
      usePhantomSolanaPath: boolean
      useCosmosPathTerra: boolean
    }>()
    expectTypeOf<RootChainDiscoveryAggregate>().toEqualTypeOf<SeedphraseChainDiscoveryAggregate>()
  })
})
