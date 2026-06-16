import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Replaces package.json "exports" with explicit subpath entries so Node/TS/Vite
 * resolve both flat modules (foo.js) and directory modules (foo/index.js).
 */
function walkFiles(dir, visitor, rel = '') {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    const st = statSync(full)
    const r = rel ? `${rel}/${name}` : name
    if (st.isDirectory()) {
      walkFiles(full, visitor, r)
    } else {
      visitor(r.replace(/\\/g, '/'), name)
    }
  }
}

function walkJsFiles(distDir, visitor) {
  walkFiles(distDir, (rel, name) => {
    if (name.endsWith('.js') && !name.endsWith('.js.map')) {
      visitor(rel)
    }
  })
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

export function generateSharedExports(distDir, { packageRoot = path.dirname(distDir) } = {}) {
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

  const fixturesDir = path.join(packageRoot, 'fixtures')
  if (existsSync(fixturesDir)) {
    walkFiles(fixturesDir, (rel, name) => {
      if (name.endsWith('.json')) {
        byKey.set(`./fixtures/${rel}`, `./fixtures/${rel}`)
      }
    })
  }

  const exportsField = Object.fromEntries([...byKey.entries()].sort(([a], [b]) => a.localeCompare(b)))

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

  return exportsField
}

function readPackageJson(packageJsonPath) {
  return JSON.parse(readFileSync(packageJsonPath, 'utf8'))
}

function exportValueKey(value) {
  return JSON.stringify(value)
}

export function diffSharedExports(packageJsonPath, distDir) {
  const pkg = readPackageJson(packageJsonPath)
  const actual = pkg.exports ?? {}
  const expected = generateSharedExports(distDir, {
    packageRoot: path.dirname(packageJsonPath),
  })
  const actualKeys = new Set(Object.keys(actual))
  const expectedKeys = new Set(Object.keys(expected))

  const missing = Object.keys(expected).filter(key => !actualKeys.has(key))
  const extra = Object.keys(actual).filter(key => !expectedKeys.has(key))
  const mismatched = Object.keys(expected)
    .filter(key => actualKeys.has(key))
    .filter(key => exportValueKey(actual[key]) !== exportValueKey(expected[key]))
    .map(key => ({ key, actual: actual[key], expected: expected[key] }))

  return {
    packageJsonPath,
    missing,
    extra,
    mismatched,
  }
}

export function hasSharedExportDiff(diff) {
  return diff.missing.length > 0 || diff.extra.length > 0 || diff.mismatched.length > 0
}

function formatExportValue(value) {
  return JSON.stringify(value)
}

function formatSharedExportDiff(diff, { relativeTo = process.cwd(), regenerateCommand = 'yarn build:shared' } = {}) {
  const packagePath = path.relative(relativeTo, diff.packageJsonPath)
  const lines = [
    `[shared-exports] ${packagePath} has stale generated exports.`,
    `Run \`${regenerateCommand}\` to regenerate shared dist files and package export maps.`,
  ]

  if (diff.missing.length > 0) {
    lines.push('', 'Missing exports:')
    for (const key of diff.missing) {
      lines.push(`  + ${key}`)
    }
  }

  if (diff.extra.length > 0) {
    lines.push('', 'Extra exports:')
    for (const key of diff.extra) {
      lines.push(`  - ${key}`)
    }
  }

  if (diff.mismatched.length > 0) {
    lines.push('', 'Mismatched exports:')
    for (const { key, actual, expected } of diff.mismatched) {
      lines.push(`  * ${key}`)
      lines.push(`    expected: ${formatExportValue(expected)}`)
      lines.push(`    actual:   ${formatExportValue(actual)}`)
    }
  }

  return lines.join('\n')
}

export function checkSharedExports(packageJsonPath, distDir, options) {
  const message = getSharedExportDiffMessage(packageJsonPath, distDir, options)
  if (message) {
    throw new Error(message)
  }
}

export function getSharedExportDiffMessage(packageJsonPath, distDir, options) {
  const diff = diffSharedExports(packageJsonPath, distDir)
  if (!hasSharedExportDiff(diff)) return null

  return formatSharedExportDiff(diff, options)
}

export function applySharedExports(packageJsonPath, distDir) {
  const pkg = readPackageJson(packageJsonPath)
  pkg.exports = generateSharedExports(distDir, {
    packageRoot: path.dirname(packageJsonPath),
  })
  writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`)
}
