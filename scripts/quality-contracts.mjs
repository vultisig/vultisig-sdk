#!/usr/bin/env node
/**
 * Published package contract validation:
 * - SDK tarball export validation + temp packed-consumer smoke (Node-safe entrypoints)
 * - Rujira / MPC package export target validation from packed tarballs
 * - MCP packed bin metadata + temp installed `vmcp --help` smoke
 * - CLI dist smoke: --help and hidden `schema` JSON
 *
 * Temp installs use YARN_CACHE_FOLDER pointing at the repo's Yarn cache so CI stays
 * mostly offline after `yarn install --immutable`.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

const CLI_ENTRY = path.join(repoRoot, 'clients/cli/dist/index.js')
const SDK_DIST_MARKER = path.join(repoRoot, 'packages/sdk/dist/index.node.esm.js')
const YARN_CLI = path.join(repoRoot, '.yarn/releases/yarn-4.13.0.cjs')
const PACKAGE_CONTRACT_WORKSPACES = [
  '@vultisig/rujira',
  '@vultisig/mpc-types',
  '@vultisig/mpc-wasm',
]

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
    throw new Error(
      `Missing ${CLI_ENTRY}. Run \`yarn cli:build\` before \`yarn quality:contracts\`.`
    )
  }
}

function assertSdkBuilt() {
  if (!existsSync(SDK_DIST_MARKER)) {
    throw new Error(
      `Missing ${SDK_DIST_MARKER}. Run \`yarn build:sdk\` before \`yarn quality:contracts\`.`
    )
  }
}

function smokeCli() {
  assertCliBuilt()
  run(process.execPath, [CLI_ENTRY, '--help'], { cwd: repoRoot })
  const schemaRes = run(process.execPath, [CLI_ENTRY, 'schema'], { cwd: repoRoot })
  let schema
  try {
    schema = JSON.parse(schemaRes.stdout.trim())
  } catch (e) {
    throw new Error(`CLI "schema" stdout is not valid JSON: ${e.message}\n${schemaRes.stdout.slice(0, 500)}`)
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
        packageManager: 'yarn@4.13.0',
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
import * as vite from '@vultisig/sdk/vite'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const entry = require.resolve('@vultisig/sdk')
const pkgDir = path.resolve(path.dirname(entry), '..')

assert.equal(typeof root.Vultisig, 'function', 'root exports Vultisig')
assert.ok(root.Chain !== undefined, 'root exports Chain')
assert.equal(typeof root.fiatToAmount, 'function', 'root exports fiatToAmount')
assert.equal(typeof root.normalizeChain, 'function', 'root exports normalizeChain')

assert.equal(typeof node.Vultisig, 'function', '@vultisig/sdk/node exports Vultisig')

assert.ok(browser.Chain !== undefined, '@vultisig/sdk/browser resolves')
assert.ok(vite && (vite.default || vite), '@vultisig/sdk/vite resolves')

const rnJs = path.join(pkgDir, 'dist/index.react-native.js')
assert.ok(existsSync(rnJs), 'react-native bundle file exists on disk')
const rnDts = path.join(pkgDir, 'dist/index.react-native.d.ts')
assert.ok(existsSync(rnDts), 'react-native types exist on disk')
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
      `import type { Chain } from '@vultisig/sdk'
import type { Vultisig } from '@vultisig/sdk/node'
import '@vultisig/sdk/browser'
import '@vultisig/sdk/vite'
export type X = Chain
export type Y = Vultisig
`
    )
    run(process.execPath, [tscBin, '-p', path.join(consumer, 'tsconfig.json')], {
      cwd: consumer,
      env,
    })
  }
}

function packedMcpBinSmoke(workRoot, tgzPath) {
  const consumer = path.join(workRoot, 'mcp-consumer')
  mkdirSync(consumer, { recursive: true })

  writeFileSync(
    path.join(consumer, 'package.json'),
    JSON.stringify(
      {
        name: 'vultisig-mcp-contract-consumer',
        private: true,
        type: 'module',
        packageManager: 'yarn@4.13.0',
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

  runYarn(['add', `@vultisig/mcp@file:${tgzPath}`], { cwd: consumer, env, stdio: 'inherit' })

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
  smokeCli()
  assertSdkBuilt()

  let workRoot
  try {
    workRoot = mkdtempSync(path.join(os.tmpdir(), 'vultisig-quality-contracts-'))

    const tgzPath = packWorkspace(workRoot, '@vultisig/sdk', 'sdk.tgz')

    validateTarballExportFiles(extractPackage(workRoot, tgzPath, 'sdk'))

    packedConsumerSmoke(workRoot, tgzPath)

    for (const workspaceName of PACKAGE_CONTRACT_WORKSPACES) {
      validatePackedWorkspaceExports(workRoot, workspaceName)
    }

    const mcpTgzPath = packWorkspace(workRoot, '@vultisig/mcp', 'mcp.tgz')
    const mcpPackageRoot = extractPackage(workRoot, mcpTgzPath, 'mcp')
    validateTarballBinFiles(mcpPackageRoot, ['vmcp', 'vultisig-mcp'])
    packedMcpBinSmoke(workRoot, mcpTgzPath)

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
