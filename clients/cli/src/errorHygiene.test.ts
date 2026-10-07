import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { create, toBinary } from '@bufbuild/protobuf'
import { LibType } from '@vultisig/core-mpc/types/vultisig/keygen/v1/lib_type_message_pb'
import { VaultContainerSchema } from '@vultisig/core-mpc/types/vultisig/vault/v1/vault_container_pb'
import { Vault_KeyShareSchema, VaultSchema } from '@vultisig/core-mpc/types/vultisig/vault/v1/vault_pb'
import { encryptWithAesGcm } from '@vultisig/lib-utils/encryption/aesGcm/encryptWithAesGcm'
import { describe, expect, it } from 'vitest'

const CLI_ENTRY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'index.ts')
const TIMEOUT = 120_000

type ErrorEnvelope = {
  success: false
  error: { code: string; exitCode: number; message: string; hint?: string; context?: Record<string, string> }
}

function runCli(args: string[], configDir = mkdtempSync(path.join(tmpdir(), 'vultisig-error-hygiene-'))) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NO_COLOR: '1',
    VULTISIG_CONFIG_DIR: configDir,
  }
  delete env.COMP_LINE
  delete env.COMP_POINT
  delete env.COMP_CWORD
  delete env.VAULT_PASSWORD
  delete env.VULTISIG_PASSWORD

  return spawnSync(process.execPath, ['--import', 'tsx', CLI_ENTRY, ...args], {
    input: '',
    encoding: 'utf8',
    timeout: TIMEOUT,
    env,
  })
}

function errorEnvelope(result: ReturnType<typeof runCli>): ErrorEnvelope {
  expect(result.stdout, result.stderr).not.toBe('')
  return JSON.parse(result.stdout) as ErrorEnvelope
}

function expectError(result: ReturnType<typeof runCli>, code: string, exitCode: number): ErrorEnvelope {
  expect(result.status, result.stderr || result.stdout).toBe(exitCode)
  const envelope = errorEnvelope(result)
  expect(envelope).toMatchObject({ success: false, error: { code, exitCode } })
  return envelope
}

function encryptedVaultFixture(password: string): string {
  const ecdsaPublicKey = `02${'11'.repeat(32)}`
  const eddsaPublicKey = '22'.repeat(32)
  const vault = create(VaultSchema, {
    name: 'CLI error fixture',
    publicKeyEcdsa: ecdsaPublicKey,
    publicKeyEddsa: eddsaPublicKey,
    signers: ['SyntheticDevice'],
    hexChainCode: '00'.repeat(32),
    localPartyId: 'SyntheticDevice',
    libType: LibType.DKLS,
    keyShares: [
      create(Vault_KeyShareSchema, { publicKey: ecdsaPublicKey, keyshare: 'synthetic-ecdsa-share' }),
      create(Vault_KeyShareSchema, { publicKey: eddsaPublicKey, keyshare: 'synthetic-eddsa-share' }),
    ],
  })
  const encrypted = encryptWithAesGcm({ key: password, value: Buffer.from(toBinary(VaultSchema, vault)) })
  const container = create(VaultContainerSchema, {
    version: 1n,
    vault: encrypted.toString('base64'),
    isEncrypted: true,
  })
  return Buffer.from(toBinary(VaultContainerSchema, container)).toString('base64')
}

