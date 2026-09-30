import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const sdkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../packages/sdk')

// The root import's `require` condition needs a .d.cts module kind. A tiny
// declaration facade reuses the shared ESM declaration graph without inlining
// it into a second, much larger standalone bundle.
writeFileSync(path.join(sdkRoot, 'dist/index.d.cts'), "export * from './index.js'\n")
