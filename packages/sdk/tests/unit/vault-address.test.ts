/**
 * Vault Address Tests
 * Tests Vault's address() method for various chains using the new Vultisig API
 */

import { readFileSync } from 'fs'
import { join } from 'path'

import { Vultisig } from '../../src/index'

describe('Vault Address Tests', () => {
  let vultisig: Vultisig

  beforeAll(async () => {
    vultisig = new Vultisig()

    // Import a test vault to trigger initialization
    const vaultName = join(
      __dirname,
      'vaults',
      'TestFastVault-44fd-share2of2-Password123!.vult'
    )
    const vaultBuffer = readFileSync(vaultName)
    const vaultFile = new File([vaultBuffer], 'TestFastVault.vult')
    ;(vaultFile as any).buffer = vaultBuffer
    await vultisig.addVault(vaultFile, 'Password123!')
  }, 120000)

  beforeEach(async () => {
    // Clear and reimport vault for each test
    await vultisig.clearVaults()

    const vaultName = join(
      __dirname,
      'vaults',
      'TestFastVault-44fd-share2of2-Password123!.vult'
    )
    const vaultBuffer = readFileSync(vaultName)
    const vaultFile = new File([vaultBuffer], 'TestFastVault.vult')
    ;(vaultFile as any).buffer = vaultBuffer
    await vultisig.addVault(vaultFile, 'Password123!')
  })

  afterEach(async () => {
    await vultisig.clearVaults()
  })

  describe('vault.address()', () => {
    test('should derive address for bitcoin', async () => {
      const vault = vultisig.getActiveVault()
      expect(vault).toBeTruthy()

      const btcAddress = await vault!.address('bitcoin')
      expect(btcAddress).toBe('bc1qsef7rshf0jwm53rnkttpry5rpveqcd6dyj6pn9')
    })

    test('should derive addresses for all expected chains', async () => {
      const vault = vultisig.getActiveVault()
      expect(vault).toBeTruthy()

      // Expected addresses for this specific test vault
      const expectedAddresses = {
        bitcoin: 'bc1qsef7rshf0jwm53rnkttpry5rpveqcd6dyj6pn9',
        ethereum: '0x8c4E1C2D3b9F88bBa6162F6Bd8dB05840Ca24F8c',
        thorchain: 'thor1nuwfr59wyn6da6v5ktxsa32v2t6u2q4veg9awu',
        cosmos: 'cosmos1axf2e8w0k73gp7zmfqcx7zssma34haxh7xwlsu',
        solana: 'G5Jm9g1NH1xprPz3ZpnNmF8Wkz2F6YUhkxpf432mRefR',
        cardano: 'addr1v8ktk0y6xkhy7k60wzdwwkc77n7cvlduw2cuew2a0frk6aq8ahycw',
        polkadot: '164frjvvMTVaeZS5No4KfjsVEQFruHY1tZAhXd5WMGQB4yva',
        ripple: 'rpauN4CN6hDdZBwjTbPvtdW6TBVzroFQCm',
        tron: 'TSZh1ddJLcVruiC6kZYojtAVwKawC2jVj5',
        litecoin: 'ltc1qkdau9j2puxrsu0vlwa6q7cysq8ys97w2tk7whc',
        dogecoin: 'DTSParRZGeQSzPK2uTvzFCtsiWfTbwvmUZ',
        bsc: '0x8c4E1C2D3b9F88bBa6162F6Bd8dB05840Ca24F8c',
        avalanche: '0x8c4E1C2D3b9F88bBa6162F6Bd8dB05840Ca24F8c',
        polygon: '0x8c4E1C2D3b9F88bBa6162F6Bd8dB05840Ca24F8c',
        arbitrum: '0x8c4E1C2D3b9F88bBa6162F6Bd8dB05840Ca24F8c',
        optimism: '0x8c4E1C2D3b9F88bBa6162F6Bd8dB05840Ca24F8c',
        base: '0x8c4E1C2D3b9F88bBa6162F6Bd8dB05840Ca24F8c',
        osmosis: 'osmo1axf2e8w0k73gp7zmfqcx7zssma34haxhkaa0xw',
        sui: '0x61102d766fc7e62ff2d1f2094636e4d04dc137ee3bb469a8d027c3f432d715fe',
        mayachain: 'maya1nuwfr59wyn6da6v5ktxsa32v2t6u2q4velm3cv',
        ton: 'UQCeg8c0AuZfbZbYf_WtzgKXnPLUwXkPjZwEKB16VzwSC4Yl',
      }

      // Test each chain address derivation
      for (const [chain, expectedAddress] of Object.entries(
        expectedAddresses
      )) {
        const derivedAddress = await vault!.address(chain)
        expect(derivedAddress).toBe(expectedAddress)
      }
    })
  })
})
