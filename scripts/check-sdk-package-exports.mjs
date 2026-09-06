#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { createDisposableYarnEnv } from './quality-contracts-cache.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const sdkRoot = path.join(repoRoot, 'packages/sdk')
const sdkManifestPath = path.join(sdkRoot, 'package.json')
const yarnCli = path.join(repoRoot, '.yarn/releases/yarn-4.16.0.cjs')
const platformTargetPattern = /(?:^|[./-])(browser|chrome-extension|react-native|rn-preamble)(?:[./-]|$)/
const runtimeUnsafePlatformPattern = /(?:^|[./-])(react-native|rn-preamble)(?:[./-]|$)/
const builtInTypeConditions = new Set(['types', 'import', 'require', 'node', 'node-addons', 'default'])
const packedDependencyFields = ['dependencies', 'optionalDependencies']
const coordinatedSdkPackageNames = new Set([
  '@vultisig/core-chain',
  '@vultisig/core-mpc',
  '@vultisig/mpc-types',
])

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      [`Command failed: ${command} ${args.join(' ')}`, result.stdout?.trim(), result.stderr?.trim()]
        .filter(Boolean)
        .join('\n\n')
    )
  }
  return result
}

function runYarn(args, options = {}) {
  if (existsSync(yarnCli)) {
    return run(process.execPath, [yarnCli, ...args], options)
  }
  return run('yarn', args, options)
}

export function collectLocalWorkspaceDependencyNames(
  rootPackageName,
  packedManifests,
  localPackageNames = coordinatedSdkPackageNames
) {
  const pending = [rootPackageName]
  const visited = new Set()
  const dependencies = new Set()

  while (pending.length) {
    const packageName = pending.pop()
    if (visited.has(packageName)) continue
    visited.add(packageName)

    const manifest = packedManifests.get(packageName)
    if (!manifest) continue

    for (const field of packedDependencyFields) {
      for (const [dependencyName, selector] of Object.entries(manifest[field] ?? {})) {
        if (dependencyName === rootPackageName || !localPackageNames.has(dependencyName)) continue
        const dependencyManifest = packedManifests.get(dependencyName)
        if (!dependencyManifest) {
          throw new Error(`Missing packed manifest for coordinated SDK dependency ${dependencyName}`)
        }
        if (selector !== dependencyManifest.version) {
          throw new Error(
            `${packageName} requires ${dependencyName}@${selector}, but the coordinated local archive is ` +
              `${dependencyName}@${dependencyManifest.version}`
          )
        }
        if (!dependencies.has(dependencyName)) {
          dependencies.add(dependencyName)
          pending.push(dependencyName)
        }
      }
    }
  }

  return [...dependencies].sort()
}

export function createPackedConsumerManifest(localPackages = {}) {
  return {
    name: 'vultisig-sdk-package-export-consumer',
    private: true,
    type: 'module',
    packageManager: 'yarn@4.16.0',
    ...(Object.keys(localPackages).length ? { resolutions: localPackages } : {}),
  }
}

export function collectExportTargets(exportsField) {
  if (!exportsField || typeof exportsField !== 'object' || Array.isArray(exportsField)) {
    throw new Error('SDK package manifest must declare an object-valued exports map')
  }

  const targets = []
  const visit = (value, subpath, conditions) => {
    if (typeof value === 'string') {
      targets.push({ subpath, conditions, target: value })
      return
    }
    if (Array.isArray(value)) {
      value.forEach((candidate, index) => visit(candidate, subpath, [...conditions, `[${index}]`]))
      return
    }
    if (!value || typeof value !== 'object') {
      throw new Error(`SDK export ${subpath} has an unsupported target at ${conditions.join(' > ') || '<root>'}`)
    }
    for (const [condition, target] of Object.entries(value)) {
      visit(target, subpath, [...conditions, condition])
    }
  }

  for (const [subpath, value] of Object.entries(exportsField)) {
    visit(value, subpath, [])
  }
  return targets
}

