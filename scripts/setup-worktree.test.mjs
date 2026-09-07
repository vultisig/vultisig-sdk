import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
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

import {
  parseDependencyOperationArgs,
  repairNestedNodeModulesLink,
  runGuardedDependencyOperation,
  setupWorkspaceOverrides,
  setupWorktreeDependencies,
  verifyWorktreeResolution,
} from './setup-worktree.mjs'

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

const installFixturePackage = (nodeModules, version, marker) => {
  const packageRoot = path.join(nodeModules, 'version-probe')
  mkdirSync(packageRoot, { recursive: true })
  writeJson(path.join(packageRoot, 'package.json'), {
    name: 'version-probe',
    version,
    main: 'index.js',
  })
  writeFileSync(path.join(packageRoot, 'index.js'), `module.exports = ${JSON.stringify(marker)}\n`)
}

const markAsLinkedWorktree = (repoRoot, mainRoot) => {
  const commonGitDirectory = path.join(mainRoot, '.git')
  const worktreeGitDirectory = path.join(commonGitDirectory, 'worktrees', path.basename(repoRoot))
  mkdirSync(worktreeGitDirectory, { recursive: true })
  writeFileSync(path.join(worktreeGitDirectory, 'commondir'), '../..\n')
  writeFileSync(
    path.join(repoRoot, '.git'),
    `gitdir: ${worktreeGitDirectory}\n`
  )
}

const createRepo = root => {
  mkdirSync(path.join(root, 'packages/a'), { recursive: true })
  mkdirSync(path.join(root, 'packages/b'), { recursive: true })
  mkdirSync(path.join(root, 'clients/cli'), { recursive: true })
  mkdirSync(path.join(root, 'clients/mcp'), { recursive: true })
  mkdirSync(path.join(root, 'scripts'), { recursive: true })
  writeJson(path.join(root, 'package.json'), {
    name: 'fixture-repo',
    packageManager,
    workspaces: ['packages/*', 'clients/*'],
  })
  writeJson(path.join(root, 'packages/a/package.json'), {
    name: '@vultisig/a',
    dependencies: { '@vultisig/b': 'workspace:*' },
    main: 'index.js',
  })
  writeJson(path.join(root, 'packages/b/package.json'), { name: '@vultisig/b', main: 'index.js' })
  writeJson(path.join(root, 'clients/cli/package.json'), {
    name: '@vultisig/cli',
    bin: { vsig: './dist/index.js' },
    scripts: { build: 'fixture-build' },
  })
  writeJson(path.join(root, 'clients/mcp/package.json'), {
    name: '@vultisig/mcp',
    bin: { vmcp: './dist/bin/mcp-server.js' },
    scripts: { build: 'fixture-build' },
  })
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
  for (const [name, relative] of [
    ['a', 'packages/a'],
    ['b', 'packages/b'],
    ['cli', 'clients/cli'],
    ['mcp', 'clients/mcp'],
  ]) {
    symlinkSync(
      path.relative(path.join(mainRoot, 'node_modules/@vultisig'), path.join(mainRoot, relative)),
      path.join(mainRoot, 'node_modules/@vultisig', name)
    )
  }
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
    for (const [name, relative] of [
      ['a', 'packages/a'],
      ['b', 'packages/b'],
      ['cli', 'clients/cli'],
      ['mcp', 'clients/mcp'],
    ]) {
      symlinkSync(
        path.relative(path.join(worktreeRoot, 'node_modules/@vultisig'), path.join(worktreeRoot, relative)),
        path.join(worktreeRoot, `node_modules/@vultisig/${name}`)
      )
    }

    assert.deepEqual(verifyWorktreeResolution(worktreeRoot), { mode: 'local-install', overrides: 4 })
  })
})

