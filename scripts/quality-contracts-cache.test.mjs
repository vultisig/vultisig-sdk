import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { createDisposableYarnEnv } from './quality-contracts-cache.mjs'

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
    })

    assert.equal(env.KEEP_ME, 'yes')
    assert.equal(env.YARN_ENABLE_GLOBAL_CACHE, 'false')
    assert.equal(env.YARN_ENABLE_MIRROR, 'false')
    assert.equal(env.YARN_CACHE_FOLDER, path.join(workRoot, 'yarn-cache'))
    assert.equal(env.YARN_GLOBAL_FOLDER, path.join(workRoot, 'yarn-global'))
    assert.equal(existsSync(env.YARN_CACHE_FOLDER), true)
  } finally {
    rmSync(workRoot, { force: true, recursive: true })
  }
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