export function validatePackedExportTargets(manifest, packageRoot) {
  const targets = collectExportTargets(manifest.exports)
  if (!targets.length) {
    throw new Error('SDK package manifest has no export targets')
  }

  for (const { subpath, conditions, target } of targets) {
    if (!target.startsWith('./')) {
      throw new Error(
        `SDK export ${subpath} target at ${conditions.join(' > ') || '<root>'} is not package-relative: ${target}`
      )
    }
    const artifactPath = path.resolve(packageRoot, target.slice(2))
    const relativeArtifactPath = path.relative(packageRoot, artifactPath)
    if (relativeArtifactPath.startsWith('..') || path.isAbsolute(relativeArtifactPath)) {
      throw new Error(
        `SDK export ${subpath} target escapes the packed artifact at ${conditions.join(' > ') || '<root>'}: ${target}`
      )
    }
    if (!existsSync(artifactPath) || !statSync(artifactPath).isFile()) {
      throw new Error(
        `SDK export ${subpath} file target missing from packed artifact at ${conditions.join(' > ') || '<root>'}: ${target}`
      )
    }
  }

  return targets
}

function validatePackedReactNativeCosmosPayloadExports(packageRoot) {
  const runtimePath = path.join(packageRoot, 'dist/index.react-native.js')
  const declarationsPath = path.join(packageRoot, 'dist/index.react-native.d.ts')
  const runtimeSource = readFileSync(runtimePath, 'utf8')
  const declarationSource = readFileSync(declarationsPath, 'utf8')

  for (const symbol of ['buildSignAminoKeysignPayload', 'buildSignDirectKeysignPayload']) {
    assert.ok(runtimeSource.includes(symbol), `react-native bundle exports ${symbol}`)
    assert.ok(declarationSource.includes(symbol), `react-native types export ${symbol}`)
  }
}

export function resolveConditionalTarget(value, activeConditions) {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const resolved = resolveConditionalTarget(candidate, activeConditions)
      if (resolved) return resolved
    }
    return null
  }
  if (!value || typeof value !== 'object') return null

  for (const [condition, target] of Object.entries(value)) {
    if (condition === 'default' || activeConditions.has(condition)) {
      const resolved = resolveConditionalTarget(target, activeConditions)
      if (resolved) return resolved
    }
  }
  return null
}

function packageSpecifier(packageName, subpath) {
  return subpath === '.' ? packageName : `${packageName}/${subpath.replace(/^\.\//, '')}`
}

export function collectNodeRuntimeCases(manifest, mode) {
  const activeConditions = new Set(['node', mode])
  const cases = []

  for (const [subpath, exportValue] of Object.entries(manifest.exports)) {
    const target = resolveConditionalTarget(exportValue, activeConditions)
    if (!target || platformTargetPattern.test(target)) continue
    cases.push({
      specifier: packageSpecifier(manifest.name, subpath),
      target,
    })
  }
  return cases
}

// These subpaths already get bespoke, hand-curated typed assertions in
// writeConsumerTypeFiles below. Their runtime bundles legitimately export more than their
// "default"-condition declaration promises (e.g. root's neutral `.` declaration is narrower
// than the Node-specific module it loads under the `node` condition, by design), so asserting
// "every runtime key must appear in the type" would flag that intentional asymmetry as a false
// failure. New subpaths are NOT added here automatically - only ones with existing dedicated
// coverage below are excluded, so a newly added export still gets generic coverage for free.
const subpathsWithCuratedTypedAssertions = new Set(['.', './node', './react-native', './electron', './electron/main'])

export function collectIntrospectableRuntimeCases(manifest) {
  const cases = []

  for (const [subpath, exportValue] of Object.entries(manifest.exports)) {
    if (subpathsWithCuratedTypedAssertions.has(subpath)) continue

    let target = resolveConditionalTarget(exportValue, new Set(['node', 'import']))
    if (!target || platformTargetPattern.test(target)) {
      // Node-only resolution missed this subpath (e.g. browser/chrome-extension bundles have
      // no `node` condition). Those are still safe to evaluate under plain Node, so retry with
      // a plain `import` condition and only give up on genuinely RN/worker-only targets.
      const fallback = resolveConditionalTarget(exportValue, new Set(['import']))
      target = fallback && runtimeUnsafePlatformPattern.test(fallback) ? null : fallback
    }
    if (!target) continue
    cases.push({
      specifier: packageSpecifier(manifest.name, subpath),
      target,
    })
  }
  return cases
}

const runtimeExportIntrospectionSource = `
import { writeSync } from 'node:fs'

const moduleUrl = process.argv[1]
try {
  const imported = await import(moduleUrl)
  writeSync(1, JSON.stringify(Object.keys(imported).sort()))
  process.exit(0)
} catch (error) {
  console.error(error?.stack || error)
  process.exit(1)
}
`

