import { memoizeAsync } from '@vultisig/lib-utils/memoizeAsync'
import SevenZip from '7z-wasm'

/** Browser / Vite: `7zz.wasm` is served from site root (see `@vultisig/sdk/vite`). */
export const getSevenZip = memoizeAsync(() => {
  // Silence 7z's banner/progress chatter (see getSevenZip.node.ts); errors
  // still surface via the default printErr, results are read from the FS.
  return SevenZip({
    locateFile: (file: string) => `/${file}`,
    print: () => {},
  }).catch(() => SevenZip({ print: () => {} }))
})
