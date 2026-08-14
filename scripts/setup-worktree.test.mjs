import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { setupWorkspaceOverrides, verifyWorktreeResolution } from './setup-worktree.mjs'

const packageManager = 'yarn@4.16.0'
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)

const resolveFrom = (manifest, specifier) =>
  execFileSync(
    process.execPath,
    [
      '-e',
      "const { createRequire } = require('node:module'); process.stdout.write(createRequire(process.argv[1]).resolve(process.argv[2]))",
      manifest,
      specifier,
    ],
    { encoding: 'utf8' }
  )

const createRepo = root => {
  mkdirSync(path.join(root, 'packages/a'), { recursive: true })
  mkdirSync(path.join(root, 'packages/b'), { recursive: true })
  mkdirSync(path.join(root, 'scripts'), { recursive: true })
  writeJson(path.join(root, 'package.json'), {
    name: 'fixture-repo',
    packageManager,
    workspaces: ['packages/*'],
  })
  writeJson(path.join(root, 'packages/a/package.json'), {
    name: '@vultisig/a',
    dependencies: { '@vultisig/b': 'workspace:*' },
    main: 'index.js',
  })
  writeJson(path.join(root, 'packages/b/package.json'), { name: '@vultisig/b', main: 'index.js' })
  writeFileSync(path.join(root, 'packages/a/index.js'), `export default ${JSON.stringify(root)}\n`)
  writeFileSync(path.join(root, 'packages/b/index.js'), `export default ${JSON.stringify(root)}\n`)
  writeFileSync(path.join(root, 'scripts/probe.mjs'), "import '@vultisig/a'\n")
}

const withFixture = callback => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'vultisig-worktree-'))
  const mainRoot = path.join(fixtureRoot, 'main')
  const worktreeRoot = path.join(fixtureRoot, 'worktree')
  createRepo(mainRoot)
  createRepo(worktreeRoot)

  mkdirSync(path.join(mainRoot, 'node_modules/@vultisig'), { recursive: true })
  symlinkSync(
    path.relative(path.join(mainRoot, 'node_modules/@vultisig'), path.join(mainRoot, 'packages/a')),
    path.join(mainRoot, 'node_modules/@vultisig/a')
  )
  symlinkSync(
    path.relative(path.join(mainRoot, 'node_modules/@vultisig'), path.join(mainRoot, 'packages/b')),
    path.join(mainRoot, 'node_modules/@vultisig/b')
  )
  symlinkSync(path.relative(worktreeRoot, path.join(mainRoot, 'node_modules')), path.join(worktreeRoot, 'node_modules'))

  try {
    callback({ mainRoot, worktreeRoot })
  } finally {
    rmSync(fixtureRoot, { force: true, recursive: true })
  }
}

test('must-fail check detects the shared-clone trap before setup and passes after local overrides', () => {
  withFixture(({ mainRoot, worktreeRoot }) => {
    const mainALink = readlinkSync(path.join(mainRoot, 'node_modules/@vultisig/a'))
    const mainBLink = readlinkSync(path.join(mainRoot, 'node_modules/@vultisig/b'))
    const manifest = path.join(worktreeRoot, 'packages/a/package.json')

    assert.equal(
      realpathSync(resolveFrom(manifest, '@vultisig/b')),
      realpathSync(path.join(mainRoot, 'packages/b/index.js'))
    )

    assert.throws(
      () => verifyWorktreeResolution(worktreeRoot),
      /Worktree module-resolution check failed.*unsafe or missing override/s
    )

    const result = setupWorkspaceOverrides(worktreeRoot)
    assert.deepEqual(result, { created: 2, removed: 0, replaced: 0, reused: 0 })
    assert.deepEqual(verifyWorktreeResolution(worktreeRoot), {
      mode: 'shared-node-modules',
      overrides: 2,
    })
    assert.equal(
      realpathSync(path.join(worktreeRoot, 'packages/a/node_modules/@vultisig/b')),
      realpathSync(path.join(worktreeRoot, 'packages/b'))
    )
    assert.equal(
      realpathSync(resolveFrom(manifest, '@vultisig/b')),
      realpathSync(path.join(worktreeRoot, 'packages/b/index.js'))
    )
    assert.equal(readlinkSync(path.join(mainRoot, 'node_modules/@vultisig/a')), mainALink)
    assert.equal(readlinkSync(path.join(mainRoot, 'node_modules/@vultisig/b')), mainBLink)
  })
})

