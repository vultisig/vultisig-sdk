#!/usr/bin/env node
/**
 * Published package contract validation:
 * - SDK tarball export validation + temp packed-consumer smoke (Node-safe entrypoints)
 * - Core-chain / Rujira / MPC package export target validation from packed tarballs
 * - MCP packed bin metadata + temp installed `vmcp --help` smoke
 * - CLI dist + packed install smoke: --help and hidden `schema` JSON
 *
 * Temp installs use a disposable Yarn cache beneath the run's work root. This
 * prevents unique `file:` archives from accumulating in the user-global cache.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkSdkPackageExports } from './check-sdk-package-exports.mjs'
import { createDisposableYarnEnv } from './quality-contracts-cache.mjs'

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
  const schemaRes = run(process.execPath, [CLI_ENTRY, 'schema'], {
    cwd: repoRoot,
  })
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

function packedPackageGraphSmoke(workRoot, { sdkTgzPath, coreChainTgzPath, coreMpcTgzPath, mpcTypesTgzPath }) {
  const consumer = path.join(workRoot, 'package-graph-consumer')
  mkdirSync(consumer, { recursive: true })

  const localPackages = {
    '@vultisig/core-chain': `file:${coreChainTgzPath}`,
    '@vultisig/core-mpc': `file:${coreMpcTgzPath}`,
    '@vultisig/mpc-types': `file:${mpcTypesTgzPath}`,
    '@vultisig/sdk': `file:${sdkTgzPath}`,
  }
  writeFileSync(
    path.join(consumer, 'package.json'),
    `${JSON.stringify(
      {
        name: 'vultisig-package-graph-consumer',
        private: true,
        type: 'module',
        packageManager: 'yarn@4.16.0',
        dependencies: localPackages,
        resolutions: localPackages,
      },
      null,
      2
    )}\n`
  )
  writeFileSync(path.join(consumer, '.yarnrc.yml'), 'nodeLinker: node-modules\n')
  writeFileSync(
    path.join(consumer, 'verify-package-graph.mjs'),
    `import assert from 'node:assert/strict'
import { buildSignBitcoinFromPsbt } from '@vultisig/core-chain/chains/utxo/tx/buildSignBitcoinFromPsbt'
import { SignBitcoinSchema as compatibilitySchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/wasm_execute_contract_payload_pb'
import { SignBitcoinSchema as canonicalSchema } from '@vultisig/mpc-types/types/vultisig/keysign/v1/wasm_execute_contract_payload_pb'
import { Chain } from '@vultisig/sdk'

assert.strictEqual(compatibilitySchema, canonicalSchema)
const signBitcoin = buildSignBitcoinFromPsbt({
  psbt: {
    data: {
      inputs: [
        {
          witnessUtxo: {
            script: Buffer.from('00140000000000000000000000000000000000000000', 'hex'),
            value: 12_345n,
          },
        },
      ],
    },
    txInputs: [{ hash: Buffer.alloc(32, 1), index: 2, sequence: 0xfffffffe }],
    txOutputs: [{ script: Buffer.from('6a02cafe', 'hex'), value: 1_234n }],
    version: 2,
    locktime: 0,
  },
  senderAddress: '',
})
assert.equal(signBitcoin.$typeName, 'vultisig.keysign.v1.SignBitcoin')
assert.deepEqual(
  {
    hash: signBitcoin.inputs[0].hash,
    index: signBitcoin.inputs[0].index,
    amount: signBitcoin.inputs[0].amount,
    scriptType: signBitcoin.inputs[0].scriptType,
    sequence: signBitcoin.inputs[0].sequence,
  },
  { hash: '01'.repeat(32), index: 2, amount: 12_345n, scriptType: 'p2wpkh', sequence: 0xfffffffe }
)
assert.deepEqual(
  {
    amount: signBitcoin.outputs[0].amount,
    opReturnData: signBitcoin.outputs[0].opReturnData,
    scriptPubKey: signBitcoin.outputs[0].scriptPubKey,
  },
  { amount: 1_234n, opReturnData: 'cafe', scriptPubKey: '6a02cafe' }
)
assert.equal(Chain.Bitcoin, 'Bitcoin')
console.log('Packed package graph ESM smoke passed')
`
  )
  writeFileSync(
    path.join(consumer, 'verify-sdk-require.cjs'),
    `const assert = require('node:assert/strict')
const sdk = require('@vultisig/sdk')
assert.equal(sdk.Chain.Bitcoin, 'Bitcoin')
console.log('Packed SDK CommonJS smoke passed')
`
  )
  writeFileSync(
    path.join(consumer, 'verify-package-graph-types.ts'),
    `import type { SignBitcoin as CanonicalSignBitcoin } from '@vultisig/mpc-types/types/vultisig/keysign/v1/wasm_execute_contract_payload_pb'
import type { SignBitcoin as CompatibleSignBitcoin } from '@vultisig/core-mpc/types/vultisig/keysign/v1/wasm_execute_contract_payload_pb'
import type { buildSignBitcoinFromPsbt } from '@vultisig/core-chain/chains/utxo/tx/buildSignBitcoinFromPsbt'
import type { Chain } from '@vultisig/sdk'

declare const canonical: CanonicalSignBitcoin
const compatible: CompatibleSignBitcoin = canonical
export type PackageGraphBuilder = typeof buildSignBitcoinFromPsbt
export type PackageGraphChain = Chain
void compatible
`
  )
  writeFileSync(
    path.join(consumer, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          noEmit: true,
          skipLibCheck: true,
        },
        include: ['verify-package-graph-types.ts'],
      },
      null,
      2
    )}\n`
  )

  const env = createDisposableYarnEnv(workRoot)
  runYarn(['install', '--no-immutable'], {
    cwd: consumer,
    env,
    stdio: 'inherit',
  })
  run(process.execPath, ['verify-package-graph.mjs'], {
    cwd: consumer,
    env,
    stdio: 'inherit',
  })
  run(process.execPath, ['verify-sdk-require.cjs'], {
    cwd: consumer,
    env,
    stdio: 'inherit',
  })

  const typescriptBin = path.join(repoRoot, 'node_modules/typescript/bin/tsc')
  if (!existsSync(typescriptBin)) {
    throw new Error('TypeScript is required to verify the packed package graph')
  }
  run(process.execPath, [typescriptBin, '--project', 'tsconfig.json'], {
    cwd: consumer,
    env,
    stdio: 'inherit',
  })
  console.log('Packed package graph declaration smoke passed')
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

  const env = createDisposableYarnEnv(workRoot)

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

  const env = createDisposableYarnEnv(workRoot)

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

async function main() {
  assertSdkBuilt()
  smokeCli()

  let workRoot
  try {
    workRoot = mkdtempSync(path.join(os.tmpdir(), 'vultisig-quality-contracts-'))

    const tgzPath = packWorkspace(workRoot, '@vultisig/sdk', 'sdk.tgz')

    await checkSdkPackageExports({
      build: false,
      workRoot: path.join(workRoot, 'sdk-package-exports'),
      tarballPath: tgzPath,
    })

    const { tgzPath: rujiraTgzPath } = validatePackedWorkspaceExports(workRoot, '@vultisig/rujira')

    const packageContracts = new Map()
    for (const workspaceName of PACKAGE_CONTRACT_WORKSPACES) {
      packageContracts.set(workspaceName, validatePackedWorkspaceExports(workRoot, workspaceName))
    }

    const { tgzPath: coreConfigTgzPath } = validatePackedWorkspaceExports(workRoot, '@vultisig/core-config')

    const { tgzPath: libUtilsTgzPath } = validatePackedWorkspaceExports(workRoot, '@vultisig/lib-utils')

    const { packageRoot: coreChainPackageRoot, tgzPath: coreChainTgzPath } = validatePackedWorkspaceExports(
      workRoot,
      '@vultisig/core-chain'
    )
    validateWindowsCoreChainExports(coreChainPackageRoot)

    const { tgzPath: coreMpcTgzPath } = validatePackedWorkspaceExports(workRoot, '@vultisig/core-mpc')

    packedPackageGraphSmoke(workRoot, {
      sdkTgzPath: tgzPath,
      coreChainTgzPath,
      coreMpcTgzPath,
      mpcTypesTgzPath: packageContracts.get('@vultisig/mpc-types').tgzPath,
    })

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
  await main()
} catch (e) {
  console.error(e.message || e)
  process.exitCode = 1
}