export function collectRuntimeExportKeys(packageRoot, cases, { timeoutMs = 10_000 } = {}) {
  const keysBySpecifier = {}
  for (const { specifier, target } of cases) {
    const modulePath = path.join(packageRoot, target.slice(2))
    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '--eval', runtimeExportIntrospectionSource, pathToFileURL(modulePath).href],
      {
        encoding: 'utf8',
        maxBuffer: 20 * 1024 * 1024,
        timeout: timeoutMs,
      }
    )
    const context = `${specifier} target ${target}`
    if (result.error?.code === 'ETIMEDOUT' || result.signal) {
      throw new Error(`SDK runtime export introspection timed out after ${timeoutMs}ms for ${context}`)
    }
    if (result.error) {
      throw new Error(`SDK runtime export introspection failed for ${context}: ${result.error.message}`)
    }
    if (result.status !== 0) {
      throw new Error(
        [`SDK runtime export introspection failed for ${context}`, result.stderr?.trim()].filter(Boolean).join('\n\n')
      )
    }

    let keys
    try {
      keys = JSON.parse(result.stdout)
    } catch (error) {
      throw new Error(`SDK runtime export introspection returned invalid output for ${context}: ${error.message}`)
    }
    if (keys.length) keysBySpecifier[specifier] = keys
  }
  return keysBySpecifier
}

export function collectTypeCustomConditionSets(manifest) {
  const conditionSets = new Map()

  for (const { conditions, target } of collectExportTargets(manifest.exports)) {
    if (!conditions.includes('types') || !/\.d\.(?:ts|mts|cts)$/.test(target)) continue

    const customConditions = conditions.filter(
      condition => !builtInTypeConditions.has(condition) && !/^\[\d+\]$/.test(condition)
    )
    if (!customConditions.length) continue

    const key = JSON.stringify(customConditions)
    if (!conditionSets.has(key)) conditionSets.set(key, customConditions)
  }

  return [...conditionSets.values()]
}

function writeConsumerRuntimeFiles(consumerRoot, importCases, requireCases, localPackages) {
  writeFileSync(
    path.join(consumerRoot, 'package.json'),
    `${JSON.stringify(createPackedConsumerManifest(localPackages), null, 2)}\n`
  )
  writeFileSync(path.join(consumerRoot, '.yarnrc.yml'), 'nodeLinker: node-modules\n')

  writeFileSync(
    path.join(consumerRoot, 'verify-imports.mjs'),
    `import assert from 'node:assert/strict'

const cases = ${JSON.stringify(importCases, null, 2)}
const importedModules = new Map()
for (const { specifier, target } of cases) {
  const resolved = import.meta.resolve(specifier)
  assert.ok(
    new URL(resolved).pathname.endsWith(target.slice(1)),
    \`\${specifier} import resolved to \${resolved}, expected \${target}\`
  )
  const imported = await import(specifier)
  assert.ok(imported && typeof imported === 'object', \`\${specifier} import returned a module namespace\`)
  importedModules.set(specifier, imported)
}

const root = importedModules.get('@vultisig/sdk')
const node = importedModules.get('@vultisig/sdk/node')
const vite = importedModules.get('@vultisig/sdk/vite')
const electronMain = importedModules.get('@vultisig/sdk/electron/main')
assert.equal(typeof root?.Vultisig, 'function', 'root import exports Vultisig')
assert.ok(root?.Chain !== undefined, 'root import exports Chain')
assert.equal(typeof root?.fiatToAmount, 'function', 'root import exports fiatToAmount')
assert.equal(typeof root?.normalizeChain, 'function', 'root import exports normalizeChain')
assert.equal(typeof root?.fromChainAmountExact, 'function', 'root import exports fromChainAmountExact')
assert.equal(typeof root?.getBlockExplorerUrl, 'function', 'root import exports getBlockExplorerUrl')
assert.equal(
  typeof root?.buildSignAminoKeysignPayload,
  'function',
  'root import exports buildSignAminoKeysignPayload'
)
assert.equal(
  typeof root?.buildSignDirectKeysignPayload,
  'function',
  'root import exports buildSignDirectKeysignPayload'
)
assert.ok(root?.chainRegistry !== undefined, 'root import exports chainRegistry')
assert.equal(typeof root?.deriveFromChainRegistry, 'function', 'root import exports deriveFromChainRegistry')
assert.equal(typeof root?.extendChainRegistry, 'function', 'root import exports extendChainRegistry')
assert.equal(typeof node?.Vultisig, 'function', 'node import exports Vultisig')
assert.ok(vite && (vite.default || vite), 'vite import resolves')
assert.equal(typeof electronMain?.Vultisig, 'function', 'electron main import exports Vultisig')
assert.equal(typeof electronMain?.ElectronMainCrypto, 'function', 'electron main import exports ElectronMainCrypto')
console.log(\`SDK package import conditions passed for \${cases.length} manifest exports\`)
`
  )

  writeFileSync(
    path.join(consumerRoot, 'verify-requires.cjs'),
    `const assert = require('node:assert/strict')
const path = require('node:path')

const cases = ${JSON.stringify(requireCases, null, 2)}
const requiredModules = new Map()
for (const { specifier, target } of cases) {
  const resolved = require.resolve(specifier)
  assert.ok(
    resolved.endsWith(path.sep + path.normalize(target.slice(2))),
    \`\${specifier} require resolved to \${resolved}, expected \${target}\`
  )
  const required = require(specifier)
  assert.notEqual(required, undefined, \`\${specifier} require returned a value\`)
  requiredModules.set(specifier, required)
}

assert.equal(typeof requiredModules.get('@vultisig/sdk')?.Vultisig, 'function', 'root require exports Vultisig')
assert.equal(
  typeof requiredModules.get('@vultisig/sdk/electron/main')?.ElectronMainCrypto,
  'function',
  'electron main require exports ElectronMainCrypto'
)
console.log(\`SDK package require conditions passed for \${cases.length} manifest exports\`)
`
  )
}

