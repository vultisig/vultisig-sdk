import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export function getPinnedYarnVersion(repoRoot) {
  const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
  const packageManager = packageJson.packageManager
  const match = typeof packageManager === 'string' ? packageManager.match(/^yarn@(.+)$/) : null

  if (!match) {
    throw new Error('Expected package.json packageManager to pin yarn, for example "yarn@4.16.0".')
  }

  return match[1]
}

export function formatCiToolchain(repoRoot) {
  return `Node.js 20 and Yarn ${getPinnedYarnVersion(repoRoot)}`
}
