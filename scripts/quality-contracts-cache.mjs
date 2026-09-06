import { mkdirSync } from 'node:fs'
import path from 'node:path'

export function createDisposableYarnEnv(workRoot, baseEnv = process.env) {
  const cacheFolder = path.join(workRoot, 'yarn-cache')
  const globalFolder = path.join(workRoot, 'yarn-global')
  mkdirSync(cacheFolder, { recursive: true })

  return {
    ...baseEnv,
    YARN_CACHE_FOLDER: cacheFolder,
    YARN_ENABLE_GLOBAL_CACHE: 'false',
    YARN_ENABLE_MIRROR: 'false',
    YARN_GLOBAL_FOLDER: globalFolder,
    YARN_IGNORE_PATH: '1',
    YARN_NETWORK_CONCURRENCY: '4',
    YARN_NPM_REGISTRY_SERVER: 'https://registry.npmjs.org',
  }
}

export function isDisposableYarnTransportTimeout(result) {
  return result?.error?.code === 'ETIMEDOUT'
}

export function runDisposableYarnInstall(runAttempt, { onRetry = () => {} } = {}) {
  const firstResult = runAttempt(1)
  if (!isDisposableYarnTransportTimeout(firstResult)) return firstResult

  onRetry(firstResult)
  return runAttempt(2)
}
