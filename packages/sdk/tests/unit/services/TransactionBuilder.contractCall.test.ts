import { Chain, EvmChain } from '@vultisig/core-chain/Chain'
import { encodeFunctionData, parseAbi } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// EVM chain set for isChainOfKind mock
const evmChainValues = new Set(Object.values(EvmChain))

// Mock core functions - must be before imports
vi.mock('@vultisig/core-chain/publicKey/getPublicKey', () => ({
  getPublicKey: vi.fn(() => ({
    data: vi.fn().mockReturnValue(new Uint8Array(33)),
  })),
}))

vi.mock('@vultisig/core-mpc/keysign/send/build', () => ({
  buildSendKeysignPayload: vi.fn(),
}))

vi.mock('@vultisig/core-mpc/keysign/send/getSendFeeEstimate', () => ({
  getSendFeeEstimate: vi.fn(),
}))

vi.mock('@vultisig/core-chain/utils/isValidAddress', () => ({
  isValidAddress: vi.fn().mockReturnValue(true),
}))

vi.mock('@vultisig/core-chain/publicKey/tw/getTwPublicKeyType', () => ({
  getTwPublicKeyType: vi.fn(),
}))

vi.mock('@vultisig/core-mpc/tx/preSigningHashes', () => ({
  getPreSigningHashes: vi.fn(),
}))

vi.mock('@vultisig/core-mpc/keysign/signingInputs', () => ({
  getEncodedSigningInputs: vi.fn(),
}))

vi.mock('@vultisig/core-mpc/keysign/tw/getKeysignTwPublicKey', () => ({
  getKeysignTwPublicKey: vi.fn(),
}))

vi.mock('@vultisig/core-mpc/keysign/utils/getKeysignChain', () => ({
  getKeysignChain: vi.fn(),
}))

// Mock chainFeeCoin to avoid pulling in deep chain-specific modules
vi.mock('@vultisig/core-chain/coin/chainFeeCoin', () => ({
  chainFeeCoin: {
    Ethereum: { ticker: 'ETH', decimals: 18, logo: 'eth' },
    Polygon: { ticker: 'POL', decimals: 18, logo: 'pol' },
    BSC: { ticker: 'BNB', decimals: 18, logo: 'bnb' },
    Avalanche: { ticker: 'AVAX', decimals: 18, logo: 'avax' },
    Arbitrum: { ticker: 'ETH', decimals: 18, logo: 'eth' },
    Optimism: { ticker: 'ETH', decimals: 18, logo: 'eth' },
    Base: { ticker: 'ETH', decimals: 18, logo: 'eth' },
    Blast: { ticker: 'ETH', decimals: 18, logo: 'eth' },
    CronosChain: { ticker: 'CRO', decimals: 18, logo: 'cro' },
    Zksync: { ticker: 'ETH', decimals: 18, logo: 'eth' },
    Mantle: { ticker: 'MNT', decimals: 18, logo: 'mnt' },
    Hyperliquid: { ticker: 'HYPE', decimals: 18, logo: 'hype' },
    Sei: { ticker: 'SEI', decimals: 18, logo: 'sei' },
  },
}))

// Mock isChainOfKind to avoid importing the full ChainKind module
vi.mock('@vultisig/core-chain/ChainKind', () => ({
  isChainOfKind: vi.fn((chain: string, kind: string) => {
    if (kind === 'evm') return evmChainValues.has(chain as any)
    return false
  }),
  getChainKind: vi.fn(),
}))

import { buildSendKeysignPayload } from '@vultisig/core-mpc/keysign/send/build'
import type { Vault as CoreVault } from '@vultisig/core-mpc/vault/Vault'

import type { WasmProvider } from '../../../src/context/SdkContext'
import { TransactionBuilder } from '../../../src/vault/services/TransactionBuilder'

const ERC20_APPROVE_ABI = parseAbi(['function approve(address spender, uint256 amount) returns (bool)'])
const ERC1155_SET_APPROVAL_ABI = parseAbi(['function setApprovalForAll(address operator, bool approved)'])

