import { memoizeAsync } from '@vultisig/lib-utils/memoizeAsync'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import SevenZip from '7z-wasm'

function locateSevenZipWasmFile(file: string): string {
  const require = createRequire(import.meta.url)
  const pkgDir = path.dirname(require.resolve('7z-wasm/package.json'))
  return pathToFileURL(path.join(pkgDir, file)).href
}

export const getSevenZip = memoizeAsync(() => {
  const opts = { locateFile: locateSevenZipWasmFile }
  return SevenZip(opts).catch(() => SevenZip(opts))
})
