#!/usr/bin/env node
/**
 * Published package contract validation:
 * - SDK tarball export validation + temp packed-consumer smoke (Node-safe entrypoints)
 * - Core-chain / Rujira / MPC package export target validation from packed tarballs
 * - MCP packed bin metadata + temp installed `vmcp --help` smoke
 * - CLI dist + packed install smoke: --help and hidden `schema` JSON
 *
 * Temp installs use YARN_CACHE_FOLDER pointing at the repo's Yarn cache so CI stays
 * mostly offline after `yarn install --immutable`.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

const CLI_ENTRY = path.join(repoRoot, 'clients/cli/dist/index.js')
const SDK_DIST_MARKER = path.join(repoRoot, 'packages/sdk/dist/index.node.esm.js')
const YARN_CLI = path.join(repoRoot, '.yarn/releases/yarn-4.16.0.cjs')
const PACKAGE_CONTRACT_WORKSPACES = ['@vultisig/mpc-types', '@vultisig/mpc-wasm']
const WINDOWS_CORE_CHAIN_EXPORTS = [
  './chains/thorchain/ruji/services/fetchMergeableTokenBalances',
  './chains/thorchain/ruji/services/fetchStakeView',
]
const NODE_BUILTINS = new Set(builtinModules.map(name => name.replace(/^node:/, '')))

/** Collect relative paths like `./dist/foo.js` from package.json `exports` */
function collectExportRelativePaths(exportsField, out = new Set()) {
  if (!exportsField) return out
  if (typeof exportsField === 'string') {
    if (exportsField.startsWith('./')) out.add(exportsField)
    return out
  }
  if (Array.isArray(exportsField)) {
    for (const x of exportsField) collectExportRelativePaths(x, out)
    return out
  }
  if (exportsField && typeof exportsField === 'object') {
    for (const v of Object.values(exportsField)) collectExportRelativePaths(v, out)
  }
  return out
}

function packageRelativePath(packageRoot, rel) {
  return path.join(packageRoot, rel.startsWith('./') ? rel.slice(2) : rel)
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    ...opts,
  })
  if (res.error) throw res.error
  if (res.status !== 0) {
    const msg = [`Command failed: ${cmd} ${args.join(' ')}`, res.stdout?.trim(), res.stderr?.trim()]
      .filter(Boolean)
      .join('\n\n')
    throw new Error(msg)
  }
  return res
}

/** Prefer repo-pinned Yarn so pack/add behave like CI. */
function runYarn(args, opts = {}) {
  if (existsSync(YARN_CLI)) {
    return run(process.execPath, [YARN_CLI, ...args], opts)
  }
  return run('yarn', args, opts)
}

function assertCliBuilt() {
  if (!existsSync(CLI_ENTRY)) {
    throw new Error(`Missing ${CLI_ENTRY}. Run \`yarn cli:build\` before \`yarn quality:contracts\`.`)
  }
}

function assertSdkBuilt() {
  if (!existsSync(SDK_DIST_MARKER)) {
    throw new Error(`Missing ${SDK_DIST_MARKER}. Run \`yarn build:sdk\` before \`yarn quality:contracts\`.`)
  }
}

function validateCliSchemaOutput(stdout, label) {
  let schema
  try {
    schema = JSON.parse(stdout.trim())
  } catch (e) {
    throw new Error(`${label} stdout is not valid JSON: ${e.message}\n${stdout.slice(0, 500)}`)
  }
  if (schema.name !== 'vultisig') {
    throw new Error(`Expected schema.name "vultisig", got ${JSON.stringify(schema.name)}`)
  }
  if (typeof schema.version !== 'string' || !schema.version) {
    throw new Error('Expected non-empty schema.version string')
  }
  if (!Array.isArray(schema.globalOptions)) {
    throw new Error('Expected schema.globalOptions to be an array')
  }
  if (!Array.isArray(schema.commands) || schema.commands.length < 5) {
    throw new Error(`Expected schema.commands to be a non-trivial array, got ${schema.commands?.length}`)
  }
  if (!schema.exitCodes || typeof schema.exitCodes !== 'object') {
    throw new Error('Expected schema.exitCodes object')
  }
}