describe('TransactionBuilder.prepareContractCallTx', () => {
  let builder: TransactionBuilder
  let mockVaultData: CoreVault
  let mockWasmProvider: WasmProvider

  const SENDER = '0x1234567890abcdef1234567890abcdef12345678'
  const CONTRACT = '0xabcdef1234567890abcdef1234567890abcdef12'
  const SPENDER = '0x0000000000000000000000000000000000000001'

  beforeEach(() => {
    vi.clearAllMocks()

    mockVaultData = {
      name: 'Test Vault',
      publicKeys: {
        ecdsa: 'mock-ecdsa-pubkey',
        eddsa: 'mock-eddsa-pubkey',
      },
      hexChainCode: 'mock-chain-code',
      signers: ['local-party-1'],
      localPartyId: 'local-party-1',
      createdAt: Date.now(),
      libType: 'DKLS',
      isBackedUp: true,
      order: 0,
      keyShares: { ecdsa: '', eddsa: '' },
    }

    mockWasmProvider = {
      getWalletCore: vi.fn().mockResolvedValue({
        PublicKey: {
          createWithData: vi.fn(),
        },
      }),
      initialize: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockReturnValue({ walletCore: true, dkls: true, schnorr: true }),
    } as unknown as WasmProvider

    vi.mocked(buildSendKeysignPayload).mockResolvedValue({} as any)

    builder = new TransactionBuilder(mockVaultData, mockWasmProvider)
  })

  it('should encode ERC-20 approve and delegate to prepareSendTx', async () => {
    const maxUint256 = 2n ** 256n - 1n

    await builder.prepareContractCallTx({
      chain: Chain.Polygon,
      contractAddress: CONTRACT,
      abi: ERC20_APPROVE_ABI,
      functionName: 'approve',
      args: [SPENDER, maxUint256],
      senderAddress: SENDER,
    })

    expect(buildSendKeysignPayload).toHaveBeenCalledOnce()
    const callArgs = vi.mocked(buildSendKeysignPayload).mock.calls[0][0]

    // Should use native fee coin (POL), not a token
    expect(callArgs.coin.chain).toBe(Chain.Polygon)
    expect(callArgs.coin.ticker).toBe('POL')
    expect(callArgs.coin.decimals).toBe(18)
    expect(callArgs.coin.address).toBe(SENDER)
    // Native coin has no contract id
    expect(callArgs.coin.id).toBeUndefined()

    // Contract address is the receiver
    expect(callArgs.receiver).toBe(CONTRACT)

    // Default value is 0
    expect(callArgs.amount).toBe(0n)

    // Memo should be the ABI-encoded calldata
    const expectedCalldata = encodeFunctionData({
      abi: ERC20_APPROVE_ABI,
      functionName: 'approve',
      args: [SPENDER, maxUint256],
    })
    expect(callArgs.memo).toBe(expectedCalldata)
  })

  it('should encode ERC-1155 setApprovalForAll (zero-value call)', async () => {
    const operator = '0xC5d563A36AE78145C45a50134d48A1215220f80a'

    await builder.prepareContractCallTx({
      chain: Chain.Polygon,
      contractAddress: CONTRACT,
      abi: ERC1155_SET_APPROVAL_ABI,
      functionName: 'setApprovalForAll',
      args: [operator, true],
      senderAddress: SENDER,
    })

    expect(buildSendKeysignPayload).toHaveBeenCalledOnce()
    const callArgs = vi.mocked(buildSendKeysignPayload).mock.calls[0][0]

    expect(callArgs.amount).toBe(0n)
    expect(callArgs.receiver).toBe(CONTRACT)

    const expectedCalldata = encodeFunctionData({
      abi: ERC1155_SET_APPROVAL_ABI,
      functionName: 'setApprovalForAll',
      args: [operator, true],
    })
    expect(callArgs.memo).toBe(expectedCalldata)
  })

  it('should pass value for payable function calls', async () => {
    const depositAbi = parseAbi(['function deposit() payable'])
    const oneEth = 1000000000000000000n

    await builder.prepareContractCallTx({
      chain: Chain.Ethereum,
      contractAddress: CONTRACT,
      abi: depositAbi,
      functionName: 'deposit',
      value: oneEth,
      senderAddress: SENDER,
    })

    const callArgs = vi.mocked(buildSendKeysignPayload).mock.calls[0][0]
    expect(callArgs.amount).toBe(oneEth)
    expect(callArgs.coin.ticker).toBe('ETH')
    expect(callArgs.coin.decimals).toBe(18)
  })

  it('should work across all EVM chains', async () => {
    const evmChains = [
      Chain.Ethereum,
      Chain.Polygon,
      Chain.BSC,
      Chain.Avalanche,
      Chain.Arbitrum,
      Chain.Optimism,
      Chain.Base,
      Chain.Blast,
    ]

    for (const chain of evmChains) {
      vi.mocked(buildSendKeysignPayload).mockClear()

      await builder.prepareContractCallTx({
        chain,
        contractAddress: CONTRACT,
        abi: ERC20_APPROVE_ABI,
        functionName: 'approve',
        args: [SPENDER, 100n],
        senderAddress: SENDER,
      })

      expect(buildSendKeysignPayload).toHaveBeenCalledOnce()
      const callArgs = vi.mocked(buildSendKeysignPayload).mock.calls[0][0]
      expect(callArgs.coin.chain).toBe(chain)
    }
  })

  it('should reject non-EVM chains', async () => {
    await expect(
      builder.prepareContractCallTx({
        chain: Chain.Bitcoin,
        contractAddress: CONTRACT,
        abi: ERC20_APPROVE_ABI,
        functionName: 'approve',
        args: [SPENDER, 100n],
        senderAddress: SENDER,
      })
    ).rejects.toThrow('prepareContractCallTx only supports EVM chains')

    await expect(
      builder.prepareContractCallTx({
        chain: Chain.Solana,
        contractAddress: CONTRACT,
        abi: ERC20_APPROVE_ABI,
        functionName: 'approve',
        args: [SPENDER, 100n],
        senderAddress: SENDER,
      })
    ).rejects.toThrow('prepareContractCallTx only supports EVM chains')

    await expect(
      builder.prepareContractCallTx({
        chain: Chain.Cosmos,
        contractAddress: CONTRACT,
        abi: ERC20_APPROVE_ABI,
        functionName: 'approve',
        args: [SPENDER, 100n],
        senderAddress: SENDER,
      })
    ).rejects.toThrow('prepareContractCallTx only supports EVM chains')
  })

  it('should throw on invalid ABI encoding', async () => {
    const badAbi = parseAbi(['function nonExistent(uint256 x)'])

    await expect(
      builder.prepareContractCallTx({
        chain: Chain.Ethereum,
        contractAddress: CONTRACT,
        abi: badAbi,
        functionName: 'doesNotExist',
        args: [100n],
        senderAddress: SENDER,
      })
    ).rejects.toThrow()
  })

  it('should pass feeSettings through to prepareSendTx', async () => {
    const customFee = { gasPrice: '50000000000' } as any

    await builder.prepareContractCallTx({
      chain: Chain.Ethereum,
      contractAddress: CONTRACT,
      abi: ERC20_APPROVE_ABI,
      functionName: 'approve',
      args: [SPENDER, 100n],
      senderAddress: SENDER,
      feeSettings: customFee,
    })

    const callArgs = vi.mocked(buildSendKeysignPayload).mock.calls[0][0]
    expect(callArgs.feeSettings).toEqual(customFee)
  })

  it('should default args to empty array when omitted', async () => {
    const noArgAbi = parseAbi(['function pause()'])

    await builder.prepareContractCallTx({
      chain: Chain.Ethereum,
      contractAddress: CONTRACT,
      abi: noArgAbi,
      functionName: 'pause',
      senderAddress: SENDER,
    })

    const expectedCalldata = encodeFunctionData({
      abi: noArgAbi,
      functionName: 'pause',
    })

    const callArgs = vi.mocked(buildSendKeysignPayload).mock.calls[0][0]
    expect(callArgs.memo).toBe(expectedCalldata)
  })
})
