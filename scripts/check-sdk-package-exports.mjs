#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const sdkRoot = path.join(repoRoot, 'packages/sdk')
const sdkManifestPath = path.join(sdkRoot, 'package.json')
const yarnCli = path.join(repoRoot, '.yarn/releases/yarn-4.16.0.cjs')
const platformTargetPattern = /(?:^|[./-])(browser|chrome-extension|react-native|rn-preamble)(?:[./-]|$)/

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      [`Command failed: ${command} ${args.join(' ')}`, result.stdout?.trim(), result.stderr?.trim()]
        .filter(Boolean)
        .join('\n\n')
    )
  }
  return result
}

function runYarn(args, options = {}) {
  if (existsSync(yarnCli)) {
    return run(process.execPath, [yarnCli, ...args], options)
  }
  return run('yarn', args, options)
}

export function collectExportTargets(exportsField) {
  if (!exportsField || typeof exportsField !== 'object' || Array.isArray(exportsField)) {
    throw new Error('SDK package manifest must declare an object-valued exports map')
  }

  const targets = []
  const visit = (value, subpath, conditions) => {
    if (typeof value === 'string') {
      targets.push({ subpath, conditions, target: value })
      return
    }
    if (Array.isArray(value)) {
      value.forEach((candidate, index) => visit(candidate, subpath, [...conditions, `[${index}]`]))
      return
    }
    if (!value || typeof value !== 'object') {
      throw new Error(`SDK export ${subpath} has an unsupported target at ${conditions.join(' > ') || '<root>'}`)
    }
    for (const [condition, target] of Object.entries(value)) {
      visit(target, subpath, [...conditions, condition])
    }
  }

  for (const [subpath, value] of Object.entries(exportsField)) {
    visit(value, subpath, [])
  }
  return targets
}

export function validatePackedExportTargets(manifest, packageRoot) {
  const targets = collectExportTargets(manifest.exports)
  if (!targets.length) {
    throw new Error('SDK package manifest has no export targets')
  }

  for (const { subpath, conditions, target } of targets) {
    if (!target.startsWith('./')) {
      throw new Error(
        `SDK export ${subpath} target at ${conditions.join(' > ') || '<root>'} is not package-relative: ${target}`
      )
    }
    const artifactPath = path.resolve(packageRoot, target.slice(2))
    const relativeArtifactPath = path.relative(packageRoot, artifactPath)
    if (relativeArtifactPath.startsWith('..') || path.isAbsolute(relativeArtifactPath)) {
      throw new Error(
        `SDK export ${subpath} target escapes the packed artifact at ${conditions.join(' > ') || '<root>'}: ${target}`
      )
    }
    if (!existsSync(artifactPath) || !statSync(artifactPath).isFile()) {
      throw new Error(
        `SDK export ${subpath} file target missing from packed artifact at ${conditions.join(' > ') || '<root>'}: ${target}`
      )
    }
  }

  return targets
}

export function resolveConditionalTarget(value, activeConditions) {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const resolved = resolveConditionalTarget(candidate, activeConditions)
      if (resolved) return resolved
    }
    return null
  }
  if (!value || typeof value !== 'object') return null

  for (const [condition, target] of Object.entries(value)) {
    if (condition === 'default' || activeConditions.has(condition)) {
      const resolved = resolveConditionalTarget(target, activeConditions)
      if (resolved) return resolved
    }
  }
  return null
}

function packageSpecifier(packageName, subpath) {
  return subpath === '.' ? packageName : `${packageName}/${subpath.replace(/^\.\//, '')}`
}

export function collectNodeRuntimeCases(manifest, mode) {
  const activeConditions = new Set(['node', mode])
  const cases = []

  for (const [subpath, exportValue] of Object.entries(manifest.exports)) {
    const target = resolveConditionalTarget(exportValue, activeConditions)
    if (!target || platformTargetPattern.test(target)) continue
    cases.push({
      specifier: packageSpecifier(manifest.name, subpath),
      target,
    })
  }
  return cases
}

function writeConsumerFiles(consumerRoot, manifest, importCases, requireCases) {
  writeFileSync(
    path.join(consumerRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'vultisig-sdk-package-export-consumer',
        private: true,
        type: 'module',
        packageManager: 'yarn@4.16.0',
      },
      null,
      2
    )}\n`
  )
  writeFileSync(path.join(consumerRoot, '.yarnrc.yml'), 'nodeLinker: node-modules\n')

  writeFileSync(
    path.join(consumerRoot, 'verify-imports.mjs'),
    `import assert from 'node:assert/strict'

