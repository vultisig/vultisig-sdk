const emittedChunks = bundle =>
  new Map(
    Object.values(bundle)
      .filter(output => output.type === 'chunk')
      .map(chunk => [chunk.fileName, chunk])
  )

function measureRollupEagerGraph(bundle) {
  const chunks = emittedChunks(bundle)
  const results = []

  for (const entry of chunks.values()) {
    if (!entry.isEntry) continue
    const visited = new Set()
    const visit = chunk => {
      if (visited.has(chunk.fileName)) return
      visited.add(chunk.fileName)
      for (const dependency of chunk.imports) {
        const importedChunk = chunks.get(dependency)
        if (importedChunk) visit(importedChunk)
      }
    }
    visit(entry)
    const bytes = [...visited].reduce((total, file) => total + Buffer.byteLength(chunks.get(file).code), 0)
    results.push({ entry: entry.fileName, bytes, files: visited.size })
  }

  return results
}

export function validateRollupEagerGraph(bundle, eagerGraphCapBytes) {
  if (!Number.isSafeInteger(eagerGraphCapBytes) || eagerGraphCapBytes <= 0) {
    throw new Error('Invalid SDK eager graph budget')
  }
  const results = measureRollupEagerGraph(bundle)
  if (!results.length) throw new Error('SDK Rollup output has no runtime entries')
  for (const { entry, bytes } of results) {
    validateEagerGraphBytes(entry, bytes, eagerGraphCapBytes)
  }
  return results
}

export function validateEagerGraphBytes(entry, bytes, eagerGraphCapBytes) {
  if (bytes >= eagerGraphCapBytes) {
    throw new Error(`SDK ${entry} eager graph ${bytes} bytes exceeds below-${eagerGraphCapBytes} budget`)
  }
}
