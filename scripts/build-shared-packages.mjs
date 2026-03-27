import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { fixDistEsmRelativeImports } from './fix-dist-esm-relative-imports.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const emitRoot = path.join(repoRoot, '.shared-dist-temp', 'packages')

const syncTargets = [
  { from: 'core/chain', to: 'packages/core/chain/dist' },
  { from: 'core/mpc', to: 'packages/core/mpc/dist' },
  { from: 'lib/utils', to: 'packages/lib/utils/dist' },
  { from: 'core/config', to: 'packages/core/config/dist' },
]

const tsc = spawnSync('yarn', ['exec', 'tsc', '--project', '.config/tsconfig.shared-publish.json'], {
  cwd: repoRoot,
  stdio: 'inherit',
})

if (tsc.status !== 0) {
  process.exit(tsc.status ?? 1)
}

for (const { from, to } of syncTargets) {
  const src = path.join(emitRoot, from)
  const dest = path.join(repoRoot, to)

  if (!existsSync(src)) {
    console.error(`Missing TypeScript output directory: ${path.relative(repoRoot, src)}`)
    process.exit(1)
  }

  rmSync(dest, { recursive: true, force: true })
  cpSync(src, dest, { recursive: true })
  fixDistEsmRelativeImports(dest)
}

console.log('Shared packages synced to packages/*/dist')
