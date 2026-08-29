#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(import.meta.url)
const defaultRepoRoot = path.resolve(path.dirname(scriptPath), '..')

const readJson = file => JSON.parse(readFileSync(file, 'utf8'))

const lstatIfPresent = file => {
  try {
    return lstatSync(file)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

const isLinkedWorktree = repoRoot => lstatIfPresent(path.join(repoRoot, '.git'))?.isFile() ?? false

const expandWorkspacePattern = (repoRoot, pattern) => {
  let candidates = [repoRoot]

  for (const segment of pattern.split('/')) {
    if (!segment) continue

    if (segment === '*') {
      candidates = candidates.flatMap(candidate =>
        readdirSync(candidate, { withFileTypes: true })
          .filter(entry => entry.isDirectory())
          .map(entry => path.join(candidate, entry.name))
      )
    } else {
      candidates = candidates.map(candidate => path.join(candidate, segment))
    }
  }

  return candidates.filter(candidate => existsSync(path.join(candidate, 'package.json')))
}

export const readWorkspaces = repoRoot => {
  const rootPackage = readJson(path.join(repoRoot, 'package.json'))
  const patterns = Array.isArray(rootPackage.workspaces) ? rootPackage.workspaces : rootPackage.workspaces?.packages

  if (!Array.isArray(patterns) || patterns.length === 0) {
    throw new Error('Root package.json must declare at least one workspace')
  }

  const workspaces = patterns
    .flatMap(pattern => expandWorkspacePattern(repoRoot, pattern))
    .map(dir => {
      const manifest = readJson(path.join(dir, 'package.json'))
      if (!manifest.name) throw new Error(`Workspace ${path.relative(repoRoot, dir)} has no package name`)
      return { dir, name: manifest.name }
    })

  const duplicateNames = workspaces.filter(
    (workspace, index) => workspaces.findIndex(candidate => candidate.name === workspace.name) !== index
  )
  if (duplicateNames.length > 0) {
    throw new Error(`Duplicate workspace package name(s): ${duplicateNames.map(({ name }) => name).join(', ')}`)
  }

  return workspaces
}

const assertDirectoryIsOwned = (repoRoot, directory) => {
  const relative = path.relative(repoRoot, directory)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to create overrides outside the worktree: ${directory}`)
  }

  let current = repoRoot
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    const stat = lstatIfPresent(current)
    if (!stat) {
      mkdirSync(current)
      continue
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing to write through symlinked directory: ${path.relative(repoRoot, current)}`)
    }
    if (!stat.isDirectory()) {
      throw new Error(`Expected a directory at ${path.relative(repoRoot, current)}`)
    }
  }
}

const findUnsafeDirectory = (repoRoot, directory) => {
  const relative = path.relative(repoRoot, directory)
  if (relative.startsWith('..') || path.isAbsolute(relative)) return directory

  let current = repoRoot
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    const stat = lstatIfPresent(current)
    if (!stat) continue
    if (stat.isSymbolicLink() || !stat.isDirectory()) return current
  }
  return null
}

const overrideConsumers = (repoRoot, workspaces) => {
  const consumers = workspaces.map(workspace => ({ ...workspace, label: workspace.name }))
  const scriptsDir = path.join(repoRoot, 'scripts')
  if (existsSync(scriptsDir)) consumers.push({ dir: scriptsDir, label: 'root scripts', name: null })
  return consumers
}

const dependencySections = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
const sourceExtensions = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx'])
const ignoredSourceDirectories = new Set(['.git', 'build', 'coverage', 'dist', 'node_modules'])

const collectImportedWorkspaceNames = (directory, workspaceNames) => {
  const imported = new Set()
  const visit = current => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue
      const entryPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (!ignoredSourceDirectories.has(entry.name)) visit(entryPath)
        continue
      }
      if (!entry.isFile() || !sourceExtensions.has(path.extname(entry.name))) continue

      const source = readFileSync(entryPath, 'utf8')
      for (const match of source.matchAll(/['"`](@[^/'"`\s]+\/[^/'"`\s]+)(?:\/[^'"`]*)?['"`]/g)) {
        if (workspaceNames.has(match[1])) imported.add(match[1])
      }
    }
  }

  visit(directory)
  return imported
}

const referencedWorkspaceNames = (consumer, workspaceNames) => {
  const referenced = collectImportedWorkspaceNames(consumer.dir, workspaceNames)
  const manifestPath = path.join(consumer.dir, 'package.json')
  if (existsSync(manifestPath)) {
    const manifest = readJson(manifestPath)
    for (const section of dependencySections) {
      for (const name of Object.keys(manifest[section] ?? {})) {
        if (workspaceNames.has(name)) referenced.add(name)
      }
    }
  }
  if (consumer.name) referenced.delete(consumer.name)
  return referenced
}