function smokeCli() {
  assertCliBuilt()
  run(process.execPath, [CLI_ENTRY, '--help'], { cwd: repoRoot })
  const schemaRes = run(process.execPath, [CLI_ENTRY, 'schema'], { cwd: repoRoot })
  validateCliSchemaOutput(schemaRes.stdout, 'CLI "schema"')
}

function validateTarballExportFiles(packageRoot) {
  const pkgPath = path.join(packageRoot, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const rels = collectExportRelativePaths(pkg.exports)
  if (!rels.size) throw new Error(`${pkg.name} packed package.json has no resolvable export paths`)
  for (const rel of rels) {
    const abs = packageRelativePath(packageRoot, rel)
    if (!existsSync(abs)) {
      throw new Error(`${pkg.name} export target missing from packed tarball: ${rel} -> ${abs}`)
    }
  }
}

function validateWindowsCoreChainExports(packageRoot) {
  const pkgPath = path.join(packageRoot, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))

  for (const subpath of WINDOWS_CORE_CHAIN_EXPORTS) {
    const contract = pkg.exports?.[subpath]
    if (!contract) {
      throw new Error(`@vultisig/core-chain is missing a Windows consumer export: ${subpath}`)
    }

    const rels = collectExportRelativePaths(contract)
    if (!rels.size) {
      throw new Error(`@vultisig/core-chain Windows consumer export has no target: ${subpath}`)
    }

    for (const rel of rels) {
      const abs = packageRelativePath(packageRoot, rel)
      if (!existsSync(abs)) {
        throw new Error(`@vultisig/core-chain Windows consumer target is missing: ${subpath} -> ${rel}`)
      }
    }
  }
}

function validateTarballBinFiles(packageRoot, expectedBins) {
  const pkgPath = path.join(packageRoot, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  if (!pkg.bin || typeof pkg.bin !== 'object' || Array.isArray(pkg.bin)) {
    throw new Error(`${pkg.name} packed package.json has no bin map`)
  }

  for (const binName of expectedBins) {
    const rel = pkg.bin[binName]
    if (typeof rel !== 'string' || !rel) {
      throw new Error(`${pkg.name} packed package.json is missing bin ${binName}`)
    }

    const abs = packageRelativePath(packageRoot, rel)
    if (!existsSync(abs)) {
      throw new Error(`${pkg.name} bin target missing from packed tarball: ${binName} -> ${abs}`)
    }

    const mode = statSync(abs).mode
    if ((mode & 0o111) === 0) {
      throw new Error(`${pkg.name} bin target is not executable in packed tarball: ${binName} -> ${abs}`)
    }

    const firstLine = readFileSync(abs, 'utf8').split(/\r?\n/, 1)[0]
    if (!firstLine.startsWith('#!/usr/bin/env node')) {
      throw new Error(`${pkg.name} bin target is missing the Node shebang: ${binName} -> ${abs}`)
    }
  }
}

function validatePackedCliRuntimeDependencies(packageRoot) {
  const pkgPath = path.join(packageRoot, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const entryRel = pkg.bin?.vultisig ?? pkg.bin?.vsig
  if (typeof entryRel !== 'string' || !entryRel) {
    throw new Error(`${pkg.name} packed package.json is missing a CLI bin entry`)
  }

  const entrySource = readFileSync(packageRelativePath(packageRoot, entryRel), 'utf8')
  const importedRuntimePackages = new Set()
  const importPatterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]/g,
    /\brequire\(\s*['"]([^'"]+)['"]/g,
  ]

  for (const pattern of importPatterns) {
    let match
    while ((match = pattern.exec(entrySource)) !== null) {
      const packageName = runtimePackageName(match[1])
      if (packageName) {
        importedRuntimePackages.add(packageName)
      }
    }
  }

  const runtimeDeps = pkg.dependencies ?? {}
  const missing = [...importedRuntimePackages]
    .filter(name => name !== pkg.name && !Object.hasOwn(runtimeDeps, name))
    .sort()
  if (missing.length) {
    throw new Error(
      `${pkg.name} packed CLI imports runtime packages not declared in dependencies: ${missing.join(', ')}`
    )
  }
}

function runtimePackageName(specifier) {
  if (specifier.includes('${')) {
    return null
  }

  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('data:')) {
    return null
  }

  const bareSpecifier = specifier.replace(/^node:/, '')
  const [baseSpecifier] = bareSpecifier.split('/')
  if (NODE_BUILTINS.has(bareSpecifier) || NODE_BUILTINS.has(baseSpecifier)) {
    return null
  }

  if (specifier.startsWith('@')) {
    const [scope, name] = specifier.split('/')
    return scope && name ? `${scope}/${name}` : null
  }

  return baseSpecifier || null
}

