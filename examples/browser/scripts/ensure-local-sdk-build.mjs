import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
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

const workspaceDependencyInputs = [path.join(repoRoot, 'package.json'), path.join(repoRoot, 'yarn.lock')]

const sharedBuildRecipeInputs = [
  path.join(repoRoot, '.config/tsconfig.shared-publish.json'),
  path.join(repoRoot, 'scripts/build-shared-packages.mjs'),
  path.join(repoRoot, 'scripts/fix-dist-esm-relative-imports.mjs'),
  path.join(repoRoot, 'scripts/generate-shared-exports.mjs'),
]

const sharedInputPaths = [
  ...workspaceDependencyInputs,
  ...sharedBuildRecipeInputs,
  path.join(repoRoot, 'packages/core/chain'),
  path.join(repoRoot, 'packages/core/mpc'),
  path.join(repoRoot, 'packages/core/config'),
  path.join(repoRoot, 'packages/lib/utils'),
  path.join(repoRoot, 'packages/mpc-types'),
  path.join(repoRoot, 'packages/mpc-wasm'),
].filter(existsSync)

const inputPaths = [
  ...workspaceDependencyInputs,
  ...sharedBuildRecipeInputs,
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

const generatedManifests = new Set(
  [
    'packages/core/config/package.json',
    'packages/core/chain/package.json',
    'packages/core/mpc/package.json',
    'packages/lib/utils/package.json',
    'packages/mpc-types/package.json',
    'packages/mpc-wasm/package.json',
  ].map(file => path.join(repoRoot, file))
)

function inputFingerprint(inputs) {
  const hash = createHash('sha256')

  const visit = target => {
    const stat = statSync(target)
    if (stat.isDirectory()) {
      for (const entry of readdirSync(target, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.isDirectory() && ignoredDirs.has(entry.name)) continue
        visit(path.join(target, entry.name))
      }
    } else {
      // Export maps are derived by the shared build; the other manifest fields
      // remain real inputs. Hash file content and paths to catch renames and deletes.
      let content = readFileSync(target)
      if (generatedManifests.has(target)) {
        const manifest = JSON.parse(content.toString('utf8'))
        delete manifest.exports
        content = Buffer.from(JSON.stringify(manifest))
      }
      hash.update(JSON.stringify([path.relative(repoRoot, target), content.length]))
      hash.update(content)
    }
  }
  for (const input of inputs) visit(input)
  return hash.digest('hex')
}

function buildState(kind) {
  const shared = kind === 'shared'
  return {
    inputs: shared ? sharedInputPaths : inputPaths,
    outputs: shared ? requiredSharedOutputs : requiredOutputs,
    receipt: path.join(repoRoot, '.rollup.cache/browser-sdk-build', `${kind}.json`),
  }
}

function outputIdentity(outputs, kind) {
  const files = outputs.map(file => {
    const stat = statSync(file)
    return [path.relative(repoRoot, file), stat.size, stat.mtimeMs]
  })
  const exports =
    kind === 'shared'
      ? [...generatedManifests]
          .filter(existsSync)
          .map(file => [path.relative(repoRoot, file), JSON.parse(readFileSync(file, 'utf8')).exports])
      : []
  return { files, exports }
}

function beginBuild(kind) {
  const { inputs, receipt } = buildState(kind)
  mkdirSync(path.dirname(receipt), { recursive: true })
  rmSync(receipt, { force: true })
  writeFileSync(`${receipt}.pending`, inputFingerprint(inputs))
}

function recordBuild(kind) {
  const { inputs, outputs, receipt } = buildState(kind)
  if (!outputs.every(existsSync)) fail(`Cannot record ${kind} build: required artifacts are missing.`)
  let before
  try {
    before = readFileSync(`${receipt}.pending`, 'utf8')
  } catch {
    fail(`Cannot record ${kind} build: run --begin ${kind} before building.`)
  }
  if (before !== inputFingerprint(inputs)) {
    fail(`Inputs changed during the ${kind} build. Retry the build before reusing its artifacts.`)
  }
  writeFileSync(
    receipt,
    JSON.stringify({
      version: 1,
      inputs: before,
      outputs: outputIdentity(outputs, kind),
    }) + '\n'
  )
}

function hasFreshBuild(kind) {
  const { inputs, outputs, receipt } = buildState(kind)
  if (!outputs.every(existsSync)) return false
  let recorded
  try {
    recorded = JSON.parse(readFileSync(receipt, 'utf8'))
  } catch {
    return false
  }
  return (
    recorded?.version === 1 &&
    recorded.inputs === inputFingerprint(inputs) &&
    JSON.stringify(recorded.outputs) === JSON.stringify(outputIdentity(outputs, kind))
  )
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
const args = process.argv.slice(2)
if (args.length > 0) {
  if (args.length !== 2 || !['--begin', '--record'].includes(args[0]) || !['shared', 'sdk'].includes(args[1])) {
    fail('Usage: ensure-local-sdk-build.mjs [--begin|--record shared|sdk]')
  }
  if (args[0] === '--begin') beginBuild(args[1])
  else recordBuild(args[1])
} else {
  if (!hasFreshBuild('shared')) {
    beginBuild('shared')
    buildSharedPackages()
    recordBuild('shared')
  }
  if (!hasFreshBuild('sdk')) {
    beginBuild('sdk')
    buildSdk()
    recordBuild('sdk')
  }
  assertSdkResolves()
}