const expectedOverrides = (repoRoot, workspaces) =>
  overrideConsumers(repoRoot, workspaces).flatMap(consumer => {
    const workspaceNames = new Set(workspaces.map(({ name }) => name))
    const referencedNames = referencedWorkspaceNames(consumer, workspaceNames)
    return workspaces
      .filter(workspace => referencedNames.has(workspace.name))
      .map(workspace => ({
        consumer,
        link: path.join(consumer.dir, 'node_modules', ...workspace.name.split('/')),
        workspace,
      }))
  })

const verifyLinkTarget = ({ consumer, link, workspace }, repoRoot) => {
  const stat = lstatIfPresent(link)
  const display = path.relative(repoRoot, link)
  const unsafeDirectory = findUnsafeDirectory(repoRoot, path.dirname(link))

  if (unsafeDirectory) {
    return `${display} is inside unsafe symlinked or non-directory path ${path.relative(repoRoot, unsafeDirectory)}`
  }

  if (!stat?.isSymbolicLink()) {
    return `${display} is missing a local override for ${workspace.name} (${consumer.label})`
  }

  try {
    if (realpathSync(link) !== realpathSync(workspace.dir)) {
      return `${display} resolves outside this worktree: ${readlinkSync(link)}`
    }
  } catch (error) {
    return `${display} is not a valid local override: ${error.message}`
  }

  return null
}

const verifyNestedNodeModulesLink = repoRoot => {
  if (!isLinkedWorktree(repoRoot)) return null

  const nestedLink = path.join(repoRoot, 'node_modules', 'node_modules')
  const stat = lstatIfPresent(nestedLink)
  if (!stat?.isSymbolicLink()) return null

  let target
  try {
    target = realpathSync(nestedLink)
  } catch (error) {
    return `node_modules/node_modules is an invalid nested symlink: ${error.message}`
  }

  return `node_modules/node_modules is an unsafe nested symlink resolving to ${target}; run \`yarn worktree:setup --from /path/to/main/clone\` before trusting tests`
}

const verifyInstalledWorkspaceLinks = (repoRoot, workspaces) => {
  const nestedLinkFailure = verifyNestedNodeModulesLink(repoRoot)
  const failures = [
    ...(nestedLinkFailure ? [nestedLinkFailure] : []),
    ...workspaces.flatMap(workspace => {
      const link = path.join(repoRoot, 'node_modules', ...workspace.name.split('/'))
      const failure = verifyLinkTarget(
        {
          consumer: { label: 'root install' },
          link,
          workspace,
        },
        repoRoot
      )
      return failure ? [failure] : []
    }),
  ]

  if (failures.length > 0) {
    throw new Error(`Worktree module-resolution check failed:\n- ${failures.join('\n- ')}`)
  }

  return { mode: 'local-install', overrides: workspaces.length }
}

export const verifyWorktreeResolution = repoRoot => {
  const workspaces = readWorkspaces(repoRoot)
  const rootNodeModules = path.join(repoRoot, 'node_modules')
  const rootStat = lstatIfPresent(rootNodeModules)

  if (!rootStat) {
    throw new Error('Worktree module-resolution check failed: root node_modules is missing')
  }

  if (!rootStat.isSymbolicLink()) {
    if (!rootStat.isDirectory()) throw new Error('Worktree node_modules is neither a directory nor a symlink')
    return verifyInstalledWorkspaceLinks(repoRoot, workspaces)
  }

  try {
    const targetStat = lstatSync(realpathSync(rootNodeModules))
    if (!targetStat.isDirectory()) throw new Error('target is not a directory')
  } catch (error) {
    throw new Error(`Worktree node_modules symlink is invalid: ${error.message}`)
  }

  const overrides = expectedOverrides(repoRoot, workspaces)
  const failures = overrides.map(override => verifyLinkTarget(override, repoRoot)).filter(Boolean)

  if (failures.length > 0) {
    throw new Error(
      `Worktree module-resolution check failed (${failures.length} unsafe or missing override(s)):\n- ${failures.join(
        '\n- '
      )}\nRun \`yarn worktree:setup --from /path/to/main/clone\` before trusting tests.`
    )
  }

  return { mode: 'shared-node-modules', overrides: overrides.length }
}

const assertMatchingRepository = (repoRoot, sourceRoot) => {
  if (realpathSync(repoRoot) === realpathSync(sourceRoot)) {
    throw new Error('The --from path must be a different checkout')
  }

  const targetPackage = readJson(path.join(repoRoot, 'package.json'))
  const sourcePackage = readJson(path.join(sourceRoot, 'package.json'))
  if (targetPackage.name !== sourcePackage.name || targetPackage.packageManager !== sourcePackage.packageManager) {
    throw new Error('The --from path is not a matching checkout of this repository')
  }
}

