import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../packages/sdk')
const maxShimGrowthBytes = 512
const pack = cwd =>
  JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd, encoding: 'utf8' }))[0]
const original = pack(source)
const temp = mkdtempSync(path.join(os.tmpdir(), 'sdk2448-reexport-size-'))
try {
  for (const file of original.files) {
    const destination = path.join(temp, file.path)
    mkdirSync(path.dirname(destination), { recursive: true })
    copyFileSync(path.join(source, file.path), destination)
  }
  const before = pack(temp)
  if (before.unpackedSize !== original.unpackedSize)
    throw Error(`Staging differed: ${before.unpackedSize} vs ${original.unpackedSize}`)
  const packagePath = path.join(temp, 'package.json')
  const manifest = JSON.parse(readFileSync(packagePath, 'utf8'))
  manifest.exports['./tools/representative'] = {
    types: './dist/tools/representative/index.d.ts',
    import: './dist/tools/representative/index.js',
    require: './dist/tools/representative/index.cjs',
  }
  writeFileSync(packagePath, JSON.stringify(manifest, null, 2) + '\n')
  const shimDir = path.join(temp, 'dist/tools/representative')
  mkdirSync(shimDir, { recursive: true })
  writeFileSync(path.join(shimDir, 'index.js'), "export * from '../../index.js'\n")
  writeFileSync(path.join(shimDir, 'index.cjs'), "module.exports = require('../../index.cjs')\n")
  writeFileSync(path.join(shimDir, 'index.d.ts'), "export * from '../../index.js'\n")
  const after = pack(temp)
  const originalChunks = before.files.filter(f => f.path.startsWith('dist/chunks/')).map(f => `${f.path}:${f.size}`)
  const afterChunks = after.files.filter(f => f.path.startsWith('dist/chunks/')).map(f => `${f.path}:${f.size}`)
  if (JSON.stringify(originalChunks) !== JSON.stringify(afterChunks))
    throw Error('Shared chunks changed for a re-export shim')
  const added = after.unpackedSize - before.unpackedSize
  const shim = after.files
    .filter(f => f.path.startsWith('dist/tools/representative/'))
    .reduce((sum, f) => sum + f.size, 0)
  const manifestDelta =
    after.files.find(f => f.path === 'package.json').size - before.files.find(f => f.path === 'package.json').size
  if (added !== shim + manifestDelta) throw Error(`Unexpected growth: ${added} versus ${shim} + ${manifestDelta}`)
  if (added > maxShimGrowthBytes) throw Error(`Re-export shim grew by ${added} bytes; limit is ${maxShimGrowthBytes}`)
  process.stdout.write(
    JSON.stringify({
      beforeBytes: before.unpackedSize,
      afterBytes: after.unpackedSize,
      addedBytes: added,
      shimBytes: shim,
      manifestBytes: manifestDelta,
      chunksUnchanged: true,
    }) + '\n'
  )
} finally {
  rmSync(temp, { recursive: true, force: true })
}
