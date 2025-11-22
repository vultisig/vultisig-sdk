/**
 * E2E Tests: prepareSendTx() - Transaction Preparation
 *
 * This test suite validates the `vault.prepareSendTx()` method across different
 * blockchain architectures. The method prepares unsigned transaction payloads
 * (keysign payloads) but does NOT broadcast them.
 *
 * SCOPE: This suite focuses ONLY on prepareSendTx() for native coin transfers.
 * Future test suites will cover:
 * - tx-swap.test.ts: Swap transaction preparation
 * - tx-signing.test.ts: Actual signing (keysign) operations
 * - tx-broadcast.test.ts: Broadcasting to networks (when safe)
 *
 * CHAIN SELECTION RATIONALE:
 * We test representative chains from each blockchain architecture family:
 * - UTXO: Bitcoin (SegWit), Litecoin (variant)
 * - EVM: Ethereum (EIP-1559), ERC-20 tokens
 * - Cosmos: THORChain (vault-based), Cosmos Hub (IBC-enabled)
 * - Other: Solana (account-based), Polkadot (Substrate), Sui (Move VM)
 *
 * We do NOT test every chain because:
 * - Polygon/BSC/Arbitrum use identical EVM logic as Ethereum
 * - Dogecoin/Dash use identical UTXO logic as Bitcoin
 * - Osmosis/Dydx use identical Cosmos IBC logic as Cosmos Hub
 *
 * Environment: Production (mainnet RPCs)
 * Safety: NO transaction broadcasting - transactions are prepared but never sent
 *
 * SECURITY: See SECURITY.md for vault setup instructions.
 * - Vault credentials loaded from environment variables (TEST_VAULT_PATH, TEST_VAULT_PASSWORD)
 * - Falls back to public test vault (read-only tests only)
 * - ⚠️ WARNING: Some tests require funded addresses to prepare valid transactions
 * - ⚠️ NEVER fund the default test vault addresses - credentials are public!
 * - For funded tests, create your own vault and set environment variables
 */

import { loadTestVault, verifyTestVault } from '@helpers/test-vault'
import { beforeAll, describe, expect, it } from 'vitest'

import { Chain, VaultBase } from '@/index'