test('local setup removes only a validated nested alias and preserves worktree dependency resolution', () => {
  withFixture(({ mainRoot, worktreeRoot }) => {
    markAsLinkedWorktree(worktreeRoot, mainRoot)
    rmSync(path.join(worktreeRoot, 'node_modules'))
    mkdirSync(path.join(worktreeRoot, 'node_modules/@vultisig'), { recursive: true })
    for (const [name, relative] of [
      ['a', 'packages/a'],
      ['b', 'packages/b'],
      ['cli', 'clients/cli'],
      ['mcp', 'clients/mcp'],
    ]) {
      symlinkSync(
        path.relative(
          path.join(worktreeRoot, 'node_modules/@vultisig'),
          path.join(worktreeRoot, relative)
        ),
        path.join(worktreeRoot, `node_modules/@vultisig/${name}`)
      )
    }

    installFixturePackage(path.join(mainRoot, 'node_modules'), '2.2.0', 'main-2.2.0')
    installFixturePackage(path.join(worktreeRoot, 'node_modules'), '1.8.0', 'worktree-1.8.0')
    symlinkSync(path.join(mainRoot, 'node_modules'), path.join(worktreeRoot, 'node_modules/node_modules'))

    assert.throws(
      () => verifyWorktreeResolution(worktreeRoot),
      /node_modules\/node_modules is an unsafe nested symlink/
    )
    assert.deepEqual(setupWorktreeDependencies(worktreeRoot, mainRoot), {
      nestedLink: { removed: 1 },
      nodeModules: { mode: 'local-install', created: false },
      overrides: {
        created: 0,
        removed: 0,
        replaced: 0,
        reused: 0,
        skipped: 'root node_modules is a local directory',
      },
      receipt: { mode: 'local-install', overrides: 4 },
    })

    const manifest = path.join(worktreeRoot, 'packages/a/package.json')
    assert.equal(
      realpathSync(resolveFrom(manifest, 'version-probe')),
      realpathSync(path.join(worktreeRoot, 'node_modules/version-probe/index.js'))
    )
    assert.equal(
      execFileSync(
        process.execPath,
        ['-e', 'process.stdout.write(require(process.argv[1]))', resolveFrom(manifest, 'version-probe')],
        {
          encoding: 'utf8',
        }
      ),
      'worktree-1.8.0'
    )
    assert.equal(
      JSON.parse(readFileSync(path.join(mainRoot, 'node_modules/version-probe/package.json'), 'utf8')).version,
      '2.2.0'
    )
  })
})

test('local setup refuses to remove a nested symlink with an unexpected target', () => {
  withFixture(({ mainRoot, worktreeRoot }) => {
    markAsLinkedWorktree(worktreeRoot, mainRoot)
    rmSync(path.join(worktreeRoot, 'node_modules'))
    mkdirSync(path.join(worktreeRoot, 'node_modules'), { recursive: true })
    const unexpectedRoot = path.join(path.dirname(worktreeRoot), 'unexpected-node-modules')
    mkdirSync(unexpectedRoot)
    const nestedLink = path.join(worktreeRoot, 'node_modules/node_modules')
    symlinkSync(unexpectedRoot, nestedLink)

    assert.throws(
      () => repairNestedNodeModulesLink(worktreeRoot, mainRoot),
      /Refusing to remove unexpected nested node_modules symlink/
    )
    assert.equal(realpathSync(nestedLink), realpathSync(unexpectedRoot))
  })
})

test('local setup rejects a same-package source from a different Git repository', () => {
  withFixture(({ mainRoot, worktreeRoot }) => {
    markAsLinkedWorktree(worktreeRoot, mainRoot)
    rmSync(path.join(worktreeRoot, 'node_modules'))
    mkdirSync(path.join(worktreeRoot, 'node_modules'), { recursive: true })

    const unrelatedRoot = path.join(path.dirname(worktreeRoot), 'unrelated')
    createRepo(unrelatedRoot)
    execFileSync('git', ['init'], { cwd: unrelatedRoot, stdio: 'ignore' })
    mkdirSync(path.join(unrelatedRoot, 'node_modules'))
    const nestedLink = path.join(worktreeRoot, 'node_modules/node_modules')
    symlinkSync(path.join(unrelatedRoot, 'node_modules'), nestedLink)

    assert.throws(
      () => repairNestedNodeModulesLink(worktreeRoot, unrelatedRoot),
      /The --from path is not a matching checkout of this repository/
    )
    assert.equal(realpathSync(nestedLink), realpathSync(path.join(unrelatedRoot, 'node_modules')))
  })
})

