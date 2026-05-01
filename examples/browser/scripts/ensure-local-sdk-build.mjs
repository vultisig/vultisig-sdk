import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const exampleRoot = path.resolve(scriptDir, '..')
const repoRoot = path.resolve(exampleRoot, '../..')
const sdkRoot = path.join(repoRoot, 'packages/sdk')

const requiredSharedOutputs = [
  'packages/core/config/dist/index.js',
  'packages/core/chain/dist/Chain.js',
  'packages/core/mpc/dist/MpcServerType.js',
  'packages/lib/utils/dist/attempt.js',
  'packages/mpc-types/dist/index.js',
  'packages/mpc-wasm/dist/index.js',
].map(file => path.join(repoRoot, file))

const requiredOutputs = [
  'dist/index.browser.js',
  'dist/index.node.cjs',
  'dist/index.d.ts',
  'dist/vite/index.js',
  'dist/vite/index.cjs',
  'dist/vite/index.d.ts',
].map(file => path.join(sdkRoot, file))

const sharedInputPaths = [
  path.join(repoRoot, '.config/tsconfig.shared-publish.json'),
  path.join(repoRoot, 'scripts/build-shared-packages.mjs'),
  path.join(repoRoot, 'scripts/fix-dist-esm-relative-imports.mjs'),
  path.join(repoRoot, 'scripts/generate-shared-exports.mjs'),
  path.join(repoRoot, 'packages/core/chain'),
  path.join(repoRoot, 'packages/core/mpc'),
  path.join(repoRoot, 'packages/core/config'),
  path.join(repoRoot, 'packages/lib/utils'),
  path.join(repoRoot, 'packages/mpc-types'),
  path.join(repoRoot, 'packages/mpc-wasm'),
].filter(existsSync)

const inputPaths = [
  path.join(sdkRoot, 'src'),
  path.join(sdkRoot, 'package.json'),
  path.join(sdkRoot, 'rollup.platforms.config.js'),
  path.join(sdkRoot, 'rollup.types.config.js'),
  path.join(sdkRoot, 'tsconfig.json'),
  path.join(repoRoot, 'packages/core'),
  path.join(repoRoot, 'packages/lib'),
  path.join(repoRoot, 'packages/mpc-types'),
  path.join(repoRoot, 'packages/mpc-wasm'),
].filter(existsSync)

const ignoredDirs = new Set(['dist', 'node_modules', 'coverage', '.turbo', '.cache'])

function fail(message) {
  process.stderr.write(`\n[vultisig-example-browser] ${message}\n`)
  process.exit(1)
}

function newestMtimeMs(target) {
  const stat = statSync(target)
  if (!stat.isDirectory()) return stat.mtimeMs

  let newest = stat.mtimeMs
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirs.has(entry.name)) continue

    const child = path.join(target, entry.name)
    const childMtime = newestMtimeMs(child)
    if (childMtime > newest) newest = childMtime
  }
  return newest
}

function hasFreshSdkBuild() {
  if (!requiredOutputs.every(existsSync)) return false

  const oldestOutput = Math.min(...requiredOutputs.map(file => statSync(file).mtimeMs))
  const newestInput = Math.max(...inputPaths.map(newestMtimeMs))
  return oldestOutput >= newestInput
}

function hasFreshSharedBuild() {
  if (!requiredSharedOutputs.every(existsSync)) return false

  const oldestOutput = Math.min(...requiredSharedOutputs.map(file => statSync(file).mtimeMs))
  const newestInput = Math.max(...sharedInputPaths.map(newestMtimeMs))
  return oldestOutput >= newestInput
}

function buildSharedPackages() {
  process.stdout.write('[vultisig-example-browser] Building shared package artifacts...\n')
  const result = spawnSync('yarn', ['build:shared'], {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })

  if (result.status !== 0) {
    fail('Failed to build shared package artifacts. Run `yarn install` from the repository root, then retry.')
  }
}

function buildSdk() {
  process.stdout.write('[vultisig-example-browser] Building local @vultisig/sdk artifacts...\n')
  const result = spawnSync('yarn', ['workspace', '@vultisig/sdk', 'build'], {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })

  if (result.status !== 0) {
    fail('Failed to build @vultisig/sdk. Run `yarn install` from the repository root, then retry.')
  }
}

function assertWorkspaceLayout() {
  if (!existsSync(path.join(repoRoot, 'package.json')) || !existsSync(path.join(sdkRoot, 'package.json'))) {
    fail(
      [
        'This example is a monorepo workspace app and needs the repository root.',
        'Run it from a full checkout with `yarn install && yarn workspace @vultisig/example-browser dev`.',
        'For your own app, install `@vultisig/sdk` from npm and copy the Vite preset usage from this example instead of using `workspace:*` dependencies.',
      ].join('\n')
    )
  }
}

function assertSdkResolves() {
  const requireFromExample = createRequire(path.join(exampleRoot, 'package.json'))
  for (const id of ['@vultisig/sdk', '@vultisig/sdk/vite']) {
    try {
      requireFromExample.resolve(id)
    } catch (error) {
      fail(
        [
          `Failed to resolve ${id} from examples/browser.`,
          'Run `yarn install` from the repository root so Yarn links workspace dependencies, then retry.',
          `Original error: ${error.message}`,
        ].join('\n')
      )
    }
  }
}

assertWorkspaceLayout()
if (!hasFreshSharedBuild()) buildSharedPackages()
if (!hasFreshSdkBuild()) buildSdk()
assertSdkResolves()
