import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Replaces package.json "exports" with explicit subpath entries so Node/TS/Vite
 * resolve both flat modules (foo.js) and directory modules (foo/index.js).
 */
function walkJsFiles(distDir, visitor, rel = '') {
  for (const name of readdirSync(distDir)) {
    const full = path.join(distDir, name)
    const st = statSync(full)
    const r = rel ? `${rel}/${name}` : name
    if (st.isDirectory()) {
      walkJsFiles(full, visitor, r)
    } else if (name.endsWith('.js') && !name.endsWith('.js.map')) {
      visitor(r.replace(/\\/g, '/'))
    }
  }
}

function jsRelToExportKey(rel) {
  if (rel === 'index.js') {
    return '.'
  }
  if (rel.endsWith('/index.js')) {
    return `./${rel.slice(0, -'/index.js'.length)}`
  }
  return `./${rel.slice(0, -3)}`
}

function jsRelToTypesPath(rel) {
  return `./dist/${rel.slice(0, -3)}.d.ts`
}

function jsRelToImportPath(rel) {
  return `./dist/${rel}`
}

export function applySharedExports(packageJsonPath, distDir) {
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  const byKey = new Map()

  walkJsFiles(distDir, rel => {
    const key = jsRelToExportKey(rel)
    const types = jsRelToTypesPath(rel)
    const importPath = jsRelToImportPath(rel)
    byKey.set(key, {
      types,
      import: importPath,
      default: importPath,
    })
  })

  byKey.set('./package.json', './package.json')

  const exportsField = Object.fromEntries(
    [...byKey.entries()].sort(([a], [b]) => a.localeCompare(b))
  )

  const sevenShim = path.join(distDir, 'compression/getSevenZip.js')
  const sevenBrowser = path.join(distDir, 'compression/getSevenZip.browser.js')
  const sevenNode = path.join(distDir, 'compression/getSevenZip.node.js')
  if (existsSync(sevenShim) && existsSync(sevenBrowser) && existsSync(sevenNode)) {
    delete exportsField['./compression/getSevenZip.browser']
    delete exportsField['./compression/getSevenZip.node']
    exportsField['./compression/getSevenZip'] = {
      types: './dist/compression/getSevenZip.d.ts',
      browser: './dist/compression/getSevenZip.browser.js',
      node: './dist/compression/getSevenZip.node.js',
      import: './dist/compression/getSevenZip.js',
      default: './dist/compression/getSevenZip.js',
    }
  }

  pkg.exports = exportsField
  writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`)
}
