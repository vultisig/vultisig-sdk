import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const budget = JSON.parse(readFileSync(new URL('../packages/sdk/package-size-budget.json', import.meta.url), 'utf8'))

export function inventoryExtractedPackage(packageRoot) {
  const files = []
  const pending = [packageRoot]
  while (pending.length) {
    const directory = pending.pop()
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name)
      const relativePath = path.relative(packageRoot, absolutePath).split(path.sep).join('/')
      if (entry.isDirectory()) {
        pending.push(absolutePath)
      } else if (entry.isFile()) {
        files.push({ path: relativePath, size: lstatSync(absolutePath).size })
      } else {
        throw new Error(`SDK archive contains unsupported entry: ${relativePath}`)
      }
    }
  }
  return [{ unpackedSize: files.reduce((total, file) => total + file.size, 0), files }]
}

export function validateSdkPackSize(packOutput, limits = budget) {
  const packs = typeof packOutput === 'string' ? JSON.parse(packOutput) : packOutput
  if (!Array.isArray(packs) || packs.length !== 1) throw new Error('Expected one npm pack result')
  const pack = packs[0]
  if (
    !Number.isSafeInteger(pack?.unpackedSize) ||
    pack.unpackedSize <= 0 ||
    !Array.isArray(pack.files) ||
    !pack.files.length
  ) {
    throw new Error('Malformed npm pack size or file list')
  }
  if (!pack.files.every(file => typeof file?.path === 'string' && Number.isSafeInteger(file.size) && file.size >= 0)) {
    throw new Error('Malformed npm pack file entry')
  }
  if (pack.files.reduce((total, file) => total + file.size, 0) !== pack.unpackedSize) {
    throw new Error('Malformed npm pack unpacked size: file sizes do not match')
  }
  const { baselineBytes, hardCapBytes, growthPercent } = limits
  if (
    ![baselineBytes, hardCapBytes, growthPercent].every(Number.isSafeInteger) ||
    baselineBytes <= 0 ||
    hardCapBytes <= 0 ||
    growthPercent < 0
  ) {
    throw new Error('Invalid SDK package size budget')
  }
  const growthCap = Math.floor((baselineBytes * (100 + growthPercent)) / 100)
  if (pack.unpackedSize >= hardCapBytes || pack.unpackedSize > growthCap) {
    throw new Error(
      `SDK unpacked size ${pack.unpackedSize} exceeds budget (below ${hardCapBytes}; growth limit ${growthCap})`
    )
  }
  const maps = pack.files.filter(file => file.path.endsWith('.map'))
  if (maps.length)
    throw new Error(`SDK package must not publish source maps: ${maps.map(file => file.path).join(', ')}`)
  return pack.unpackedSize
}
