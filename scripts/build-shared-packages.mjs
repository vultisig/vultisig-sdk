import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { fixDistEsmRelativeImports } from './fix-dist-esm-relative-imports.mjs'
import { applySharedExports, checkSharedExports, getSharedExportDiffMessage } from './generate-shared-exports.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const args = process.argv.slice(2)
const checkOnly = args.includes('--check')
const emitTempRoot = checkOnly
  ? path.join(repoRoot, `.shared-dist-check-${process.pid}`)
  : path.join(repoRoot, '.shared-dist-temp')
const emitRoot = path.join(emitTempRoot, 'packages')

const unknownArgs = args.filter(arg => arg !== '--check')
if (unknownArgs.length > 0) {
  console.error(`Unknown argument(s): ${unknownArgs.join(', ')}`)
  console.error('Usage: node scripts/build-shared-packages.mjs [--check]')
  process.exit(2)
}

const syncTargets = [
  {
    from: 'core/chain',
    to: 'packages/core/chain/dist',
    packageJson: 'packages/core/chain/package.json',
  },
  {
    from: 'core/mpc',
    to: 'packages/core/mpc/dist',
    packageJson: 'packages/core/mpc/package.json',
  },
  {
    from: 'lib/utils',
    to: 'packages/lib/utils/dist',
    packageJson: 'packages/lib/utils/package.json',
  },
  {
    from: 'core/config',
    to: 'packages/core/config/dist',
    packageJson: 'packages/core/config/package.json',
  },
  {
    from: 'mpc-types/src',
    to: 'packages/mpc-types/dist',
    packageJson: 'packages/mpc-types/package.json',
  },
  {
    from: 'mpc-wasm/src',
    to: 'packages/mpc-wasm/dist',
    packageJson: 'packages/mpc-wasm/package.json',
  },
]

rmSync(emitTempRoot, { recursive: true, force: true })

const tscArgs = ['exec', 'tsc', '--project', '.config/tsconfig.shared-publish.json']
if (checkOnly) {
  tscArgs.push('--outDir', emitTempRoot)
}

const tsc = spawnSync('yarn', tscArgs, {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: true,
})

if (tsc.error) {
  console.error('Failed to spawn tsc:', tsc.error.message)
  process.exit(1)
}

if (tsc.status !== 0) {
  process.exit(tsc.status ?? 1)
}

const staleExportWarnings = []

for (const { from, to, packageJson } of syncTargets) {
  const src = path.join(emitRoot, from)
  const packageJsonPath = path.join(repoRoot, packageJson)

  if (!existsSync(src)) {
    console.error(`Missing TypeScript output directory: ${path.relative(repoRoot, src)}`)
    process.exit(1)
  }

  fixDistEsmRelativeImports(src)

  if (checkOnly) {
    continue
  }

  const staleExportWarning = getSharedExportDiffMessage(packageJsonPath, src, {
    relativeTo: repoRoot,
  })
  if (staleExportWarning) staleExportWarnings.push(staleExportWarning)

  const dest = path.join(repoRoot, to)

  rmSync(dest, { recursive: true, force: true })
  cpSync(src, dest, { recursive: true })
  applySharedExports(packageJsonPath, dest)
}

if (checkOnly) {
  const failures = []
  for (const { from, packageJson } of syncTargets) {
    try {
      checkSharedExports(path.join(repoRoot, packageJson), path.join(emitRoot, from), {
        relativeTo: repoRoot,
      })
    } catch (error) {
      failures.push(error.message)
    }
  }

  if (failures.length > 0) {
    console.error(failures.join('\n\n'))
    rmSync(emitTempRoot, { recursive: true, force: true })
    process.exit(1)
  }

  rmSync(emitTempRoot, { recursive: true, force: true })
  console.log('Shared package exports are up to date')
} else {
  if (staleExportWarnings.length > 0) {
    console.warn(staleExportWarnings.join('\n\n'))
  }

  console.log('Shared packages synced to packages/*/dist')
}