function packWorkspace(workRoot, workspaceName, outName) {
  const tgzPath = path.join(workRoot, outName)
  runYarn(['workspace', workspaceName, 'pack', '--out', tgzPath], {
    cwd: repoRoot,
    stdio: 'inherit',
  })
  return tgzPath
}

function extractPackage(workRoot, tgzPath, folderName) {
  const extractRoot = path.join(workRoot, 'extract', folderName)
  mkdirSync(extractRoot, { recursive: true })
  run('tar', ['-xzf', tgzPath, '-C', extractRoot])
  return path.join(extractRoot, 'package')
}

function validatePackedWorkspaceExports(workRoot, workspaceName) {
  const outName = `${workspaceName.replace(/^@/, '').replaceAll(/[^a-z0-9]+/gi, '-')}.tgz`
  const tgzPath = packWorkspace(workRoot, workspaceName, outName)
  const packageRoot = extractPackage(workRoot, tgzPath, outName.replace(/\.tgz$/, ''))
  validateTarballExportFiles(packageRoot)
  return { packageRoot, tgzPath }
}

function packedConsumerSmoke(workRoot, tgzPath) {
  const consumer = path.join(workRoot, 'consumer')
  mkdirSync(consumer, { recursive: true })

  writeFileSync(
    path.join(consumer, 'package.json'),
    JSON.stringify(
      {
        name: 'vultisig-contract-consumer',
        private: true,
        type: 'module',
        packageManager: 'yarn@4.16.0',
      },
      null,
      2
    ) + '\n'
  )
  writeFileSync(path.join(consumer, '.yarnrc.yml'), 'nodeLinker: node-modules\n')

  const cacheFolder = path.join(repoRoot, '.yarn/cache')
  const env = {
    ...process.env,
    ...(existsSync(cacheFolder) ? { YARN_CACHE_FOLDER: cacheFolder } : {}),
  }

  runYarn(['add', `@vultisig/sdk@file:${tgzPath}`], { cwd: consumer, env, stdio: 'inherit' })

  const verifyPath = path.join(consumer, 'verify-contracts.mjs')
  writeFileSync(
    verifyPath,
    `import assert from 'node:assert/strict'
import * as root from '@vultisig/sdk'
import * as node from '@vultisig/sdk/node'
import * as browser from '@vultisig/sdk/browser'
import * as seedphrase from '@vultisig/sdk/seedphrase'
import * as vite from '@vultisig/sdk/vite'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const entry = require.resolve('@vultisig/sdk')
const pkgDir = path.resolve(path.dirname(entry), '..')
const electronMainEntry = require.resolve('@vultisig/sdk/electron/main')
const reactNativeEntry = require.resolve('@vultisig/sdk/react-native')
const seedphraseEntry = require.resolve('@vultisig/sdk/seedphrase')
const electronMain = require('@vultisig/sdk/electron/main')
const seedphraseRequire = require('@vultisig/sdk/seedphrase')
const electronMainImport = await import('@vultisig/sdk/electron/main')

assert.equal(typeof root.Vultisig, 'function', 'root exports Vultisig')
assert.ok(root.Chain !== undefined, 'root exports Chain')
assert.equal(typeof root.fiatToAmount, 'function', 'root exports fiatToAmount')
assert.equal(typeof root.normalizeChain, 'function', 'root exports normalizeChain')
assert.equal(typeof root.fromChainAmountExact, 'function', 'root exports fromChainAmountExact')
assert.equal(typeof root.getBlockExplorerUrl, 'function', 'root exports getBlockExplorerUrl')
assert.equal(typeof root.assertUtxoAddressBrand, 'function', 'root exports assertUtxoAddressBrand')
assert.equal(typeof root.isUtxoAddressBrandValid, 'function', 'root exports isUtxoAddressBrandValid')
assert.equal(
  root.isUtxoAddressBrandValid('D5ERdEN1gsouFSs7zsq7VYJxyWP6dP28H1', 'Dogecoin'),
  true,
  'packed root validates a Dogecoin address for Dogecoin'
)
assert.equal(
  root.isUtxoAddressBrandValid('D5ERdEN1gsouFSs7zsq7VYJxyWP6dP28H1', 'Bitcoin'),
  false,
  'packed root rejects a Dogecoin address for Bitcoin'
)
assert.throws(
  () => root.assertUtxoAddressBrand('D5ERdEN1gsouFSs7zsq7VYJxyWP6dP28H1', 'Bitcoin'),
  /UTXO address brand mismatch/,
  'packed root exposes the throwing UTXO brand guard'
)
assert.ok(root.chainRegistry !== undefined, 'root exports chainRegistry')
assert.equal(typeof root.deriveFromChainRegistry, 'function', 'root exports deriveFromChainRegistry')
assert.equal(typeof root.extendChainRegistry, 'function', 'root exports extendChainRegistry')
assert.equal(root.evm.encodeErc20Approve, root.encodeErc20Approve, 'root exposes sdk.evm')
assert.equal(root.token.resolveContract, root.resolveContract, 'root exposes sdk.token')
assert.equal(
  root.cosmos.gov.getCosmosGovernanceProposals,
  root.getCosmosGovernanceProposals,
  'root exposes sdk.cosmos.gov'
)
assert.equal(root.cosmos.gov.prepareCosmosVote, root.prepareCosmosVote, 'sdk.cosmos.gov keeps the flat vote helper')

assert.equal(typeof node.Vultisig, 'function', '@vultisig/sdk/node exports Vultisig')
assert.equal(node.evm.encodeErc20Approve, node.encodeErc20Approve, '@vultisig/sdk/node exposes sdk.evm')
assert.equal(node.token.resolveContract, node.resolveContract, '@vultisig/sdk/node exposes sdk.token')
assert.equal(
  node.cosmos.gov.prepareCosmosVote,
  node.prepareCosmosVote,
  '@vultisig/sdk/node exposes sdk.cosmos.gov'
)

assert.equal(
  path.basename(seedphraseEntry),
  'index.cjs',
  '@vultisig/sdk/seedphrase resolves the dedicated CommonJS bundle'
)
assert.equal(typeof seedphraseRequire.normalizeMnemonic, 'function', 'CommonJS seedphrase subpath loads')
assert.equal(seedphrase.normalizeMnemonic('  ABANDON   ABANDON  '), 'abandon abandon')
assert.equal(
  seedphrase.detectMnemonicLanguage(
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
  ),
  'english'
)
assert.equal(typeof seedphrase.SeedphraseValidator, 'function')
assert.equal(typeof seedphrase.MasterKeyDeriver, 'function')
assert.equal(typeof seedphrase.ChainDiscoveryService, 'function')

assert.ok(browser.Chain !== undefined, '@vultisig/sdk/browser resolves')
assert.equal(browser.evm.encodeErc20Approve, browser.encodeErc20Approve, '@vultisig/sdk/browser exposes sdk.evm')
assert.equal(browser.token.resolveContract, browser.resolveContract, '@vultisig/sdk/browser exposes sdk.token')
assert.equal(
  browser.cosmos.gov.prepareCosmosVote,
  browser.prepareCosmosVote,
  '@vultisig/sdk/browser exposes sdk.cosmos.gov'
)
assert.ok(vite && (vite.default || vite), '@vultisig/sdk/vite resolves')
assert.equal(
  path.basename(reactNativeEntry),
  'index.react-native.js',
  '@vultisig/sdk/react-native resolves the React Native bundle'
)
assert.equal(
  path.basename(electronMainEntry),
  'index.electron-main.cjs',
  '@vultisig/sdk/electron/main resolves the Electron main process bundle'
)
assert.equal(typeof electronMain.Vultisig, 'function', '@vultisig/sdk/electron/main exports Vultisig')
assert.equal(typeof electronMainImport.Vultisig, 'function', 'ESM import resolves @vultisig/sdk/electron/main')
assert.equal(
  typeof electronMainImport.ElectronMainCrypto,
  'function',
  'ESM import exposes Electron-specific exports'
)

const rnJs = path.join(pkgDir, 'dist/index.react-native.js')
assert.ok(existsSync(rnJs), 'react-native bundle file exists on disk')
const rnDts = path.join(pkgDir, 'dist/index.react-native.d.ts')
assert.ok(existsSync(rnDts), 'react-native types exist on disk')
for (const symbol of [
  'chainRegistry',
  'deriveFromChainRegistry',
  'extendChainRegistry',
  'getBlockExplorerUrl',
  'assertUtxoAddressBrand',
  'isUtxoAddressBrandValid',
]) {
  assert.ok(readFileSync(rnJs, 'utf8').includes(symbol), \`react-native bundle exports \${symbol}\`)
  assert.ok(readFileSync(rnDts, 'utf8').includes(symbol), \`react-native types export \${symbol}\`)
}
const electronMainDts = path.join(pkgDir, 'dist/index.electron-main.d.ts')
assert.ok(existsSync(electronMainDts), 'electron main types exist on disk')
`
  )

  run(process.execPath, [verifyPath], { cwd: consumer, env })

  // Optional: TypeScript can resolve subpaths (declaration smoke via tsc if available)
  const tscBin = path.join(repoRoot, 'node_modules/typescript/bin/tsc')
  if (existsSync(tscBin)) {
    const tsconfig = {
      compilerOptions: {
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        noEmit: true,
        skipLibCheck: true,
      },
    }
    writeFileSync(path.join(consumer, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2) + '\n')
    writeFileSync(
      path.join(consumer, 'types-smoke.ts'),
      `import {
  Chain,
  assertUtxoAddressBrand,
  chainRegistry,
  deriveFromChainRegistry,
  extendChainRegistry,
  isUtxoAddressBrandValid,
} from '@vultisig/sdk'
import type {
  ChainDescriptor,
  ChainDescriptorRegistry,
  ChainExplorerDescriptor,
  ChainExtensionRecord,
  ChainKind,
  ExtendedChainRegistry,
  UtxoChainName,
} from '@vultisig/sdk'
import {
  assertUtxoAddressBrand as assertReactNativeUtxoAddressBrand,
  isUtxoAddressBrandValid as isReactNativeUtxoAddressBrandValid,
} from '@vultisig/sdk/react-native'
import type {
  ChainDescriptor as ReactNativeChainDescriptor,
  ExtendedChainRegistry as ReactNativeExtendedChainRegistry,
  UtxoChainName as ReactNativeUtxoChainName,
} from '@vultisig/sdk/react-native'
import type { Vultisig } from '@vultisig/sdk/node'
import type { ElectronMainCrypto, Vultisig as ElectronMainVultisig } from '@vultisig/sdk/electron/main'
import { cosmos, evm, token } from '@vultisig/sdk'
import {
  normalizeMnemonic,
  type Bip39Language,
  type ChainDiscoveryResult,
  type SeedphraseValidation,
} from '@vultisig/sdk/seedphrase'
import '@vultisig/sdk/browser'
import '@vultisig/sdk/vite'

const descriptor: ChainDescriptor = chainRegistry[Chain.Ethereum]
const registry: ChainDescriptorRegistry = chainRegistry
const explorer: ChainExplorerDescriptor = descriptor.explorer
const extension: ChainExtensionRecord = deriveFromChainRegistry(({ kind }) => ({ kind }))
const extended: ExtendedChainRegistry<typeof extension> = extendChainRegistry(extension)
const utxoChain: UtxoChainName = 'Bitcoin'
const reactNativeUtxoChain: ReactNativeUtxoChainName = 'Litecoin'
const rootUtxoBrandValid: boolean = isUtxoAddressBrandValid(
  'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
  utxoChain
)
const reactNativeUtxoBrandValid: boolean = isReactNativeUtxoAddressBrandValid(
  'ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9',
  reactNativeUtxoChain
)
assertUtxoAddressBrand('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', utxoChain)
assertReactNativeUtxoAddressBrand(
  'ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9',
  reactNativeUtxoChain
)

export type X = Chain
export type Y = Vultisig
export type Z = ElectronMainVultisig
export type ElectronCrypto = ElectronMainCrypto
export type RegistryKind = ChainKind
export type RegistryDescriptor = typeof descriptor
export type RegistryShape = typeof registry
export type ExplorerShape = typeof explorer
export type ExtendedShape = typeof extended
export type ReactNativeDescriptor = ReactNativeChainDescriptor
export type ReactNativeExtended = ReactNativeExtendedChainRegistry<typeof extension>
export type CosmosNamespace = typeof cosmos
export type EvmNamespace = typeof evm
export type TokenNamespace = typeof token
export type RootUtxoBrandResult = typeof rootUtxoBrandValid
export type ReactNativeUtxoBrandResult = typeof reactNativeUtxoBrandValid
export type SeedphraseLanguage = Bip39Language
export type SeedphraseDiscovery = ChainDiscoveryResult
export type SeedphraseValidationResult = SeedphraseValidation
export const normalizedMnemonic: string = normalizeMnemonic(' ABANDON  ABOUT ')
`
    )
    run(process.execPath, [tscBin, '-p', path.join(consumer, 'tsconfig.json')], {
      cwd: consumer,
      env,
    })
  }
}

