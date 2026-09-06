import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  createDisposableYarnEnv,
  isDisposableYarnTransportTimeout,
  runDisposableYarnInstall,
} from './quality-contracts-cache.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const yarnCli = path.join(repoRoot, '.yarn/releases/yarn-4.16.0.cjs')

function entries(folder) {
  return existsSync(folder) ? readdirSync(folder).sort() : []
}

function zipArchives(folder) {
  if (!existsSync(folder)) return []

  return readdirSync(folder, { recursive: true })
    .filter(entry => entry.endsWith('.zip'))
    .sort()
}

test('isolates packed-consumer installs from the user-global Yarn cache', () => {
  const workRoot = mkdtempSync(path.join(tmpdir(), 'vultisig-quality-cache-test-'))

  try {
    const env = createDisposableYarnEnv(workRoot, {
      KEEP_ME: 'yes',
      YARN_CACHE_FOLDER: '/user/global/cache',
      YARN_ENABLE_GLOBAL_CACHE: 'true',
      YARN_ENABLE_MIRROR: 'true',
      YARN_GLOBAL_FOLDER: '/user/global/folder',
      YARN_IGNORE_PATH: '0',
      YARN_NETWORK_CONCURRENCY: '99',
      YARN_NPM_REGISTRY_SERVER: 'https://registry.yarnpkg.com',
    })

    assert.equal(env.KEEP_ME, 'yes')
    assert.equal(env.YARN_ENABLE_GLOBAL_CACHE, 'false')
    assert.equal(env.YARN_ENABLE_MIRROR, 'false')
    assert.equal(env.YARN_CACHE_FOLDER, path.join(workRoot, 'yarn-cache'))
    assert.equal(env.YARN_GLOBAL_FOLDER, path.join(workRoot, 'yarn-global'))
    assert.equal(env.YARN_IGNORE_PATH, '1')
    assert.equal(env.YARN_NETWORK_CONCURRENCY, '4')
    assert.equal(env.YARN_NPM_REGISTRY_SERVER, 'https://registry.npmjs.org')
    assert.equal(existsSync(env.YARN_CACHE_FOLDER), true)
  } finally {
    rmSync(workRoot, { force: true, recursive: true })
  }
})

test('runs the repository-pinned Yarn bundle from a disposable consumer', () => {
  const workRoot = mkdtempSync(path.join(tmpdir(), 'vultisig-quality-yarn-version-'))
  const consumer = path.join(workRoot, 'consumer')

  try {
    mkdirSync(consumer, { recursive: true })
    writeFileSync(
      path.join(consumer, 'package.json'),
      JSON.stringify({
        name: 'quality-version-consumer',
        private: true,
        packageManager: 'yarn@4.16.0',
      })
    )
    writeFileSync(path.join(consumer, '.yarnrc.yml'), 'nodeLinker: node-modules\n')

    const result = spawnSync(process.execPath, [yarnCli, '--version'], {
      cwd: consumer,
      encoding: 'utf8',
      env: createDisposableYarnEnv(workRoot, {
        ...process.env,
        YARN_IGNORE_PATH: '0',
      }),
    })

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.equal(result.stdout.trim(), '4.16.0')
  } finally {
    rmSync(workRoot, { force: true, recursive: true })
  }
})

test('retries one child-process transport timeout exactly once', () => {
  let attempts = 0
  let retries = 0
  const result = runDisposableYarnInstall(
    () => {
      attempts += 1
      return spawnSync(process.execPath, ['-e', attempts === 1 ? 'setTimeout(() => {}, 10_000)' : 'process.exit(0)'], {
        encoding: 'utf8',
        timeout: attempts === 1 ? 25 : 1_000,
      })
    },
    { onRetry: () => (retries += 1) }
  )

  assert.equal(attempts, 2)
  assert.equal(retries, 1)
  assert.equal(result.status, 0)
})

test('does not retry a semantic child-process failure', () => {
  let attempts = 0
  const result = runDisposableYarnInstall(() => {
    attempts += 1
    return spawnSync(process.execPath, ['-e', "console.error('package contract failed'); process.exit(23)"], {
      encoding: 'utf8',
      timeout: 1_000,
    })
  })

  assert.equal(attempts, 1)
  assert.equal(result.status, 23)
  assert.equal(isDisposableYarnTransportTimeout(result), false)
})

test('stops after one retry when transport timeouts continue', () => {
  let attempts = 0
  const result = runDisposableYarnInstall(() => {
    attempts += 1
    return spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 10_000)'], {
      encoding: 'utf8',
      timeout: 25,
    })
  })

  assert.equal(attempts, 2)
  assert.equal(isDisposableYarnTransportTimeout(result), true)
})

test('a unique packed file dependency never reaches the user-global cache', () => {
  const workRoot = mkdtempSync(path.join(tmpdir(), 'vultisig-quality-cache-install-'))
  const packageRoot = path.join(workRoot, 'packed-source', 'package')
  const consumer = path.join(workRoot, 'consumer')
  const tgzPath = path.join(workRoot, 'fixture.tgz')
  const inheritedCacheFolder = path.join(workRoot, 'inherited-user-cache')
  const inheritedGlobalFolder = path.join(workRoot, 'inherited-user-global')
  const env = createDisposableYarnEnv(workRoot, {
    ...process.env,
    YARN_CACHE_FOLDER: inheritedCacheFolder,
    YARN_ENABLE_GLOBAL_CACHE: 'true',
    YARN_ENABLE_MIRROR: 'true',
    YARN_GLOBAL_FOLDER: inheritedGlobalFolder,
  })
  const inheritedCacheArchivesBefore = zipArchives(inheritedCacheFolder)
  const inheritedGlobalArchivesBefore = zipArchives(inheritedGlobalFolder)

  try {
    mkdirSync(packageRoot, { recursive: true })
    mkdirSync(consumer, { recursive: true })
    writeFileSync(
      path.join(packageRoot, 'package.json'),
      JSON.stringify({ name: '@vultisig/quality-cache-fixture', version: '1.0.0' })
    )
    writeFileSync(
      path.join(consumer, 'package.json'),
      JSON.stringify({ name: 'quality-cache-consumer', private: true, packageManager: 'yarn@4.16.0' })
    )
    writeFileSync(path.join(consumer, '.yarnrc.yml'), 'nodeLinker: node-modules\n')

    const packed = spawnSync('tar', ['-czf', tgzPath, '-C', path.dirname(packageRoot), 'package'], {
      encoding: 'utf8',
    })
    assert.equal(packed.status, 0, packed.stderr)

    const installed = spawnSync(process.execPath, [yarnCli, 'add', `@vultisig/quality-cache-fixture@file:${tgzPath}`], {
      cwd: consumer,
      encoding: 'utf8',
      env,
    })
    assert.equal(installed.status, 0, `${installed.stdout}\n${installed.stderr}`)
    assert.deepEqual(zipArchives(inheritedCacheFolder), inheritedCacheArchivesBefore)
    assert.deepEqual(zipArchives(inheritedGlobalFolder), inheritedGlobalArchivesBefore)
    assert.ok(entries(env.YARN_CACHE_FOLDER).length > 0)
  } finally {
    rmSync(workRoot, { force: true, recursive: true })
  }

  assert.equal(existsSync(env.YARN_CACHE_FOLDER), false)
})
