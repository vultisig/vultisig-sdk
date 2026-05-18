#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const typesDir = join(repoRoot, 'packages/core/mpc/types')

const usage = `
Usage:
  COMMONDATA_DIR=../commondata RECIPES_DIR=../recipes yarn proto:regen:core-mpc

COMMONDATA_DIR is required for generated files whose header starts with
"@generated from file vultisig/...".

RECIPES_DIR is required for plugin policy files whose descriptors currently use
the github.com/vultisig/recipes/types Go package. Point it at either the recipes
repo root or its types/proto subdirectory.
`.trim()

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(usage)
  process.exit(0)
}

const walk = dir =>
  readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return walk(path)
    return entry.isFile() ? [path] : []
  })

const generatedFiles = walk(typesDir)
  .filter(file => file.endsWith('_pb.ts'))
  .filter(file => !file.includes('/types/utils/'))

const sourceFiles = generatedFiles.map(file => {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  const match = lines[1]?.match(/^\/\/ @generated from file (.+?) \(/)
  if (!match) {
    throw new Error(`Missing @generated from file header in ${file}`)
  }
  return match[1]
})

const groups = [
  {
    name: 'vultisig/commondata',
    env: 'COMMONDATA_DIR',
    requiredFile: 'vultisig/keysign/v1/keysign_message.proto',
    files: sourceFiles.filter(file => file.startsWith('vultisig/')).sort(),
    out: 'packages/core/mpc/types',
    protocGenEsVersion: '2.11.0',
    opts: ['target=ts'],
    rootCandidates: ['', 'proto', 'protos'],
  },
  {
    name: 'vultisig/recipes plugin types',
    env: 'RECIPES_DIR',
    requiredFile: 'policy.proto',
    files: sourceFiles.filter(file => !file.startsWith('vultisig/')).sort(),
    out: 'packages/core/mpc/types/plugin',
    protocGenEsVersion: '2.10.2',
    opts: ['target=ts', 'json_types=true'],
    rootCandidates: ['', 'types', 'proto', 'protos'],
  },
].filter(group => group.files.length > 0)

const resolveProtoRoot = group => {
  const configured = process.env[group.env]
  if (!configured) {
    throw new Error(`${group.env} is required for ${group.name}\n\n${usage}`)
  }

  const base = resolve(configured)
  for (const candidate of group.rootCandidates) {
    const root = resolve(base, candidate)
    try {
      readFileSync(join(root, group.requiredFile))
      return root
    } catch {
      // Try the next common source layout.
    }
  }

  throw new Error(`Could not find ${group.requiredFile} under ${base}. Set ${group.env} to the proto root.`)
}

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: false,
    ...options,
  })

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed`)
  }
}

for (const group of groups) {
  const protoRoot = resolveProtoRoot(group)
  const tmp = mkdtempSync(join(tmpdir(), 'vultisig-proto-gen-'))
  const templatePath = join(tmp, 'buf.gen.yaml')

  writeFileSync(
    templatePath,
    [
      'version: v2',
      'plugins:',
      '  - local: protoc-gen-es',
      `    out: ${group.out}`,
      '    opt:',
      ...group.opts.map(opt => `      - ${opt}`),
      '',
    ].join('\n')
  )

  const args = [
    'dlx',
    '-p',
    '@bufbuild/buf',
    '-p',
    `@bufbuild/protoc-gen-es@${group.protocGenEsVersion}`,
    'buf',
    'generate',
    protoRoot,
    '--template',
    templatePath,
    ...group.files.flatMap(file => ['--path', file]),
  ]

  console.log(
    `Regenerating ${group.files.length} ${group.name} proto files from ${relative(repoRoot, protoRoot) || protoRoot}`
  )
  try {
    run('yarn', args)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

console.log('Core MPC protobuf regeneration complete.')