const cases = ${JSON.stringify(importCases, null, 2)}
for (const { specifier, target } of cases) {
  const resolved = import.meta.resolve(specifier)
  assert.ok(
    new URL(resolved).pathname.endsWith(target.slice(1)),
    \`\${specifier} import resolved to \${resolved}, expected \${target}\`
  )
  const imported = await import(specifier)
  assert.ok(imported && typeof imported === 'object', \`\${specifier} import returned a module namespace\`)
}
console.log(\`SDK package import conditions passed for \${cases.length} manifest exports\`)
`
  )

  writeFileSync(
    path.join(consumerRoot, 'verify-requires.cjs'),
    `const assert = require('node:assert/strict')
const path = require('node:path')

const cases = ${JSON.stringify(requireCases, null, 2)}
for (const { specifier, target } of cases) {
  const resolved = require.resolve(specifier)
  assert.ok(
    resolved.endsWith(path.normalize(target.slice(2))),
    \`\${specifier} require resolved to \${resolved}, expected \${target}\`
  )
  assert.notEqual(require(specifier), undefined, \`\${specifier} require returned a value\`)
}
console.log(\`SDK package require conditions passed for \${cases.length} manifest exports\`)
`
  )

  const typeImports = Object.keys(manifest.exports)
    .map(subpath => `import '${packageSpecifier(manifest.name, subpath)}'`)
    .join('\n')
  writeFileSync(path.join(consumerRoot, 'verify-types.ts'), `${typeImports}\n`)
  writeFileSync(
    path.join(consumerRoot, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          noEmit: true,
          skipLibCheck: true,
        },
        include: ['verify-types.ts'],
      },
      null,
      2
    )}\n`
  )
}

function installPackedSdk(consumerRoot, tarballPath) {
  const cacheFolder = path.join(repoRoot, '.yarn/cache')
  const env = {
    ...process.env,
    ...(existsSync(cacheFolder) ? { YARN_CACHE_FOLDER: cacheFolder } : {}),
  }
  runYarn(['add', `@vultisig/sdk@file:${tarballPath}`], {
    cwd: consumerRoot,
    env,
    stdio: 'inherit',
  })
  return env
}

function packSdk(tarballPath) {
  runYarn(['workspace', '@vultisig/sdk', 'pack', '--out', tarballPath], {
    cwd: repoRoot,
    stdio: 'inherit',
  })
}

export function checkSdkPackageExports({
  build = true,
  workRoot: providedWorkRoot,
  tarballPath: providedTarballPath,
} = {}) {
  if (build) {
    runYarn(['build:sdk'], { cwd: repoRoot, stdio: 'inherit' })
  }

  const ownsWorkRoot = !providedWorkRoot
  const workRoot = providedWorkRoot ?? mkdtempSync(path.join(os.tmpdir(), 'vultisig-sdk-package-exports-'))
  const tarballPath = providedTarballPath ?? path.join(workRoot, 'sdk.tgz')

  try {
    mkdirSync(workRoot, { recursive: true })
    if (!providedTarballPath) packSdk(tarballPath)

    const extractRoot = path.join(workRoot, 'artifact')
    mkdirSync(extractRoot, { recursive: true })
    run('tar', ['-xzf', tarballPath, '-C', extractRoot])
    const packageRoot = path.join(extractRoot, 'package')

    const sourceManifest = JSON.parse(readFileSync(sdkManifestPath, 'utf8'))
    const packedManifest = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'))
    assert.deepEqual(
      packedManifest.exports,
      sourceManifest.exports,
      'packed SDK exports must match packages/sdk/package.json'
    )

    const targets = validatePackedExportTargets(sourceManifest, packageRoot)
    const importCases = collectNodeRuntimeCases(sourceManifest, 'import')
    const requireCases = collectNodeRuntimeCases(sourceManifest, 'require')
    if (!importCases.length || !requireCases.length) {
      throw new Error('SDK package manifest exposes no Node-safe import or require cases')
    }

    const consumerRoot = path.join(workRoot, 'consumer')
    mkdirSync(consumerRoot, { recursive: true })
    writeConsumerFiles(consumerRoot, sourceManifest, importCases, requireCases)
    const env = installPackedSdk(consumerRoot, tarballPath)

    run(process.execPath, ['verify-imports.mjs'], { cwd: consumerRoot, env, stdio: 'inherit' })
    run(process.execPath, ['verify-requires.cjs'], { cwd: consumerRoot, env, stdio: 'inherit' })

    const typescriptBin = path.join(repoRoot, 'node_modules/typescript/bin/tsc')
    if (!existsSync(typescriptBin)) {
      throw new Error('TypeScript is required to verify SDK declarations from the clean consumer')
    }
    run(process.execPath, [typescriptBin, '--project', path.join(consumerRoot, 'tsconfig.json')], {
      cwd: consumerRoot,
      env,
      stdio: 'inherit',
    })

    console.log(
      `SDK package export manifest OK: ${Object.keys(sourceManifest.exports).length} exports, ` +
        `${targets.length} conditional targets, ${importCases.length} imports, ${requireCases.length} requires`
    )
  } finally {
    if (ownsWorkRoot) rmSync(workRoot, { recursive: true, force: true })
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (isDirectRun) {
  const args = new Set(process.argv.slice(2))
  const unknownArgs = [...args].filter(arg => arg !== '--skip-build')
  if (unknownArgs.length) {
    console.error(`Unknown arguments: ${unknownArgs.join(', ')}`)
    process.exitCode = 1
  } else {
    try {
      checkSdkPackageExports({ build: !args.has('--skip-build') })
    } catch (error) {
      console.error(error.message || error)
      process.exitCode = 1
    }
  }
}