function writeConsumerTypeFiles(consumerRoot, manifest, runtimeExportKeysBySpecifier) {
  const typeImports = Object.keys(manifest.exports)
    .map(subpath => `import '${packageSpecifier(manifest.name, subpath)}'`)
    .join('\n')

  // Every subpath with runtime-observed exports gets a namespace import plus a compile-time
  // assertion that its declared type actually carries those exact member names. This is what
  // forces TypeScript to resolve the declared `types` target's real shape (not just "some
  // module exists at this specifier") for every subpath, without hand-maintaining a symbol
  // list per subpath - the expected member names are derived from the packed runtime module.
  const specifiers = Object.keys(runtimeExportKeysBySpecifier)
  const declarationAssertions = specifiers
    .map((specifier, index) => {
      const keys = runtimeExportKeysBySpecifier[specifier]
      const alias = `runtimeShape_${index}`
      return `import * as ${alias} from '${specifier}'
const ${alias}Keys: readonly (keyof typeof ${alias})[] = ${JSON.stringify(keys)}
void ${alias}Keys`
    })
    .join('\n')

  writeFileSync(
    path.join(consumerRoot, 'verify-types.ts'),
    `${typeImports}
${declarationAssertions}
import {
  Chain,
  buildSignAminoKeysignPayload,
  buildSignDirectKeysignPayload,
  chainRegistry,
  deriveFromChainRegistry,
  extendChainRegistry,
} from '@vultisig/sdk'
import type {
  BuildSignAminoPayloadInput,
  BuildSignDirectPayloadInput,
  ChainDescriptor,
  ChainDescriptorRegistry,
  ChainExplorerDescriptor,
  ChainExtensionRecord,
  ChainKind,
  ExtendedChainRegistry,
} from '@vultisig/sdk'
import type {
  ChainDescriptor as ReactNativeChainDescriptor,
  ExtendedChainRegistry as ReactNativeExtendedChainRegistry,
} from '@vultisig/sdk/react-native'
import {
  buildSignAminoKeysignPayload as buildSignAminoKeysignPayloadReactNative,
  buildSignDirectKeysignPayload as buildSignDirectKeysignPayloadReactNative,
  type BuildSignAminoPayloadInput as BuildSignAminoPayloadInputReactNative,
  type BuildSignDirectPayloadInput as BuildSignDirectPayloadInputReactNative,
} from '@vultisig/sdk/react-native'
import type { Vultisig } from '@vultisig/sdk/node'
import type { ElectronMainCrypto, Vultisig as ElectronMainVultisig } from '@vultisig/sdk/electron/main'

const descriptor: ChainDescriptor = chainRegistry[Chain.Ethereum]
const registry: ChainDescriptorRegistry = chainRegistry
const explorer: ChainExplorerDescriptor = descriptor.explorer
const extension: ChainExtensionRecord = deriveFromChainRegistry(({ kind }) => ({ kind }))
const extended: ExtendedChainRegistry<typeof extension> = extendChainRegistry(extension)

export type RootChain = Chain
export type NodeClient = Vultisig
export type ElectronClient = ElectronMainVultisig
export type ElectronCrypto = ElectronMainCrypto
export type RegistryKind = ChainKind
export type RegistryDescriptor = typeof descriptor
export type RegistryShape = typeof registry
export type ExplorerShape = typeof explorer
export type ExtendedShape = typeof extended
export type ReactNativeDescriptor = ReactNativeChainDescriptor
export type ReactNativeExtended = ReactNativeExtendedChainRegistry<typeof extension>
export type CosmosAminoInput = BuildSignAminoPayloadInput
export type CosmosDirectInput = BuildSignDirectPayloadInput
export type CosmosAminoInputReactNative = BuildSignAminoPayloadInputReactNative
export type CosmosDirectInputReactNative = BuildSignDirectPayloadInputReactNative
export type CosmosAminoBuilder = typeof buildSignAminoKeysignPayload
export type CosmosDirectBuilder = typeof buildSignDirectKeysignPayload
export type CosmosAminoBuilderReactNative = typeof buildSignAminoKeysignPayloadReactNative
export type CosmosDirectBuilderReactNative = typeof buildSignDirectKeysignPayloadReactNative
`
  )

  const typeConditionSets = [[], ...collectTypeCustomConditionSets(manifest)]
  const typeProjects = typeConditionSets.map((customConditions, index) => {
    const label = customConditions.length ? customConditions.join('+') : 'default'
    const configPath = path.join(consumerRoot, `tsconfig.types-${index}.json`)
    writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          compilerOptions: {
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            strict: true,
            noEmit: true,
            skipLibCheck: true,
            noUncheckedSideEffectImports: true,
            ...(customConditions.length ? { customConditions } : {}),
          },
          include: ['verify-types.ts'],
        },
        null,
        2
      )}\n`
    )
    return { configPath, label }
  })

  return typeProjects
}

function installPackedSdk(consumerRoot, tarballPath) {
  const env = {
    ...createDisposableYarnEnv(consumerRoot),
    YARN_ENABLE_IMMUTABLE_INSTALLS: 'false',
  }
  runYarn(['add', `@vultisig/sdk@file:${tarballPath}`], {
    cwd: consumerRoot,
    env,
    stdio: 'inherit',
  })
  return env
}

function packSdk(tarballPath) {
  runYarn(['workspace', '@vultisig/sdk', 'pack', '--out', tarballPath], {
    cwd: repoRoot,
    stdio: 'inherit',
  })
}

function packLocalSdkDependencies(workRoot, packedSdkManifest) {
  const dependencyRoot = path.join(workRoot, 'sdk-dependencies')
  mkdirSync(dependencyRoot, { recursive: true })
  const packedManifests = new Map([[packedSdkManifest.name, packedSdkManifest]])
  const tarballs = new Map()

  for (const packageName of coordinatedSdkPackageNames) {
    const archiveName = `${packageName.replace(/^@/, '').replaceAll(/[^a-z0-9]+/gi, '-')}.tgz`
    const tarballPath = path.join(dependencyRoot, archiveName)
    runYarn(['workspace', packageName, 'pack', '--out', tarballPath], {
      cwd: repoRoot,
      stdio: 'inherit',
    })
    const extractRoot = path.join(dependencyRoot, `${archiveName}.extract`)
    mkdirSync(extractRoot, { recursive: true })
    run('tar', ['-xzf', tarballPath, '-C', extractRoot])
    packedManifests.set(
      packageName,
      JSON.parse(readFileSync(path.join(extractRoot, 'package', 'package.json'), 'utf8'))
    )
    tarballs.set(packageName, tarballPath)
  }

  return Object.fromEntries(
    collectLocalWorkspaceDependencyNames(packedSdkManifest.name, packedManifests).map(packageName => [
      packageName,
      `file:${tarballs.get(packageName)}`,
    ])
  )
}

export async function checkSdkPackageExports({
  build = true,
  workRoot: providedWorkRoot,
  tarballPath: providedTarballPath,
} = {}) {
  if (build) {
    runYarn(['build:sdk'], { cwd: repoRoot, stdio: 'inherit' })
  }

  const ownsWorkRoot = !providedWorkRoot
  const workRoot = providedWorkRoot ?? mkdtempSync(path.join(os.tmpdir(), 'vultisig-sdk-package-exports-'))
  const tarballPath = providedTarballPath ?? path.join(workRoot, 'sdk.tgz')

  try {
    mkdirSync(workRoot, { recursive: true })
    if (!providedTarballPath) packSdk(tarballPath)

    const extractRoot = path.join(workRoot, 'artifact')
    mkdirSync(extractRoot, { recursive: true })
    run('tar', ['-xzf', tarballPath, '-C', extractRoot])
    const packageRoot = path.join(extractRoot, 'package')

    const sourceManifest = JSON.parse(readFileSync(sdkManifestPath, 'utf8'))
    const packedManifest = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'))
    assert.deepEqual(
      packedManifest.exports,
      sourceManifest.exports,
      'packed SDK exports must match packages/sdk/package.json'
    )

    const targets = validatePackedExportTargets(sourceManifest, packageRoot)
    validatePackedReactNativeCosmosPayloadExports(packageRoot)
    const importCases = collectNodeRuntimeCases(sourceManifest, 'import')
    const requireCases = collectNodeRuntimeCases(sourceManifest, 'require')
    if (!importCases.length || !requireCases.length) {
      throw new Error('SDK package manifest exposes no Node-safe import or require cases')
    }

    const consumerRoot = path.join(workRoot, 'consumer')
    mkdirSync(consumerRoot, { recursive: true })
    const localPackages = packLocalSdkDependencies(workRoot, packedManifest)
    writeConsumerRuntimeFiles(consumerRoot, importCases, requireCases, localPackages)
    const env = installPackedSdk(consumerRoot, tarballPath)

    run(process.execPath, ['verify-imports.mjs'], { cwd: consumerRoot, env, stdio: 'inherit' })
    run(process.execPath, ['verify-requires.cjs'], { cwd: consumerRoot, env, stdio: 'inherit' })

    // Compute expected declaration shapes from the *installed* package (so its transitive
    // dependencies resolve) rather than the raw tarball extraction.
    const installedPackageRoot = path.join(consumerRoot, 'node_modules', sourceManifest.name)
    const introspectableCases = collectIntrospectableRuntimeCases(sourceManifest)
    const runtimeExportKeysBySpecifier = await collectRuntimeExportKeys(installedPackageRoot, introspectableCases)
    const typeProjects = writeConsumerTypeFiles(consumerRoot, sourceManifest, runtimeExportKeysBySpecifier)

    const typescriptBin = path.join(repoRoot, 'node_modules/typescript/bin/tsc')
    if (!existsSync(typescriptBin)) {
      throw new Error('TypeScript is required to verify SDK declarations from the clean consumer')
    }
    for (const { configPath, label } of typeProjects) {
      run(process.execPath, [typescriptBin, '--project', configPath], {
        cwd: consumerRoot,
        env,
        stdio: 'inherit',
      })
      console.log(`SDK package declaration conditions passed: ${label}`)
    }

    console.log(
      `SDK package export manifest OK: ${Object.keys(sourceManifest.exports).length} exports, ` +
        `${targets.length} conditional targets, ${importCases.length} imports, ${requireCases.length} requires, ` +
        `${typeProjects.length} declaration condition sets, ` +
        `${Object.keys(runtimeExportKeysBySpecifier).length} typed declaration assertions`
    )
  } finally {
    if (ownsWorkRoot) rmSync(workRoot, { recursive: true, force: true })
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (isDirectRun) {
  const args = new Set(process.argv.slice(2))
  const unknownArgs = [...args].filter(arg => arg !== '--skip-build')
  if (unknownArgs.length) {
    console.error(`Unknown arguments: ${unknownArgs.join(', ')}`)
    process.exitCode = 1
  } else {
    try {
      await checkSdkPackageExports({ build: !args.has('--skip-build') })
    } catch (error) {
      console.error(error.message || error)
      process.exitCode = 1
    }
  }
}
