import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Node ESM requires explicit file extensions on relative imports, and it will
 * not fall back to `index.js` for directory specifiers. `tsc` with
 * `moduleResolution: bundler` emits extensionless relatives that work in
 * bundlers but break in Node, strict bundler pre-scans (Vite/esbuild
 * `optimizeDeps`), and any tool that follows relatives without consulting the
 * package `exports` map.
 *
 * Two source patterns trip this up after emit:
 *   1. Flat modules — `import './x'` where `./x.ts` exists → emit needs `./x.js`.
 *   2. Directory modules — `import './foo'` where `./foo/index.ts` exists →
 *      emit needs `./foo/index.js`.
 *   3. Bare root — `import '.'` or `import '..'` → emit needs `./index.js` or
 *      `../index.js`.
 *
 * We walk the emitted `dist`, and for every relative specifier we check what
 * actually exists on disk and rewrite to the canonical form. Specifiers whose
 * target cannot be found on disk are left untouched so the real failure
 * surfaces with a clear error instead of being masked by a wrong rewrite.
 *
 * This rewriter covers every shape `tsc`/Rollup can emit:
 *   - Static imports and re-exports, including named / default / namespace
 *     and `export * as ns from '…'`, multi-line specifier lists.
 *   - Dynamic `import('…', options)` with or without an options argument.
 *   - Side-effect `import '…'` with no `from`.
 * It runs over `.js`, `.mjs`, `.cjs`, and `.d.ts` so declarations stay
 * consistent with the emitted code.
 */
function walk(dir, visit) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, visit)
    else visit(p)
  }
}

function hasExplicitExtension(spec) {
  return /\.(js|json|mjs|cjs|wasm)(\?.*)?$/.test(spec)
}

/**
 * Resolve a relative import specifier against the importing file's directory
 * in the emitted `dist`. Returns the canonical specifier (with extension and,
 * if needed, `/index.js`) or `null` if neither a flat file nor a directory
 * module exists on disk.
 */
export function resolveRelativeSpec(fromFile, spec) {
  if (!spec.startsWith('.')) return null
  if (hasExplicitExtension(spec)) return null

  const fromDir = path.dirname(fromFile)
  const absBase = path.resolve(fromDir, spec)

  if (existsSync(`${absBase}.js`)) return `${spec}.js`

  if (existsSync(path.join(absBase, 'index.js'))) {
    // Bare `.` / `..` — ESM requires an explicit file, so point at the index.
    if (spec === '.' || spec === '..') return `${spec}/index.js`
    // Preserve trailing-slash style if the author wrote one.
    const suffix = spec.endsWith('/') ? 'index.js' : '/index.js'
    return `${spec}${suffix}`
  }

  return null
}

// Matches the relative-specifier grammar: `.`, `..`, `./…`, or `../…`.
// Disallows quotes so we never capture past the closing delimiter.
const RELATIVE_SPEC_SRC = String.raw`\.\.?(?:\/[^"']*)?`

/**
 * Rewrite a single source. Exported for tests.
 */
export function fixSource(fromFile, code) {
  const rewrite = spec => {
    const next = resolveRelativeSpec(fromFile, spec)
    return next ?? spec
  }

  let out = code

  // `from "spec"` — catches every static import and re-export form, including
  // `import X from`, `import { a, b } from`, `import * as X from`,
  // `export * from`, `export * as X from`, and `export { … } from` — the
  // specifier list lives before `from`, so multi-line lists are transparent
  // to this regex.
  out = out.replace(
    new RegExp(String.raw`\bfrom\s+(["'])(${RELATIVE_SPEC_SRC})\1`, 'g'),
    (full, q, spec) => {
      const next = rewrite(spec)
      return next === spec ? full : `from ${q}${next}${q}`
    }
  )

  // Dynamic `import("spec"[, options])`. We match only up to the closing
  // quote, leaving the options argument untouched.
  out = out.replace(
    new RegExp(String.raw`\bimport\s*\(\s*(["'])(${RELATIVE_SPEC_SRC})\1`, 'g'),
    (full, q, spec) => {
      const next = rewrite(spec)
      return next === spec ? full : `import(${q}${next}${q}`
    }
  )

  // Side-effect `import "spec"` — no `from`, no `(`. The `\s+["']` after
  // `\bimport\b` excludes `import.meta`, `import(...)`, and
  // `import X from ...` (which has an identifier between `import` and the
  // quote).
  out = out.replace(
    new RegExp(String.raw`\bimport\s+(["'])(${RELATIVE_SPEC_SRC})\1`, 'g'),
    (full, q, spec) => {
      const next = rewrite(spec)
      return next === spec ? full : `import ${q}${next}${q}`
    }
  )

  return out
}

export function fixDistEsmRelativeImports(distRoot) {
  if (!statSync(distRoot, { throwIfNoEntry: false })) return

  walk(distRoot, filePath => {
    if (!/\.(js|mjs|cjs|d\.ts)$/.test(filePath)) return
    const before = readFileSync(filePath, 'utf8')
    const after = fixSource(filePath, before)
    if (after !== before) writeFileSync(filePath, after)
  })
}