function packedCliBinSmoke(
  workRoot,
  cliTgzPath,
  sdkTgzPath,
  clientSharedTgzPath,
  rujiraTgzPath,
  coreChainTgzPath,
  coreConfigTgzPath,
  libUtilsTgzPath
) {
  const consumer = path.join(workRoot, 'cli-consumer')
  mkdirSync(consumer, { recursive: true })

  const localDeps = {
    '@vultisig/cli': `file:${cliTgzPath}`,
    '@vultisig/client-shared': `file:${clientSharedTgzPath}`,
    '@vultisig/core-chain': `file:${coreChainTgzPath}`,
    '@vultisig/core-config': `file:${coreConfigTgzPath}`,
    '@vultisig/lib-utils': `file:${libUtilsTgzPath}`,
    '@vultisig/rujira': `file:${rujiraTgzPath}`,
    '@vultisig/sdk': `file:${sdkTgzPath}`,
  }
  const dependencies = {
    '@vultisig/cli': localDeps['@vultisig/cli'],
  }

  writeFileSync(
    path.join(consumer, 'package.json'),
    JSON.stringify(
      {
        name: 'vultisig-cli-contract-consumer',
        private: true,
        type: 'module',
        packageManager: 'yarn@4.16.0',
        dependencies,
        resolutions: localDeps,
      },
      null,
      2
    ) + '\n'
  )
  writeFileSync(path.join(consumer, '.yarnrc.yml'), 'nodeLinker: node-modules\n')

  const cacheFolder = path.join(repoRoot, '.yarn/cache')
  const env = {
    ...process.env,
    ...(existsSync(cacheFolder) ? { YARN_CACHE_FOLDER: cacheFolder } : {}),
  }

  runYarn(['install', '--no-immutable'], {
    cwd: consumer,
    env,
    stdio: 'inherit',
  })

  for (const binName of ['vsig', 'vultisig']) {
    const binPath = path.join(consumer, 'node_modules/.bin', binName)
    if (!existsSync(binPath)) {
      throw new Error(`Packed CLI install did not create expected bin: ${binName}`)
    }
  }

  const vsigHelp = run(path.join(consumer, 'node_modules/.bin/vsig'), ['--help'], {
    cwd: consumer,
    env,
  })
  const helpOutput = `${vsigHelp.stdout}\n${vsigHelp.stderr}`
  if (!helpOutput.includes('Usage: vultisig') || !helpOutput.includes('Vultisig CLI')) {
    throw new Error('Packed CLI vsig --help output did not include expected CLI usage.')
  }

  const schemaRes = run(path.join(consumer, 'node_modules/.bin/vultisig'), ['schema'], {
    cwd: consumer,
    env,
  })
  validateCliSchemaOutput(schemaRes.stdout, 'Packed CLI "schema"')
}

