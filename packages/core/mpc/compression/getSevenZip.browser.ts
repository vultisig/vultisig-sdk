import { memoizeAsync } from '@vultisig/lib-utils/memoizeAsync'
import SevenZip from '7z-wasm'

/** Browser / Vite: `7zz.wasm` is served from site root (see `@vultisig/sdk/vite`). */
export const getSevenZip = memoizeAsync(() => {
  return SevenZip({
    locateFile: (file: string) => `/${file}`,
  }).catch(() => SevenZip())
})
