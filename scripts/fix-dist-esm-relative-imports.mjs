import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Node ESM requires explicit file extensions for relative imports. `tsc` with
 * moduleResolution "bundler" emits extensionless relatives; rewrite those in dist.
 */
function walk(dir, visit) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, visit)
    else visit(p)
  }
}

function addJsExtension(spec) {
  if (!spec.startsWith('.')) return spec
  if (/\.(js|json|mjs|cjs|wasm)(\?.*)?$/.test(spec)) return spec
  return `${spec}.js`
}

function fixSource(code) {
  let s = code

  s = s.replace(/\bfrom\s+(["'])(\.\.?\/[^"']+)\1/g, (full, q, spec) => {
    const next = addJsExtension(spec)
    return next === spec ? full : `from ${q}${next}${q}`
  })

  s = s.replace(/\bexport\s+\*\s+from\s+(["'])(\.\.?\/[^"']+)\1/g, (full, q, spec) => {
    const next = addJsExtension(spec)
    return next === spec ? full : `export * from ${q}${next}${q}`
  })

  s = s.replace(/\bexport\s+\{[^}]+\}\s+from\s+(["'])(\.\.?\/[^"']+)\1/g, (full, q, spec) => {
    const next = addJsExtension(spec)
    return next === spec ? full : full.replace(`${q}${spec}${q}`, `${q}${next}${q}`)
  })

  s = s.replace(/\bimport\s*\(\s*(["'])(\.\.?\/[^"']+)\1\s*\)/g, (full, q, spec) => {
    const next = addJsExtension(spec)
    return next === spec ? full : `import(${q}${next}${q})`
  })

  return s
}

export function fixDistEsmRelativeImports(distRoot) {
  if (!statSync(distRoot, { throwIfNoEntry: false })) return

  walk(distRoot, filePath => {
    if (!/\.(js|mjs|cjs|d\.ts)$/.test(filePath)) return
    const before = readFileSync(filePath, 'utf8')
    const after = fixSource(before)
    if (after !== before) writeFileSync(filePath, after)
  })
}