test('primary checkout check ignores its package-manager-owned nested symlink', () => {
  withFixture(({ mainRoot }) => {
    mkdirSync(path.join(mainRoot, '.git'))
    symlinkSync(path.join(mainRoot, 'node_modules'), path.join(mainRoot, 'node_modules/node_modules'))

    assert.deepEqual(verifyWorktreeResolution(mainRoot), { mode: 'local-install', overrides: 4 })
  })
})

const generatedBinPath = (repoRoot, workspaceName) =>
  workspaceName === '@vultisig/cli'
    ? path.join(repoRoot, 'clients/cli/dist/index.js')
    : path.join(repoRoot, 'clients/mcp/dist/bin/mcp-server.js')

const fixtureRunner =
  ({ mainRoot, worktreeRoot, operationStatus, calls }) =>
  (command, args) => {
    assert.equal(command, 'yarn')
    calls.push(args)
    if (args[0] === 'workspace') {
      const target = generatedBinPath(worktreeRoot, args[1])
      mkdirSync(path.dirname(target), { recursive: true })
      writeFileSync(target, '#!/usr/bin/env node\n')
      return { status: 0 }
    }

    assert.equal(existsSync(generatedBinPath(worktreeRoot, '@vultisig/cli')), true)
    assert.equal(existsSync(generatedBinPath(worktreeRoot, '@vultisig/mcp')), true)
    const override = path.join(worktreeRoot, 'packages/a/node_modules/@vultisig/b')
    rmSync(override)
    symlinkSync(path.relative(path.dirname(override), path.join(mainRoot, 'packages/b')), override)
    return { status: operationStatus }
  }

const sharedRootLinks = mainRoot => ({
  a: readlinkSync(path.join(mainRoot, 'node_modules/@vultisig/a')),
  b: readlinkSync(path.join(mainRoot, 'node_modules/@vultisig/b')),
  cli: readlinkSync(path.join(mainRoot, 'node_modules/@vultisig/cli')),
  mcp: readlinkSync(path.join(mainRoot, 'node_modules/@vultisig/mcp')),
})

const withPreparedFixture = callback =>
  withFixture(context => {
    writeFileSync(
      path.join(context.worktreeRoot, '.git'),
      'gitdir: /fixture/git/worktrees/test\n'
    )
    setupWorkspaceOverrides(context.worktreeRoot)
    callback(context)
  })

test('successful dependency operation builds bins before Yarn and restores worktree overrides', () => {
  withPreparedFixture(({ mainRoot, worktreeRoot }) => {
    const calls = []
    const sourceLinksBefore = sharedRootLinks(mainRoot)
    const receipt = runGuardedDependencyOperation({
      repoRoot: worktreeRoot,
      operationArgs: ['install', '--immutable'],
      runCommand: fixtureRunner({ mainRoot, worktreeRoot, operationStatus: 0, calls }),
    })

    assert.equal(receipt.status, 0)
    assert.deepEqual(calls, [
      ['workspace', '@vultisig/cli', 'build'],
      ['workspace', '@vultisig/mcp', 'build'],
      ['install', '--immutable'],
    ])
    assert.equal(
      realpathSync(path.join(worktreeRoot, 'packages/a/node_modules/@vultisig/b')),
      realpathSync(path.join(worktreeRoot, 'packages/b'))
    )
    assert.deepEqual(verifyWorktreeResolution(worktreeRoot), receipt.finalResolution)
    assert.deepEqual(sharedRootLinks(mainRoot), sourceLinksBefore)
  })
})