test('setup is idempotent', () => {
  withFixture(({ worktreeRoot }) => {
    setupWorkspaceOverrides(worktreeRoot)
    assert.deepEqual(setupWorkspaceOverrides(worktreeRoot), { created: 0, removed: 0, replaced: 0, reused: 2 })
  })
})

test('setup safely replaces a broken leaf override without following it', () => {
  withFixture(({ worktreeRoot }) => {
    setupWorkspaceOverrides(worktreeRoot)
    const link = path.join(worktreeRoot, 'packages/a/node_modules/@vultisig/b')
    rmSync(link)
    symlinkSync('../../../../does-not-exist', link)

    const result = setupWorkspaceOverrides(worktreeRoot)
    assert.deepEqual(result, { created: 0, removed: 0, replaced: 1, reused: 1 })
    assert.equal(realpathSync(link), realpathSync(path.join(worktreeRoot, 'packages/b')))
  })
})

test('setup prunes stale helper-owned workspace links', () => {
  withFixture(({ worktreeRoot }) => {
    setupWorkspaceOverrides(worktreeRoot)
    const scope = path.join(worktreeRoot, 'packages/b/node_modules/@vultisig')
    mkdirSync(scope, { recursive: true })
    symlinkSync(path.relative(scope, path.join(worktreeRoot, 'packages/a')), path.join(scope, 'a'))

    assert.deepEqual(setupWorkspaceOverrides(worktreeRoot), { created: 0, removed: 1, replaced: 0, reused: 2 })
  })
})

test('setup refuses to write through a symlinked per-workspace node_modules directory', () => {
  withFixture(({ mainRoot, worktreeRoot }) => {
    mkdirSync(path.join(mainRoot, 'packages/a/node_modules'), { recursive: true })
    symlinkSync(
      path.relative(path.join(worktreeRoot, 'packages/a'), path.join(mainRoot, 'packages/a/node_modules')),
      path.join(worktreeRoot, 'packages/a/node_modules')
    )

    assert.throws(() => verifyWorktreeResolution(worktreeRoot), /inside unsafe symlinked or non-directory path/)
    assert.throws(() => setupWorkspaceOverrides(worktreeRoot), /Refusing to write through symlinked directory/)
  })
})

test('stale-link pruning refuses to write through a symlinked per-workspace directory', () => {
  withFixture(({ mainRoot, worktreeRoot }) => {
    const sharedScope = path.join(mainRoot, 'packages/b/node_modules/@vultisig')
    mkdirSync(sharedScope, { recursive: true })
    const sharedLink = path.join(sharedScope, 'a')
    symlinkSync(path.relative(sharedScope, path.join(worktreeRoot, 'packages/a')), sharedLink)
    symlinkSync(
      path.relative(path.join(worktreeRoot, 'packages/b'), path.join(mainRoot, 'packages/b/node_modules')),
      path.join(worktreeRoot, 'packages/b/node_modules')
    )

    assert.throws(() => setupWorkspaceOverrides(worktreeRoot), /Refusing to write through symlinked directory/)
    assert.equal(realpathSync(sharedLink), realpathSync(path.join(worktreeRoot, 'packages/a')))
  })
})

test('check accepts a real worktree install whose root workspace links target the worktree', () => {
  withFixture(({ worktreeRoot }) => {
    rmSync(path.join(worktreeRoot, 'node_modules'))
    mkdirSync(path.join(worktreeRoot, 'node_modules/@vultisig'), { recursive: true })
    for (const name of ['a', 'b']) {
      symlinkSync(
        path.relative(path.join(worktreeRoot, 'node_modules/@vultisig'), path.join(worktreeRoot, `packages/${name}`)),
        path.join(worktreeRoot, `node_modules/@vultisig/${name}`)
      )
    }

    assert.deepEqual(verifyWorktreeResolution(worktreeRoot), { mode: 'local-install', overrides: 2 })
  })
})

test('root test and quality gates fail closed on worktree resolution', () => {
  const scripts = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).scripts

  for (const name of ['test', 'check', 'check:agent', 'check:ci']) {
    assert.match(scripts[name], /^yarn worktree:check && /, `${name} must check worktree resolution first`)
  }
})