export const repairNestedNodeModulesLink = (repoRoot, sourceRoot = null) => {
  if (!isLinkedWorktree(repoRoot)) {
    throw new Error('Nested node_modules repair must run from a linked Git worktree')
  }

  const rootNodeModules = path.join(repoRoot, 'node_modules')
  const rootStat = lstatIfPresent(rootNodeModules)
  if (!rootStat || rootStat.isSymbolicLink()) {
    return { removed: 0, skipped: 'root node_modules is missing or shared' }
  }
  if (!rootStat.isDirectory()) throw new Error('Worktree node_modules is not a directory')

  const nestedLink = path.join(rootNodeModules, 'node_modules')
  const nestedStat = lstatIfPresent(nestedLink)
  if (!nestedStat) return { removed: 0 }
  if (!nestedStat.isSymbolicLink()) {
    throw new Error('Refusing to replace non-symlink path: node_modules/node_modules')
  }

  let target
  try {
    target = realpathSync(nestedLink)
  } catch (error) {
    throw new Error(`Refusing to remove invalid nested node_modules symlink: ${error.message}`)
  }

  const allowedTargets = new Set([realpathSync(rootNodeModules)])
  if (sourceRoot) {
    assertMatchingRepository(repoRoot, sourceRoot)
    const sourceNodeModules = path.join(sourceRoot, 'node_modules')
    const sourceStat = lstatIfPresent(sourceNodeModules)
    if (!sourceStat) throw new Error(`Source node_modules does not exist: ${sourceNodeModules}`)
    const resolvedSourceNodeModules = realpathSync(sourceNodeModules)
    if (!lstatSync(resolvedSourceNodeModules).isDirectory()) {
      throw new Error(`Source node_modules is not a directory: ${sourceNodeModules}`)
    }
    allowedTargets.add(resolvedSourceNodeModules)
  }

  if (!allowedTargets.has(target)) {
    throw new Error(
      `Refusing to remove unexpected nested node_modules symlink to ${target}; pass --from only for its matching checkout`
    )
  }

  unlinkSync(nestedLink)
  return { removed: 1 }
}

export const ensureSharedNodeModules = (repoRoot, sourceRoot) => {
  const rootNodeModules = path.join(repoRoot, 'node_modules')
  const rootStat = lstatIfPresent(rootNodeModules)

  if (rootStat) {
    if (rootStat.isDirectory() && !rootStat.isSymbolicLink()) {
      if (sourceRoot) assertMatchingRepository(repoRoot, sourceRoot)
      return { mode: 'local-install', created: false }
    }
    if (!rootStat.isSymbolicLink()) throw new Error('Worktree node_modules is neither a directory nor a symlink')

    if (sourceRoot) {
      assertMatchingRepository(repoRoot, sourceRoot)
      const requestedSource = path.join(sourceRoot, 'node_modules')
      if (realpathSync(rootNodeModules) !== realpathSync(requestedSource)) {
        throw new Error(`Existing node_modules symlink does not point at ${requestedSource}`)
      }
    }

    return { mode: 'shared-node-modules', created: false }
  }

  if (!sourceRoot) {
    throw new Error('Root node_modules is missing; pass --from /path/to/main/clone or run a real worktree install')
  }

  assertMatchingRepository(repoRoot, sourceRoot)
  const sourceNodeModules = path.join(sourceRoot, 'node_modules')
  const sourceStat = lstatIfPresent(sourceNodeModules)
  if (!sourceStat) throw new Error(`Source node_modules does not exist: ${sourceNodeModules}`)
  if (!lstatSync(realpathSync(sourceNodeModules)).isDirectory()) {
    throw new Error(`Source node_modules is not a directory: ${sourceNodeModules}`)
  }

  symlinkSync(path.relative(repoRoot, sourceNodeModules), rootNodeModules, 'dir')
  return { mode: 'shared-node-modules', created: true }
}