test('failed dependency operation preserves its exit status after restoring links and checking resolution', () => {
  withPreparedFixture(({ mainRoot, worktreeRoot }) => {
    const calls = []
    const sourceLinksBefore = sharedRootLinks(mainRoot)
    const receipt = runGuardedDependencyOperation({
      repoRoot: worktreeRoot,
      operationArgs: ['up', 'example@2.0.0'],
      runCommand: fixtureRunner({ mainRoot, worktreeRoot, operationStatus: 23, calls }),
    })

    assert.equal(receipt.status, 23)
    assert.equal(receipt.primaryFailure.stage, 'yarn up')
    assert.deepEqual(receipt.recoveryFailures, [])
    assert.equal(
      realpathSync(path.join(worktreeRoot, 'packages/a/node_modules/@vultisig/b')),
      realpathSync(path.join(worktreeRoot, 'packages/b'))
    )
    assert.deepEqual(verifyWorktreeResolution(worktreeRoot), receipt.finalResolution)
    assert.deepEqual(sharedRootLinks(mainRoot), sourceLinksBefore)
  })
})

test('recovery failure fails a successful package operation', () => {
  withPreparedFixture(({ mainRoot, worktreeRoot }) => {
    const receipt = runGuardedDependencyOperation({
      repoRoot: worktreeRoot,
      operationArgs: ['install'],
      runCommand: fixtureRunner({ mainRoot, worktreeRoot, operationStatus: 0, calls: [] }),
      restoreOverrides: () => {
        throw new Error('injected restoration failure')
      },
    })

    assert.equal(receipt.status, 1)
    assert.match(receipt.recoveryFailures.join('\n'), /injected restoration failure/)
    assert.match(receipt.recoveryFailures.join('\n'), /worktree resolution check failed/)
  })
})

test('thrown package-manager failure still restores links and runs the final check', () => {
  withPreparedFixture(({ mainRoot, worktreeRoot }) => {
    const calls = []
    const baseRunner = fixtureRunner({ mainRoot, worktreeRoot, operationStatus: 0, calls })
    const receipt = runGuardedDependencyOperation({
      repoRoot: worktreeRoot,
      operationArgs: ['install'],
      runCommand: (command, args, options) => {
        if (args[0] === 'install') {
          const override = path.join(worktreeRoot, 'packages/a/node_modules/@vultisig/b')
          rmSync(override)
          symlinkSync(path.relative(path.dirname(override), path.join(mainRoot, 'packages/b')), override)
          throw new Error('injected spawn exception')
        }
        return baseRunner(command, args, options)
      },
    })

    assert.equal(receipt.status, 1)
    assert.match(receipt.primaryFailure.message, /injected spawn exception/)
    assert.deepEqual(receipt.recoveryFailures, [])
    assert.equal(
      realpathSync(path.join(worktreeRoot, 'packages/a/node_modules/@vultisig/b')),
      realpathSync(path.join(worktreeRoot, 'packages/b'))
    )
    assert.deepEqual(verifyWorktreeResolution(worktreeRoot), receipt.finalResolution)
  })
})

test('operation parser accepts dependency commands and rejects checkout escape flags', () => {
  assert.deepEqual(parseDependencyOperationArgs(['--', 'install', '--immutable']), ['install', '--immutable'])
  assert.deepEqual(parseDependencyOperationArgs(['up', 'example@2.0.0']), ['up', 'example@2.0.0'])
  assert.throws(
    () => parseDependencyOperationArgs(['workspace', 'other', 'add', 'example']),
    /Unsupported Yarn operation/
  )
  assert.throws(
    () => parseDependencyOperationArgs(['install', '--cwd', '/tmp/other']),
    /cannot target a different checkout/
  )
  assert.throws(
    () => parseDependencyOperationArgs(['install', '--cwd=/tmp/other']),
    /cannot target a different checkout/
  )
  assert.throws(() => parseDependencyOperationArgs(['up', '-C/tmp/other']), /cannot target a different checkout/)
})

test('root test and quality gates fail closed on worktree resolution', () => {
  const scripts = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).scripts

  for (const name of ['test', 'check', 'check:agent', 'check:ci']) {
    assert.match(scripts[name], /^yarn worktree:check && /, `${name} must check worktree resolution first`)
  }
})
