#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const repoRoot = process.cwd()
const dependencyFields = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
const defaultMinimumAgeDays = 14
const dayMs = 24 * 60 * 60 * 1000

const args = process.argv.slice(2)
const getArgValue = name => {
  const inline = args.find(arg => arg.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

const minimumAgeDays = Number(getArgValue('--min-age-days') ?? process.env.DEPENDENCY_RELEASE_MIN_AGE_DAYS ?? defaultMinimumAgeDays)
const now = new Date(getArgValue('--now') ?? process.env.DEPENDENCY_RELEASE_AGE_NOW ?? Date.now())
const registryUrl = (getArgValue('--registry') ?? process.env.NPM_REGISTRY_URL ?? 'https://registry.npmjs.org').replace(
  /\/+$/,
  ''
)
const lockfilePath = resolve(repoRoot, getArgValue('--lockfile') ?? 'yarn.lock')
const metadataFile = getArgValue('--metadata-file') ?? process.env.DEPENDENCY_RELEASE_METADATA_FILE

if (!Number.isFinite(minimumAgeDays) || minimumAgeDays < 0) {
  throw new Error(`Invalid --min-age-days value: ${minimumAgeDays}`)
}
if (Number.isNaN(now.getTime())) {
  throw new Error(`Invalid --now value: ${now}`)
}

const readJson = path => JSON.parse(readFileSync(path, 'utf8'))

const packageNameFromDescriptor = descriptor => {
  const normalized = descriptor.replace(/^patch:/, '').replace(/^workspace:/, '').replace(/^virtual:/, '')
  const match = normalized.match(/^(@[^/]+\/[^@]+|[^@]+)@(?:npm:|patch:|workspace:|file:|portal:|link:|exec:|git:|https?:|[^@]+$)/)
  if (match) return match[1]

  if (normalized.startsWith('@')) {
    const parts = normalized.split('/')
    return parts.length >= 2 ? `${parts.at(-2)}/${parts.at(-1)?.split('@')[0]}` : normalized
  }

  return normalized.split('@')[0]
}

const packageNameFromResolutionSelector = selector => {
  const descriptorName = packageNameFromDescriptor(selector)
  if (descriptorName.includes('/')) {
    const parts = selector.split('/')
    const lastScopedIndex = parts.findLastIndex(part => part.startsWith('@'))
    if (lastScopedIndex !== -1 && parts[lastScopedIndex + 1]) {
      return `${parts[lastScopedIndex]}/${parts[lastScopedIndex + 1].split('@')[0]}`
    }
  }
  return descriptorName
}

const parseNpmResolution = resolution => {
  const match = resolution.match(/^(@[^/]+\/[^@]+|[^@]+)@npm:(.+)$/)
  if (!match) return undefined
  return { name: match[1], version: match[2] }
}

const workspaceManifestPaths = rootPackage => {
  const patterns = rootPackage.workspaces ?? []
  const manifests = new Set([join(repoRoot, 'package.json')])

  for (const pattern of patterns) {
    const wildcardIndex = pattern.indexOf('*')
    if (wildcardIndex === -1) {
      manifests.add(join(repoRoot, pattern, 'package.json'))
      continue
    }

    const base = join(repoRoot, pattern.slice(0, wildcardIndex))
    let entries = []
    try {
      entries = readdirSync(base)
    } catch {
      continue
    }

    for (const entry of entries) {
      const dir = join(base, entry)
      if (statSync(dir).isDirectory()) {
        manifests.add(join(dir, pattern.slice(wildcardIndex + 1), 'package.json'))
      }
    }
  }

  return [...manifests]
}

const collectDirectPackageNames = () => {
  const rootPackage = readJson(join(repoRoot, 'package.json'))
  const names = new Set()

  for (const manifestPath of workspaceManifestPaths(rootPackage)) {
    let manifest
    try {
      manifest = readJson(manifestPath)
    } catch {
      continue
    }

    for (const field of dependencyFields) {
      for (const name of Object.keys(manifest[field] ?? {})) {
        names.add(name)
      }
    }

    for (const selector of Object.keys(manifest.resolutions ?? {})) {
      names.add(packageNameFromResolutionSelector(selector))
    }
  }

  return names
}

const parseYarnLock = () => {
  const entries = []
  let current

  for (const line of readFileSync(lockfilePath, 'utf8').split(/\r?\n/)) {
    if (!line || line === '__metadata:') continue

    const header = line.match(/^("?)(.+)\1:$/)
    if (header && !line.startsWith(' ')) {
      current = { descriptorText: header[2] }
      entries.push(current)
      continue
    }

    if (!current) continue

    const version = line.match(/^  version: (.+)$/)
    if (version) current.version = version[1].replace(/^"|"$/g, '')

    const resolution = line.match(/^  resolution: "?([^"]+)"?$/)
    if (resolution) current.resolution = resolution[1]
  }

  return entries
    .map(entry => {
      const resolved = entry.resolution ? parseNpmResolution(entry.resolution) : undefined
      if (!resolved) return undefined
      return {
        name: resolved.name,
        version: resolved.version,
        descriptors: entry.descriptorText.split(/,\s+/),
      }
    })
    .filter(Boolean)
}

const metadataFixture = metadataFile ? readJson(resolve(repoRoot, metadataFile)) : undefined

const fetchPackageMetadata = async name => {
  if (metadataFixture) {
    const metadata = metadataFixture[name]
    if (!metadata) throw new Error(`metadata fixture missing package ${name}`)
    return metadata
  }

  const encodedName = name.startsWith('@') ? `@${encodeURIComponent(name.slice(1)).replace('%2F', '%2f')}` : encodeURIComponent(name)
  const response = await fetch(`${registryUrl}/${encodedName}`)
  if (!response.ok) {
    throw new Error(`npm metadata lookup failed for ${name}: ${response.status} ${response.statusText}`)
  }
  return response.json()
}

const main = async () => {
  const directNames = collectDirectPackageNames()
  const directResolved = parseYarnLock()
    .filter(entry => directNames.has(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))

  const metadataByPackage = new Map()
  const tooYoung = []
  const missingTimes = []

  for (const entry of directResolved) {
    if (!metadataByPackage.has(entry.name)) {
      metadataByPackage.set(entry.name, await fetchPackageMetadata(entry.name))
    }

    const metadata = metadataByPackage.get(entry.name)
    const publishedAt = metadata?.time?.[entry.version]
    if (!publishedAt) {
      missingTimes.push(entry)
      continue
    }

    const publishedDate = new Date(publishedAt)
    const ageDays = (now.getTime() - publishedDate.getTime()) / dayMs
    if (ageDays < minimumAgeDays) {
      tooYoung.push({ ...entry, publishedAt, ageDays })
    }
  }

  if (missingTimes.length || tooYoung.length) {
    if (tooYoung.length) {
      process.stderr.write(
        [
          `Direct dependencies resolved to npm versions younger than ${minimumAgeDays} days:`,
          ...tooYoung.map(
            entry =>
              `- ${entry.name}@${entry.version} published ${entry.publishedAt} (${entry.ageDays.toFixed(1)} days old)`
          ),
        ].join('\n') + '\n'
      )
    }

    if (missingTimes.length) {
      process.stderr.write(
        [
          'Could not find npm publish times for resolved direct dependencies:',
          ...missingTimes.map(entry => `- ${entry.name}@${entry.version}`),
        ].join('\n') + '\n'
      )
    }

    process.exit(1)
  }

  process.stdout.write(
    `Checked ${directResolved.length} resolved direct dependency version(s); all are at least ${minimumAgeDays} days old.\n`
  )
  process.exit(0)
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