function packedMcpBinSmoke(workRoot, tgzPath, sdkTgzPath, clientSharedTgzPath) {
  const consumer = path.join(workRoot, 'mcp-consumer')
  mkdirSync(consumer, { recursive: true })

  writeFileSync(
    path.join(consumer, 'package.json'),
    JSON.stringify(
      {
        name: 'vultisig-mcp-contract-consumer',
        private: true,
        type: 'module',
        packageManager: 'yarn@4.16.0',
        dependencies: {
          '@vultisig/client-shared': `file:${clientSharedTgzPath}`,
          '@vultisig/mcp': `file:${tgzPath}`,
          '@vultisig/sdk': `file:${sdkTgzPath}`,
        },
        resolutions: {
          '@vultisig/client-shared': `file:${clientSharedTgzPath}`,
          '@vultisig/sdk': `file:${sdkTgzPath}`,
        },
      },
      null,
      2
    ) + '\n'
  )
  writeFileSync(path.join(consumer, '.yarnrc.yml'), 'nodeLinker: node-modules\n')

  const cacheFolder = path.join(repoRoot, '.yarn/cache')
  const env = {
    ...process.env,
    ...(existsSync(cacheFolder) ? { YARN_CACHE_FOLDER: cacheFolder } : {}),
  }

  runYarn(['install', '--no-immutable'], {
    cwd: consumer,
    env,
    stdio: 'inherit',
  })

  for (const binName of ['vmcp', 'vultisig-mcp']) {
    const binPath = path.join(consumer, 'node_modules/.bin', binName)
    if (!existsSync(binPath)) {
      throw new Error(`Packed MCP install did not create expected bin: ${binName}`)
    }
  }

  const vmcpHelp = run(path.join(consumer, 'node_modules/.bin/vmcp'), ['--help'], {
    cwd: consumer,
    env,
  })
  const output = `${vmcpHelp.stdout}\n${vmcpHelp.stderr}`
  if (!output.includes('vultisig-mcp') || !output.includes('--profile <harness|defi>')) {
    throw new Error('Packed MCP vmcp --help output did not include expected CLI usage.')
  }
}

