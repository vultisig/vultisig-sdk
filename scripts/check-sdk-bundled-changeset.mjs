#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname)

const bundledSourcePrefixes = [
  'packages/core/chain/',
  'packages/core/config/',
  'packages/core/mpc/',
  'packages/lib/utils/',
]

const ignoredSuffixes = ['/CHANGELOG.md', '/package.json']

function git(args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function getChangedFiles() {
  const baseRef = process.env.GITHUB_BASE_REF
  if (baseRef) {
    git(['fetch', '--no-tags', '--depth=1', 'origin', baseRef])
    return git(['diff', '--name-only', `origin/${baseRef}...HEAD`])
      .split('\n')
      .filter(Boolean)
  }

  const mergeBase = git(['merge-base', 'HEAD', 'origin/main'])
  return git(['diff', '--name-only', `${mergeBase}...HEAD`])
    .split('\n')
    .filter(Boolean)
}

function isBundledSourceFile(file) {
  if (!bundledSourcePrefixes.some(prefix => file.startsWith(prefix))) return false
  if (ignoredSuffixes.some(suffix => file.endsWith(suffix))) return false
  return /\.(c|m)?(t|j)sx?$/.test(file) || file.endsWith('.json')
}

function hasSdkChangeset() {
  const changesetDir = path.join(repoRoot, '.changeset')
  for (const file of readdirSync(changesetDir)) {
    if (!file.endsWith('.md') || file === 'README.md') continue
    const body = readFileSync(path.join(changesetDir, file), 'utf8')
    const frontmatter = body.match(/^---\n([\s\S]*?)\n---/)
    if (frontmatter?.[1].includes('"@vultisig/sdk"')) return true
  }
  return false
}

const bundledChanges = getChangedFiles().filter(isBundledSourceFile)

if (bundledChanges.length > 0 && !hasSdkChangeset()) {
  console.error(
    [
      'SDK release guard failed.',
      '',
      'This PR changes source files that are bundled into @vultisig/sdk, but no changeset bumps @vultisig/sdk.',
      'Add @vultisig/sdk to the changeset so consumers receive a new SDK tarball.',
      '',
      'Bundled source changes:',
      ...bundledChanges.map(file => `- ${file}`),
    ].join('\n')
  )
  process.exit(1)
}

console.log('SDK bundled changeset guard passed.')