export const setupWorkspaceOverrides = repoRoot => {
  const rootNodeModules = path.join(repoRoot, 'node_modules')
  const rootStat = lstatIfPresent(rootNodeModules)
  if (!rootStat?.isSymbolicLink()) {
    return { created: 0, removed: 0, replaced: 0, reused: 0, skipped: 'root node_modules is a local directory' }
  }

  const workspaces = readWorkspaces(repoRoot)
  const overrides = expectedOverrides(repoRoot, workspaces)
  const expectedLinks = new Set(overrides.map(({ link }) => link))
  const result = { created: 0, removed: 0, replaced: 0, reused: 0 }

  for (const consumer of overrideConsumers(repoRoot, workspaces)) {
    for (const workspace of workspaces) {
      const link = path.join(consumer.dir, 'node_modules', ...workspace.name.split('/'))
      if (expectedLinks.has(link)) continue
      const existing = lstatIfPresent(link)
      if (!existing?.isSymbolicLink()) continue
      try {
        if (realpathSync(link) !== realpathSync(workspace.dir)) continue
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
        continue
      }
      assertDirectoryIsOwned(repoRoot, path.dirname(link))
      unlinkSync(link)
      result.removed += 1
    }
  }

  for (const override of overrides) {
    const scopeDir = path.dirname(override.link)
    assertDirectoryIsOwned(repoRoot, scopeDir)

    const existing = lstatIfPresent(override.link)
    if (existing) {
      if (!existing.isSymbolicLink()) {
        throw new Error(`Refusing to replace non-symlink override: ${path.relative(repoRoot, override.link)}`)
      }
      let isCorrect = false
      try {
        isCorrect = realpathSync(override.link) === realpathSync(override.workspace.dir)
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      if (isCorrect) {
        result.reused += 1
        continue
      }
      unlinkSync(override.link)
      result.replaced += 1
    } else {
      result.created += 1
    }

    symlinkSync(path.relative(scopeDir, override.workspace.dir), override.link, 'dir')
  }

  return result
}

export const setupWorktreeDependencies = (repoRoot, sourceRoot = null) => {
  const nodeModules = ensureSharedNodeModules(repoRoot, sourceRoot)
  const nestedLink = repairNestedNodeModulesLink(repoRoot, sourceRoot)
  const overrides = setupWorkspaceOverrides(repoRoot)
  const receipt = verifyWorktreeResolution(repoRoot)
  return { nestedLink, nodeModules, overrides, receipt }
}

const assertLinkedWorktree = repoRoot => {
  const gitEntry = lstatIfPresent(path.join(repoRoot, '.git'))
  if (!gitEntry?.isFile()) {
    throw new Error('Setup must run from a linked Git worktree; use yarn install in the primary checkout')
  }
}

const parseArgs = args => {
  const options = { build: true, check: false, sourceRoot: null }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--check') options.check = true
    else if (arg === '--skip-build') options.build = false
    else if (arg === '--from') {
      options.sourceRoot = args[++index]
      if (!options.sourceRoot || options.sourceRoot.startsWith('-')) throw new Error('--from requires a checkout path')
    } else if (!arg.startsWith('-') && !options.sourceRoot) options.sourceRoot = arg
    else throw new Error(`Unknown argument: ${arg}`)
  }

  if (options.sourceRoot) options.sourceRoot = path.resolve(options.sourceRoot)
  if (options.check && options.sourceRoot) throw new Error('--check does not accept --from')
  if (options.check && !options.build) throw new Error('--skip-build is only valid during setup')
  return options
}

const runBuild = repoRoot => {
  const build = spawnSync(process.execPath, [path.join(repoRoot, 'scripts/build-shared-packages.mjs')], {
    cwd: repoRoot,
    stdio: 'inherit',
  })
  if (build.error) throw build.error
  if (build.status !== 0) throw new Error(`Shared package build failed with exit ${build.status ?? 1}`)
}

const main = () => {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
    if (options.check) {
      const receipt = verifyWorktreeResolution(defaultRepoRoot)
      console.log(
        `[vultisig-worktree] PASS: ${receipt.overrides} workspace resolution link(s) stay inside this checkout (${receipt.mode}).`
      )
      return
    }

    assertLinkedWorktree(defaultRepoRoot)
    const { nestedLink, nodeModules, overrides, receipt } = setupWorktreeDependencies(
      defaultRepoRoot,
      options.sourceRoot
    )

    console.log(
      `[vultisig-worktree] node_modules=${nodeModules.mode}; overrides created=${overrides.created}, replaced=${
        overrides.replaced
      }, removed=${overrides.removed}, reused=${overrides.reused}; nested links removed=${
        nestedLink.removed
      }; verified=${receipt.overrides}.`
    )

    if (options.build) runBuild(defaultRepoRoot)
    else console.log('[vultisig-worktree] Shared package build skipped by request.')
  } catch (error) {
    console.error(`[vultisig-worktree] ${error.message}`)
    console.error(
      'Usage: node scripts/setup-worktree.mjs [--from /path/to/main/clone] [--skip-build]\n' +
        '       node scripts/setup-worktree.mjs --check'
    )
    process.exitCode = 1
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) main()