function main() {
  assertSdkBuilt()
  smokeCli()

  let workRoot
  try {
    workRoot = mkdtempSync(path.join(os.tmpdir(), 'vultisig-quality-contracts-'))

    const tgzPath = packWorkspace(workRoot, '@vultisig/sdk', 'sdk.tgz')

    validateTarballExportFiles(extractPackage(workRoot, tgzPath, 'sdk'))

    packedConsumerSmoke(workRoot, tgzPath)

    const { tgzPath: rujiraTgzPath } = validatePackedWorkspaceExports(workRoot, '@vultisig/rujira')

    for (const workspaceName of PACKAGE_CONTRACT_WORKSPACES) {
      validatePackedWorkspaceExports(workRoot, workspaceName)
    }

    const { tgzPath: coreConfigTgzPath } = validatePackedWorkspaceExports(workRoot, '@vultisig/core-config')

    const { tgzPath: libUtilsTgzPath } = validatePackedWorkspaceExports(workRoot, '@vultisig/lib-utils')

    const { packageRoot: coreChainPackageRoot, tgzPath: coreChainTgzPath } = validatePackedWorkspaceExports(
      workRoot,
      '@vultisig/core-chain'
    )
    validateWindowsCoreChainExports(coreChainPackageRoot)

    const { tgzPath: clientSharedTgzPath } = validatePackedWorkspaceExports(workRoot, '@vultisig/client-shared')

    const cliTgzPath = packWorkspace(workRoot, '@vultisig/cli', 'cli.tgz')
    const cliPackageRoot = extractPackage(workRoot, cliTgzPath, 'cli')
    validateTarballBinFiles(cliPackageRoot, ['vsig', 'vultisig'])
    validatePackedCliRuntimeDependencies(cliPackageRoot)
    packedCliBinSmoke(
      workRoot,
      cliTgzPath,
      tgzPath,
      clientSharedTgzPath,
      rujiraTgzPath,
      coreChainTgzPath,
      coreConfigTgzPath,
      libUtilsTgzPath
    )

    const mcpTgzPath = packWorkspace(workRoot, '@vultisig/mcp', 'mcp.tgz')
    const mcpPackageRoot = extractPackage(workRoot, mcpTgzPath, 'mcp')
    validateTarballBinFiles(mcpPackageRoot, ['vmcp', 'vultisig-mcp'])
    packedMcpBinSmoke(workRoot, mcpTgzPath, tgzPath, clientSharedTgzPath)

    console.log('quality:contracts OK')
  } finally {
    if (workRoot) {
      try {
        rmSync(workRoot, { recursive: true, force: true })
      } catch {
        /* ignore cleanup errors */
      }
    }
  }
}

try {
  main()
} catch (e) {
  console.error(e.message || e)
  process.exitCode = 1
}
