import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const CLI_ENTRY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'index.ts')
const TIMEOUT = 120_000

const IDENTITY = JSON.stringify({
  ecdsaPublicKey: '02deadbeef',
  eddsaPublicKey: '01'.repeat(32),
  hexChainCode: 'deadbeef',
  localPartyId: 'cli-prep-test',
  libType: 'DKLS',
})

const OSMO_SENDER = 'osmo1c3a7qq6trpvdver98agv6d9cqex94889k5ejr7'
const OSMO_RECIPIENT = 'osmo12f8hyk2prj2f5w2j3at9ndrxw390ejkr5nt99h'
const OSMO_CONTRACT = 'osmo1kyekxn2qmcjt902sywxm42a2h2d35ssn9ljpvuf77mewevup4kds298e77'
const OSMO_VALIDATOR = 'osmovaloper18ez5c566v95x7anasj9e9xdq57htt0xrztjrg0'
const TERRA_RECIPIENT = 'terra1pfp2hrw36ynx5nzvzgcq3tzrkxy90uj9guduky'

function runPrep(args: string[]) {
  const configDir = mkdtempSync(path.join(tmpdir(), 'vultisig-cli-prep-'))
  try {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NO_COLOR: '1',
      VULTISIG_CONFIG_DIR: configDir,
    }
    delete env.COMP_LINE
    delete env.COMP_POINT
    delete env.COMP_CWORD
    return spawnSync(
      process.execPath,
      ['--import', 'tsx', CLI_ENTRY, '--output', 'json', '--non-interactive', 'prep', ...args],
      { input: '', encoding: 'utf8', timeout: TIMEOUT, env }
    )
  } finally {
    rmSync(configDir, { recursive: true, force: true })
  }
}

function expectSuccess(args: string[], helper: string) {
  const result = runPrep(args)
  expect(result.status, result.stderr || result.stdout).toBe(0)
  expect(result.stderr).toBe('')
  const json = JSON.parse(result.stdout)
  expect(json).toMatchObject({
    success: true,
    v: 1,
    data: { helper, unsigned: true },
  })
  return json.data.result
}

describe('prep commands exercise SDK helpers through a real subprocess', { timeout: TIMEOUT }, () => {
  it('routes contract-call arguments to the EVM-only helper before wallet access', () => {
    const result = runPrep([
      'contract-call',
      'Bitcoin',
      '0x0000000000000000000000000000000000000001',
      'approve',
      '--abi',
      '[]',
      '--sender',
      '0x0000000000000000000000000000000000000002',
      '--identity',
      IDENTITY,
    ])
    expect(result.status).not.toBe(0)
    expect(JSON.parse(result.stdout).error.message).toMatch(/only supports EVM chains.*Bitcoin/i)
  })

  it('rejects lossy numeric ABI lexemes before JSON parsing can change transaction bytes', () => {
    for (const args of ['[9007199254740993]', '[1.0000000000000001]', '[9007199254740991.1]']) {
      const result = runPrep([
        'contract-call',
        'Ethereum',
        '0x0000000000000000000000000000000000000001',
        'setValue',
        '--abi',
        '[{"type":"function","name":"setValue","inputs":[{"name":"value","type":"uint256"}]}]',
        '--args',
        args,
        '--sender',
        '0x0000000000000000000000000000000000000002',
        '--identity',
        IDENTITY,
      ])
      expect(result.status).not.toBe(0)
      expect(JSON.parse(result.stdout).error.message).toMatch(/safe base-10 integer literals.*decimal strings/i)
    }
  })

  it('builds an IBC transfer envelope', () => {
    const result = expectSuccess(
      [
        'ibc-transfer',
        'Osmosis',
        OSMO_SENDER,
        TERRA_RECIPIENT,
        'uosmo',
        '1000000',
        '--source-channel',
        'channel-341',
        '--now-ms',
        '1782604800000',
      ],
      'ibc-transfer'
    )
    expect(result).toMatchObject({
      fromChain: 'osmosis-1',
      destChain: 'phoenix-1',
      sourceChannel: 'channel-341',
    })
  })

  it('builds an SPL transfer instruction', () => {
    const result = expectSuccess(
      [
        'spl-transfer',
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
        '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
        '1000000',
        '6',
      ],
      'spl-transfer'
    )
    expect(result).toMatchObject({
      chain: 'Solana',
      amount: '1000000',
      decimals: 6,
      isToken2022: false,
    })
    expect(result.instruction.data).toBeTruthy()
  })

  it('builds a TRC-20 transfer descriptor', () => {
    const result = expectSuccess(
      [
        'trc20-transfer',
        'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
        'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH',
        '1000000',
        '--fee-limit-sun',
        '50000000',
      ],
      'trc20-transfer'
    )
    expect(result).toMatchObject({
      chain: 'Tron',
      amount: '1000000',
      feeLimitSun: '50000000',
    })
    expect(result.parameter).toHaveLength(128)
  })

  it('builds a TON Jetton signing payload', () => {
    const result = expectSuccess(
      [
        'jetton-transfer',
        'UQCXhTIYi7zucgALWCxYRAHjwJbLDyZVUZVOa-FzD7UA5P5O',
        'EQAtiFQ15MZBgpAGwD1jfJm6maz5otBOPefyw9Wc3MVmMgzp',
        '1000000',
        '5',
        '--valid-until',
        '2000000000',
        '--identity',
        IDENTITY,
      ],
      'jetton-transfer'
    )
    expect(result.signingHashHex).toMatch(/^[0-9a-f]{64}$/)
    expect(result.unsignedBocHex).toBeTruthy()
  })

  it('routes Sui token arguments to the helper before RPC access', () => {
    const result = runPrep([
      'sui-token-transfer',
      '0x2::sui::SUI',
      `0x${'ab'.repeat(32)}`,
      `0x${'cd'.repeat(32)}`,
      '1',
      '--identity',
      IDENTITY,
    ])
    expect(result.status).not.toBe(0)
    expect(JSON.parse(result.stdout).error.message).toMatch(/coinType is native SUI/i)
  })

  it('builds a Polkadot Asset Hub call', () => {
    const result = expectSuccess(
      [
        'polkadot-asset-send',
        '1984',
        '14E5nqKAp3oAJcmzgZhUD2RcptBeUBScxKHgJKU4HPNcKVf3',
        '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
        '1000000',
      ],
      'polkadot-asset-send'
    )
    expect(result).toMatchObject({
      chain: 'Polkadot',
      assetId: 1984,
      amount: '1000000',
      ticker: 'USDT',
    })
    expect(result.callHex).toMatch(/^0x3202/)
  })

  it('builds a Cosmos staking message', () => {
    const result = expectSuccess(
      ['cosmos-staking', 'delegate', OSMO_SENDER, OSMO_VALIDATOR, '5000000', 'uosmo'],
      'cosmos-staking'
    )
    expect(result.typeUrl).toBe('/cosmos.staking.v1beta1.MsgDelegate')
    expect(result.valueBase64).toBeTruthy()
  })

  it('builds a CW-20 transfer message', () => {
    const result = expectSuccess(
      ['cw20-transfer', 'osmo', OSMO_CONTRACT, OSMO_RECIPIENT, '1000000', OSMO_SENDER],
      'cw20-transfer'
    )
    expect(result).toMatchObject({
      contract: OSMO_CONTRACT,
      recipient: OSMO_RECIPIENT,
      sender: OSMO_SENDER,
      amount: '1000000',
    })
    expect(result.msg.type).toBe('wasm/MsgExecuteContract')
  })
})