describe('CLI input error hygiene', { timeout: TIMEOUT }, () => {
  it('A: rejects --destination-tag on a non-XRP chain as INVALID_INPUT', () => {
    const result = runCli([
      '--output',
      'json',
      'send',
      'Ethereum',
      '0x0000000000000000000000000000000000000001',
      '0.1',
      '--destination-tag',
      '5',
      '--dry-run',
    ])
    const envelope = expectError(result, 'INVALID_INPUT', 4)
    expect(envelope.error.message).toBe('--destination-tag is only supported for XRP')
  })

  it.each([
    ['send', ['send', 'Ethereum', '0x0000000000000000000000000000000000000001', '--dry-run']],
    ['swap-quote', ['swap-quote', 'Ethereum', 'Bitcoin']],
    ['swap', ['swap', 'Ethereum', 'Bitcoin', '--dry-run']],
  ])('C: rejects a missing amount for %s as INVALID_INPUT', (_command, args) => {
    const envelope = expectError(runCli(['--output', 'json', ...args]), 'INVALID_INPUT', 4)
    expect(envelope.error.message).toBe('Provide an amount or use --max')
  })

  it.each(['abc', '101', '-1'])('E: rejects raw --slippage %s with the documented range', raw => {
    const envelope = expectError(
      runCli(['--output', 'json', 'swap', 'Ethereum', 'Bitcoin', '1', '--slippage', raw, '--dry-run']),
      'INVALID_INPUT',
      4
    )
    expect(envelope.error.message).toContain(`"${raw}"`)
    expect(envelope.error.message).toContain('a percentage from 0 to 50')
  })

  it('E: documents the 0 to 50 slippage range in swap help', () => {
    const result = runCli(['swap', '--help'])
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toMatch(/--slippage.*0 to 50/i)
  })

  it.each([
    ['missing required option', ['tx-status', '--tx-hash', 'abc']],
    ['unknown option', ['tx-status', '--unknown-option']],
    ['unknown command', ['definitely-not-a-command']],
    ['missing command argument', ['send', 'Ethereum']],
  ])('F: emits a single JSON usage envelope for %s', (_case, args) => {
    const result = runCli(['--output', 'json', ...args])
    const envelope = expectError(result, 'USAGE_ERROR', 1)
    expect(envelope.error.message).toBeTruthy()
    expect(result.stdout.trim().split('\n').filter(Boolean).length).toBeGreaterThan(0)
    expect(result.stderr).toBe('')
  })

  it('F: keeps Commander plain text in table mode', () => {
    const result = runCli(['--output', 'table', 'tx-status', '--tx-hash', 'abc'])
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain("required option '--chain <chain>' not specified")
  })

  it.each([['--help'], ['--version']])('F: keeps %s successful in JSON mode', flag => {
    const result = runCli(['--output', 'json', flag])
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).not.toBe('')
    expect(result.stderr).toBe('')
  })

  it('G: classifies a wrong export password against an encrypted fixture as AUTH_REQUIRED', () => {
    const configDir = mkdtempSync(path.join(tmpdir(), 'vultisig-wrong-export-password-'))
    try {
      const fixture = path.join(configDir, 'fixture.vult')
      writeFileSync(fixture, encryptedVaultFixture('correct-password'))
      const imported = runCli(['--output', 'json', 'import', fixture, '--password', 'correct-password'], configDir)
      expect(imported.status, imported.stderr || imported.stdout).toBe(0)

      const result = runCli(
        ['--output', 'json', 'export', path.join(configDir, 'out.vult'), '--password', 'wrong-password'],
        configDir
      )
      const envelope = expectError(result, 'AUTH_REQUIRED', 2)
      expect(envelope.error).toMatchObject({
        message: 'Wrong vault password',
        hint: 'Check the password and try again',
      })
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  it('H: rejects a non-JSON execute message as INVALID_INPUT before vault access', () => {
    const envelope = expectError(
      runCli(['--output', 'json', 'execute', 'THORChain', 'thor1contract', 'notjson', '--dry-run']),
      'INVALID_INPUT',
      4
    )
    expect(envelope.error.message).toBe('Invalid JSON message: notjson')
  })

  it('I: checks a missing import file before prompting for a password', () => {
    const missing = path.join(tmpdir(), `missing-${process.pid}-${Date.now()}.vult`)
    const envelope = expectError(
      runCli(['--output', 'json', '--non-interactive', 'import', missing]),
      'INVALID_INPUT',
      4
    )
    expect(envelope.error.message).toContain('ENOENT')
    expect(envelope.error.message).toContain(missing)
  })

  it('I: classifies a non-vault import container as INVALID_INPUT', () => {
    const configDir = mkdtempSync(path.join(tmpdir(), 'vultisig-garbage-import-'))
    try {
      const garbage = path.join(configDir, 'garbage.vult')
      writeFileSync(garbage, 'not a vault')
      const envelope = expectError(
        runCli(['--output', 'json', 'import', garbage, '--password', 'irrelevant'], configDir),
        'INVALID_INPUT',
        4
      )
      expect(envelope.error.message).toMatch(/invalid \.vult container/i)
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })
})
