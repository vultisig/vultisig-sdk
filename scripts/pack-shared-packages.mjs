import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const sharedPackageDirs = [
  'packages/core/chain',
  'packages/core/config',
  'packages/core/mpc',
  'packages/lib/utils',
  'packages/lib/dkls',
  'packages/lib/mldsa',
  'packages/lib/schnorr',
]

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')

const build = spawnSync(process.execPath, ['scripts/build-shared-packages.mjs'], {
  cwd: repoRoot,
  stdio: 'inherit',
})

if (build.status !== 0) {
  process.exit(build.status ?? 1)
}

for (const relativeDir of sharedPackageDirs) {
  const packageDir = path.resolve(repoRoot, relativeDir)

  if (!existsSync(packageDir)) {
    console.error(`Missing shared package directory: ${relativeDir}`)
    process.exit(1)
  }

  console.log(`\n==> npm pack --dry-run ${relativeDir}`)

  const result = spawnSync('npm', ['pack', '--dry-run'], {
    cwd: packageDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}