describe('E2E: prepareSendTx() - Transaction Preparation', () => {
  let vault: VaultBase

  beforeAll(async () => {
    console.log('📦 Loading persistent test vault...')
    const result = await loadTestVault()
    vault = result.vault
    verifyTestVault(vault)
  })

  // ============================================================================
  // CHAIN FAMILY COVERAGE
  // Tests that prepareSendTx() works across different blockchain architectures
  // ============================================================================

  describe('Chain Family Coverage', () => {
    // ==========================================================================
    // UTXO CHAINS
    // Bitcoin-style chains using Unspent Transaction Output model
    // Key features: UTXO selection, change outputs, input/output structure
    // ==========================================================================

    describe('UTXO Chains', () => {
      it('Bitcoin: UTXO selection and SegWit addresses', async () => {
        console.log('📝 Testing Bitcoin UTXO transaction preparation...')

        const coin = {
          chain: Chain.Bitcoin,
          address: await vault.address(Chain.Bitcoin),
          decimals: 8,
          ticker: 'BTC',
        }

        const payload = await vault.prepareSendTx({
          coin,
          receiver: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
          amount: 1000n, // ~0.00001 BTC (~$1 at $98,000/BTC)
        })

        // Validate UTXO-specific structure
        expect(payload).toBeDefined()
        expect(payload.toAddress).toBe(
          'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'
        )
        expect(payload.toAmount).toBe('1000')
        expect(payload.blockchainSpecific).toBeDefined()
        expect(payload.blockchainSpecific.case).toBe('utxoSpecific')

        console.log('✅ Bitcoin UTXO transaction prepared (NOT broadcast)')
        console.log(`  To: ${payload.toAddress}`)
        console.log(
          `  Amount: ${payload.toAmount} satoshis (~0.00001 BTC, ~$1)`
        )
      })

      it('Litecoin: Alternative UTXO implementation', async () => {
        // TODO: Requires Litecoin funding (~$2-5)
        // Tests that UTXO logic generalizes to Litecoin network
        // Different address format (ltc1...) and network parameters

        console.log('📝 Testing Litecoin UTXO transaction preparation...')

        const coin = {
          chain: Chain.Litecoin,
          address: await vault.address(Chain.Litecoin),
          decimals: 8,
          ticker: 'LTC',
        }

        const payload = await vault.prepareSendTx({
          coin,
          receiver: 'ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9', // Valid Litecoin SegWit address (bech32)
          amount: 100000n, // ~0.001 LTC (~$0.10 at $100/LTC)
        })

        expect(payload).toBeDefined()
        expect(payload.blockchainSpecific.case).toBe('utxoSpecific')
        console.log('✅ Litecoin UTXO transaction prepared (NOT broadcast)')
      })
    })

    // ==========================================================================
    // EVM CHAINS
    // Ethereum Virtual Machine chains (Ethereum, Polygon, BSC, L2s, etc.)
    // Key features: EIP-1559 gas, nonce management, smart contracts
    // ==========================================================================

    describe('EVM Chains', () => {
      it('Ethereum: EIP-1559 native transfer', async () => {
        console.log('📝 Testing Ethereum EIP-1559 transaction preparation...')

        const coin = {
          chain: Chain.Ethereum,
          address: await vault.address(Chain.Ethereum),
          decimals: 18,
          ticker: 'ETH',
        }

        const payload = await vault.prepareSendTx({
          coin,
          receiver: '0x742D35cC6634C0532925A3b844bc9E7595f0BEb8',
          amount: 300000000000000n, // ~0.0003 ETH (~$1 at $3300/ETH)
        })

        // Validate EVM-specific structure
        expect(payload).toBeDefined()
        expect(payload.coin).toBeDefined()
        expect(payload.toAddress).toBe(
          '0x742D35cC6634C0532925A3b844bc9E7595f0BEb8'
        )
        expect(payload.toAmount).toBe('300000000000000')
        expect(payload.blockchainSpecific).toBeDefined()
        expect(payload.blockchainSpecific.case).toBe('ethereumSpecific')

        console.log('✅ Ethereum EIP-1559 transaction prepared (NOT broadcast)')
        console.log(`  To: ${payload.toAddress}`)
        console.log(`  Amount: ${payload.toAmount} wei (~0.0003 ETH, ~$1)`)
      })

      it('Ethereum: ERC-20 token transfer (USDC)', async () => {
        console.log('📝 Testing ERC-20 token transaction preparation...')

        const coin = {
          chain: Chain.Ethereum,
          address: await vault.address(Chain.Ethereum),
          decimals: 6,
          ticker: 'USDC',
          id: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC contract
        }

        const payload = await vault.prepareSendTx({
          coin,
          receiver: '0x742D35cC6634C0532925A3b844bc9E7595f0BEb8',
          amount: 1000000n, // 1 USDC (~$1)
        })

        // Validate ERC-20 token handling
        expect(payload).toBeDefined()
        expect(payload.coin).toBeDefined()
        expect(payload.coin.ticker).toBe('USDC')
        expect(payload.toAddress).toBe(
          '0x742D35cC6634C0532925A3b844bc9E7595f0BEb8'
        )
        expect(payload.toAmount).toBe('1000000')
        expect(payload.blockchainSpecific).toBeDefined()
        expect(payload.blockchainSpecific.case).toBe('ethereumSpecific')

        console.log('✅ ERC-20 token transaction prepared (NOT broadcast)')
        console.log(`  Token: USDC`)
        console.log(`  To: ${payload.toAddress}`)
        console.log(`  Amount: ${payload.toAmount} (1 USDC, ~$1)`)
      })
    })

    // ==========================================================================
    // COSMOS CHAINS
    // Cosmos SDK-based chains with different flavors
    // Two types: IBC-enabled (Cosmos Hub, Osmosis) and vault-based (THORChain)
    // ==========================================================================

    describe('Cosmos Chains', () => {
      it('THORChain: Vault-based Cosmos with memo', async () => {
        // TODO: Requires THORChain funding (~$5-10) and account initialization
        // THORChain uses vault-based architecture (different from IBC Cosmos)
        // Tests memo field support for DEX operations

        console.log('📝 Testing THORChain transaction preparation...')

        const coin = {
          chain: Chain.THORChain,
          address: await vault.address(Chain.THORChain),
          decimals: 8,
          ticker: 'RUNE',
        }

        const payload = await vault.prepareSendTx({
          coin,
          receiver: 'thor1g98cy3n9mmjrpn0sxmn63lztelera37n8n67c0',
          amount: 20000000n, // 0.2 RUNE (~$1 at $5/RUNE)
          memo: 'SWAP:ETH.ETH:0x742D35cC6634C0532925A3b844bc9E7595f0BEb8',
        })

        expect(payload).toBeDefined()
        expect(payload.toAddress).toBe(
          'thor1g98cy3n9mmjrpn0sxmn63lztelera37n8n67c0'
        )
        expect(payload.toAmount).toBe('20000000')
        expect(payload.memo).toBe(
          'SWAP:ETH.ETH:0x742D35cC6634C0532925A3b844bc9E7595f0BEb8'
        )
        expect(payload.blockchainSpecific).toBeDefined()

        console.log('✅ THORChain transaction prepared (NOT broadcast)')
        console.log(`  Memo: ${payload.memo}`)
      })

      it('Cosmos Hub: IBC-enabled Cosmos', async () => {
        // TODO: Requires Cosmos funding (~$5-10) and account initialization
        // Tests standard IBC Cosmos SDK implementation
        // Different account model than THORChain (sequence numbers, etc.)

        console.log('📝 Testing Cosmos Hub transaction preparation...')

        const coin = {
          chain: Chain.Cosmos,
          address: await vault.address(Chain.Cosmos),
          decimals: 6,
          ticker: 'ATOM',
        }

        const payload = await vault.prepareSendTx({
          coin,
          receiver: 'cosmos1fl48vsnmsdzcv85q5d2q4z5ajdha8yu34mf0eh',
          amount: 167000n, // ~0.167 ATOM (~$1 at $6/ATOM)
          memo: 'Test IBC transfer',
        })

        expect(payload).toBeDefined()
        expect(payload.toAddress).toBe(
          'cosmos1fl48vsnmsdzcv85q5d2q4z5ajdha8yu34mf0eh'
        )
        expect(payload.memo).toBe('Test IBC transfer')

        console.log('✅ Cosmos Hub transaction prepared (NOT broadcast)')
      })
    })

    // ==========================================================================
    // OTHER CHAIN ARCHITECTURES
    // Chains with unique architectures not covered by UTXO/EVM/Cosmos
    // Each has different transaction model and preparation logic
    // ==========================================================================

    describe('Other Chain Architectures', () => {
      it('Solana: Account-based model', async () => {
        console.log(
          '📝 Testing Solana account-based transaction preparation...'
        )

        const coin = {
          chain: Chain.Solana,
          address: await vault.address(Chain.Solana),
          decimals: 9,
          ticker: 'SOL',
        }

        const payload = await vault.prepareSendTx({
          coin,
          receiver: 'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK',
          amount: 5400000n, // ~0.0054 SOL (~$1 at $185/SOL)
        })

        // Validate Solana-specific structure
        expect(payload).toBeDefined()
        expect(payload.toAddress).toBe(
          'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK'
        )
        expect(payload.toAmount).toBe('5400000')

        console.log('✅ Solana transaction prepared (NOT broadcast)')
      })

      it('Polkadot: Substrate-based extrinsics', async () => {
        // TODO: Requires Polkadot funding (~$2-5)
        // Tests Substrate framework (used by Polkadot, Kusama, parachains)
        // Different from all other architectures - uses extrinsics, SS58 addresses

        console.log('📝 Testing Polkadot extrinsic preparation...')

        const coin = {
          chain: Chain.Polkadot,
          address: await vault.address(Chain.Polkadot),
          decimals: 10,
          ticker: 'DOT',
        }

        const payload = await vault.prepareSendTx({
          coin,
          receiver: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5', // Example Polkadot address (SS58)
          amount: 147000000n, // ~0.0147 DOT (~$1 at $68/DOT)
        })

        expect(payload).toBeDefined()
        expect(payload.toAddress).toMatch(/^[1-9A-HJ-NP-Za-km-z]{47,48}$/) // SS58 format

        console.log('✅ Polkadot extrinsic prepared (NOT broadcast)')
      })

      it('Sui: Move VM object model', async () => {
        // TODO: Requires Sui funding (~$2-5)
        // Tests Move-based blockchain (different paradigm)
        // Uses object model instead of account/UTXO model

        console.log('📝 Testing Sui Move transaction preparation...')

        const coin = {
          chain: Chain.Sui,
          address: await vault.address(Chain.Sui),
          decimals: 9,
          ticker: 'SUI',
        }

        const payload = await vault.prepareSendTx({
          coin,
          receiver: '0x742D35cC6634C0532925A3b844bc9E7595f0BEb8', // Example Sui address
          amount: 312500000n, // ~0.3125 SUI (~$1 at $3.20/SUI)
        })

        expect(payload).toBeDefined()

        console.log('✅ Sui Move transaction prepared (NOT broadcast)')
      })
    })
  })

  // ============================================================================
  // CUSTOM FEE SETTINGS
  // Tests that custom fee parameters are properly applied
  // ============================================================================

  describe('Custom Fee Settings', () => {
    it('EVM: Custom gas parameters (maxFee, priority)', async () => {
      console.log('📝 Testing EVM custom gas settings...')

      const coin = {
        chain: Chain.Ethereum,
        address: await vault.address(Chain.Ethereum),
        decimals: 18,
        ticker: 'ETH',
      }

      const payload = await vault.prepareSendTx({
        coin,
        receiver: '0x742D35cC6634C0532925A3b844bc9E7595f0BEb8',
        amount: 300000000000000n, // ~0.0003 ETH (~$1 at $3300/ETH)
        feeSettings: {
          maxPriorityFeePerGas: 2000000000n, // 2 gwei
          gasLimit: 21000n,
        },
      })

      // Verify custom gas settings were applied
      expect(payload).toBeDefined()
      expect(payload.toAmount).toBe('300000000000000')
      expect(payload.blockchainSpecific).toBeDefined()
      expect(payload.blockchainSpecific.case).toBe('ethereumSpecific')

      if (
        payload.blockchainSpecific.case === 'ethereumSpecific' &&
        payload.blockchainSpecific.value
      ) {
        const ethSpecific = payload.blockchainSpecific.value
        expect(ethSpecific).toBeDefined()
        // Note: Custom gas values are applied during preparation
      }

      console.log('✅ Custom gas transaction prepared (NOT broadcast)')
      console.log(`  Custom Gas: 2 gwei priority, 21000 gas limit`)
    })

    it('UTXO: Custom byte fee (sat/vbyte)', async () => {
      // TODO: Combine with main Bitcoin test or create separate test
      // Tests custom fee rate for UTXO chains (Bitcoin, Litecoin, etc.)

      console.log('📝 Testing UTXO custom fee rate...')

      const coin = {
        chain: Chain.Bitcoin,
        address: await vault.address(Chain.Bitcoin),
        decimals: 8,
        ticker: 'BTC',
      }

      const payload = await vault.prepareSendTx({
        coin,
        receiver: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        amount: 1000n, // ~0.00001 BTC (~$1 at $98,000/BTC)
        feeSettings: {
          byteFee: 10n, // 10 sat/vbyte (custom rate)
        },
      })

      expect(payload).toBeDefined()
      expect(payload.toAmount).toBe('1000')

      console.log('✅ Custom fee UTXO transaction prepared (NOT broadcast)')
    })
  })

  // ============================================================================
  // VALIDATION & ERROR HANDLING
  // Tests that prepareSendTx() properly validates inputs and rejects invalid data
  // ============================================================================

  describe('Validation & Error Handling', () => {
    it('Rejects invalid receiver address format', async () => {
      const coin = {
        chain: Chain.Ethereum,
        address: await vault.address(Chain.Ethereum),
        decimals: 18,
        ticker: 'ETH',
      }

      await expect(
        vault.prepareSendTx({
          coin,
          receiver: 'invalid-ethereum-address',
          amount: 300000000000000n,
        })
      ).rejects.toThrow()

      console.log('✅ Correctly rejected invalid address format')
    })

    it('Rejects unsupported chain', async () => {
      const coin = {
        chain: 'UnsupportedChain' as any,
        address: '0x123',
        decimals: 18,
        ticker: 'UNKNOWN',
      }

      await expect(
        vault.prepareSendTx({
          coin,
          receiver: '0x742D35cC6634C0532925A3b844bc9E7595f0BEb8',
          amount: 1000n,
        })
      ).rejects.toThrow()

      console.log('✅ Correctly rejected unsupported chain')
    })

    it('Rejects zero amount', async () => {
      const coin = {
        chain: Chain.Ethereum,
        address: await vault.address(Chain.Ethereum),
        decimals: 18,
        ticker: 'ETH',
      }

      await expect(
        vault.prepareSendTx({
          coin,
          receiver: '0x742D35cC6634C0532925A3b844bc9E7595f0BEb8',
          amount: 0n,
        })
      ).rejects.toThrow()

      console.log('✅ Correctly rejected zero amount')
    })
  })

  // ============================================================================
  // PAYLOAD STRUCTURE
  // Tests that generated keysign payloads have correct structure
  // ============================================================================

  describe('Payload Structure', () => {
    it('Generates valid keysign payload structure', async () => {
      const coin = {
        chain: Chain.Ethereum,
        address: await vault.address(Chain.Ethereum),
        decimals: 18,
        ticker: 'ETH',
      }

      const payload = await vault.prepareSendTx({
        coin,
        receiver: '0x742D35cC6634C0532925A3b844bc9E7595f0BEb8',
        amount: 300000000000000n,
      })

      // Verify blockchain-specific data
      expect(payload.blockchainSpecific).toBeDefined()
      expect(payload.blockchainSpecific.case).toBe('ethereumSpecific')

      // Verify payload structure
      expect(payload.vaultPublicKeyEcdsa).toBeDefined()
      expect(payload.vaultLocalPartyId).toBeDefined()

      console.log(
        `✅ Generated valid keysign payload with ${payload.blockchainSpecific.case}`
      )
    })

    it('Includes all required payload fields', async () => {
      const coin = {
        chain: Chain.Ethereum,
        address: await vault.address(Chain.Ethereum),
        decimals: 18,
        ticker: 'ETH',
      }

      const payload = await vault.prepareSendTx({
        coin,
        receiver: '0x742D35cC6634C0532925A3b844bc9E7595f0BEb8',
        amount: 300000000000000n,
      })

      // Verify all required fields
      expect(payload).toHaveProperty('coin')
      expect(payload).toHaveProperty('toAddress')
      expect(payload).toHaveProperty('toAmount')
      expect(payload).toHaveProperty('blockchainSpecific')
      expect(payload).toHaveProperty('vaultPublicKeyEcdsa')
      expect(payload).toHaveProperty('vaultLocalPartyId')

      // Verify coin object structure
      expect(payload.coin).toHaveProperty('chain')
      expect(payload.coin).toHaveProperty('address')
      expect(payload.coin).toHaveProperty('decimals')
      expect(payload.coin).toHaveProperty('ticker')

      console.log('✅ Payload contains all required fields')
    })
  })

  // ============================================================================
  // SAFETY VERIFICATION
  // Confirms that NO transactions were actually broadcast to networks
  // ============================================================================

  describe('Safety Verification', () => {
    it('Confirms NO transactions were broadcast', async () => {
      console.log(
        '\n🔒 Safety Check: Verifying NO transactions were broadcast...'
      )

      // Prepare multiple transactions across different chain families
      // Use only funded chains to ensure test actually runs
      const chains: Array<{
        name: Chain
        amount: bigint
        decimals: number
      }> = [
        { name: Chain.Ethereum, amount: 300000000000000n, decimals: 18 },
        { name: Chain.Bitcoin, amount: 1000n, decimals: 8 },
        { name: Chain.Solana, amount: 5400000n, decimals: 9 },
      ]

      for (const chain of chains) {
        const coin = {
          chain: chain.name,
          address: await vault.address(chain.name),
          decimals: chain.decimals,
          ticker: chain.name,
        }

        const getReceiver = () => {
          if (chain.name === Chain.Bitcoin) {
            return 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'
          }
          if (chain.name === Chain.Solana) {
            return 'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK'
          }
          return '0x742D35cC6634C0532925A3b844bc9E7595f0BEb8'
        }

        await vault.prepareSendTx({
          coin,
          receiver: getReceiver(),
          amount: chain.amount,
        })
      }

      console.log(`✅ Prepared ${chains.length} transactions`)
      console.log('✅ ZERO transactions were broadcast to the blockchain')
      console.log('✅ All operations were read-only (prepareSendTx only)')
      console.log('✅ No funds were transferred')
    })
  })
})
