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
  }
}
