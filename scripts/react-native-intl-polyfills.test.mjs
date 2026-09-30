import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('React Native Intl cascade initializes without Hermes Intl globals', () => {
  const source = `
globalThis.Intl = {}
for (const specifier of [
  '@formatjs/intl-getcanonicallocales/polyfill.js',
  '@formatjs/intl-locale/polyfill.js',
  '@formatjs/intl-numberformat/polyfill.js',
  '@formatjs/intl-numberformat/locale-data/en.js',
  '@formatjs/intl-pluralrules/polyfill.js',
  '@formatjs/intl-pluralrules/locale-data/en.js',
]) await import(specifier)
if (Intl.getCanonicalLocales('en-us')[0] !== 'en-US') throw new Error('getCanonicalLocales failed')
if (new Intl.Locale('en-US').toString() !== 'en-US') throw new Error('Locale failed')
if (new Intl.NumberFormat('en').format(1234.5) !== '1,234.5') throw new Error('English NumberFormat failed')
if (new Intl.PluralRules('en').select(2) !== 'other') throw new Error('English PluralRules failed')
if (new Intl.PluralRules('en', { type: 'ordinal' }).select(2) !== 'two') throw new Error('Sui ordinal PluralRules failed')
`
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 10_000,
  })
  assert.equal(result.status, 0, result.stderr || result.error?.message)
})
