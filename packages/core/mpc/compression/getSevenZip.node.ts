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
  // Silence 7z's banner/progress chatter: it prints to stdout, which CLI
  // consumers treat as the machine-output channel. Errors still surface via
  // the default printErr (stderr); results are read from the virtual FS.
  const opts = { locateFile: locateSevenZipWasmFile, print: () => {} }
  return SevenZip(opts).catch(() => SevenZip(opts))
})
