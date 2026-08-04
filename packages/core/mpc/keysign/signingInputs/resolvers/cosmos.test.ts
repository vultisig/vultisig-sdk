import { Buffer } from 'buffer'

import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { initWasm, type WalletCore } from '@trustwallet/wallet-core'
import {
  CosmosSpecificSchema,
  THORChainSpecificSchema,
  TransactionType,
} from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { CoinSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { beforeAll, describe, expect, it } from 'vitest'

import { getCosmosSigningInputs } from './cosmos'

describe('getCosmosSigningInputs gas limit', () => {
  let walletCore: WalletCore
  let sender: string
  let recipient: string
  let thorSender: string
  let thorRecipient: string
  let publicKeyHex: string

  beforeAll(async () => {
    walletCore = await initWasm()

    const privateKey = walletCore.PrivateKey.createWithData(new Uint8Array(32).fill(1))
    const recipientPrivateKey = walletCore.PrivateKey.createWithData(new Uint8Array(32).fill(2))
    const publicKey = privateKey.getPublicKeySecp256k1(false)
    const recipientPublicKey = recipientPrivateKey.getPublicKeySecp256k1(false)

    sender = walletCore.AnyAddress.createWithPublicKey(publicKey, walletCore.CoinType.cosmos).description()
    recipient = walletCore.AnyAddress.createWithPublicKey(recipientPublicKey, walletCore.CoinType.cosmos).description()
    thorSender = walletCore.AnyAddress.createWithPublicKey(publicKey, walletCore.CoinType.thorchain).description()
    thorRecipient = walletCore.AnyAddress.createWithPublicKey(
      recipientPublicKey,
      walletCore.CoinType.thorchain
    ).description()
    publicKeyHex = Buffer.from(publicKey.data()).toString('hex')
  })

  const buildPayload = ({ gasLimit, sequence = 3n }: { gasLimit?: bigint; sequence?: bigint }) =>
    create(KeysignPayloadSchema, {
      coin: create(CoinSchema, {
        chain: Chain.Cosmos,
        ticker: 'ATOM',
        address: sender,
        contractAddress: '',
        decimals: 6,
        isNativeToken: true,
        hexPublicKey: publicKeyHex,
      }),
      toAddress: recipient,
      toAmount: '12345',
      memo: 'gas limit regression',
      blockchainSpecific: {
        case: 'cosmosSpecific',
        value: create(CosmosSpecificSchema, {
          accountNumber: 7n,
          sequence,
          gas: 2500n,
          gasLimit,
          transactionType: TransactionType.UNSPECIFIED,
        }),
      },
    })

  const feeFor = async (gasLimit?: bigint) => {
    const [input] = await getCosmosSigningInputs({
      keysignPayload: buildPayload({ gasLimit }),
      walletCore,
    })

    return {
      amount: input.fee?.amounts?.[0]?.amount,
      gas: input.fee?.gas.toString(),
    }
  }

  it('preserves a uint64 sequence above the JavaScript safe-integer limit in WalletCore input', async () => {
    const sequence = 9_007_199_254_740_993n
    const [input] = await getCosmosSigningInputs({
      keysignPayload: buildPayload({ sequence }),
      walletCore,
    })

    expect(input.sequence.toString()).toBe(sequence.toString())
  })

  it('honors a positive relayed CosmosSpecific gas limit without touching the fee amount', async () => {
    // `gas` (proto field 3) is the fee AMOUNT and is signed verbatim; field 7
    // moves the gas LIMIT only. Re-deriving the amount here is what diverged
    // the SignDoc from iOS / Android.
    await expect(feeFor(345_678n)).resolves.toEqual({
      amount: '2500',
      gas: '345678',
    })
  })

  it('falls back to the static per-chain gas limit when the relayed value is missing or zero', async () => {
    await expect(feeFor()).resolves.toEqual({
      amount: '2500',
      gas: '200000',
    })
    await expect(feeFor(0n)).resolves.toEqual({
      amount: '2500',
      gas: '200000',
    })
  })

  // Regression: a TerraClassic LUNC send initiated by the extension with a
  // simulated gas limit of 321_979 was signed by this resolver with a rescaled
  // fee of 21_465_267 uluna, while the iOS co-signer signed the payload's
  // 20_000_000 verbatim. Two SignDocs, two pre-sign hashes, keysign never
  // completed. Pin the mobile-compatible bytes.
  it('signs a TerraClassic fee amount verbatim alongside a widened relayed gas limit', async () => {
    const terraClassicSender = walletCore.AnyAddress.createWithPublicKey(
      walletCore.PrivateKey.createWithData(new Uint8Array(32).fill(1)).getPublicKeySecp256k1(true),
      walletCore.CoinType.terra
    ).description()

    const [input] = await getCosmosSigningInputs({
      keysignPayload: create(KeysignPayloadSchema, {
        coin: create(CoinSchema, {
          chain: Chain.TerraClassic,
          ticker: 'LUNC',
          address: terraClassicSender,
          contractAddress: '',
          decimals: 6,
          isNativeToken: true,
          hexPublicKey: publicKeyHex,
        }),
        toAddress: terraClassicSender,
        toAmount: '300000000',
        blockchainSpecific: {
          case: 'cosmosSpecific',
          value: create(CosmosSpecificSchema, {
            accountNumber: 7n,
            sequence: 3n,
            gas: 20_000_000n,
            gasLimit: 321_979n,
            transactionType: TransactionType.UNSPECIFIED,
          }),
        },
      }),
      walletCore,
    })

    expect(input.fee?.amounts?.[0]?.amount).toBe('20000000')
    expect(input.fee?.gas.toString()).toBe('321979')
  })

  it('signs a TerraClassic USTC fee as one uusd coin, matching mobile signers', async () => {
    const terraClassicSender = walletCore.AnyAddress.createWithPublicKey(
      walletCore.PrivateKey.createWithData(new Uint8Array(32).fill(1)).getPublicKeySecp256k1(true),
      walletCore.CoinType.terra
    ).description()

    const [input] = await getCosmosSigningInputs({
      keysignPayload: create(KeysignPayloadSchema, {
        coin: create(CoinSchema, {
          chain: Chain.TerraClassic,
          ticker: 'USTC',
          address: terraClassicSender,
          contractAddress: 'uusd',
          decimals: 6,
          isNativeToken: false,
          hexPublicKey: publicKeyHex,
        }),
        toAddress: terraClassicSender,
        toAmount: '200000000',
        blockchainSpecific: {
          case: 'cosmosSpecific',
          value: create(CosmosSpecificSchema, {
            accountNumber: 7n,
            sequence: 3n,
            gas: 1_225_000n,
            transactionType: TransactionType.UNSPECIFIED,
          }),
        },
      }),
      walletCore,
    })

    expect(input.fee?.amounts).toHaveLength(1)
    expect(input.fee?.amounts?.[0]).toMatchObject({ denom: 'uusd', amount: '1225000' })
    expect(input.fee?.gas.toString()).toBe('300000')
  })

  it('keeps vault-based Cosmos chains on their static gas limit', async () => {
    const [input] = await getCosmosSigningInputs({
      keysignPayload: create(KeysignPayloadSchema, {
        coin: create(CoinSchema, {
          chain: Chain.THORChain,
          ticker: 'RUNE',
          address: thorSender,
          contractAddress: '',
          decimals: 8,
          isNativeToken: true,
          hexPublicKey: publicKeyHex,
        }),
        toAddress: thorRecipient,
        toAmount: '12345',
        memo: 'vault based gas regression',
        blockchainSpecific: {
          case: 'thorchainSpecific',
          value: create(THORChainSpecificSchema, {
            accountNumber: 7n,
            sequence: 3n,
            fee: 2_000_000n,
            isDeposit: false,
            transactionType: TransactionType.UNSPECIFIED,
          }),
        },
      }),
      walletCore,
    })

    expect(input.fee?.gas.toString()).toBe('20000000')
  })

  it('encodes secured withdrawals with the L1 asset from the auxiliary payload', async () => {
    // Reference: https://dev.thorchain.org/concepts/secured-assets.html#withdrawing-secured-assets
    const [input] = await getCosmosSigningInputs({
      keysignPayload: create(KeysignPayloadSchema, {
        coin: create(CoinSchema, {
          chain: Chain.THORChain,
          ticker: 'RUNE',
          address: thorSender,
          decimals: 8,
          isNativeToken: true,
          hexPublicKey: publicKeyHex,
        }),
        toAddress: '',
        toAmount: '10000000',
        memo: 'SECURE-:bc1qp8278yutn09r2wu3jrc8xg2a7hgdgwv2gvsdyw',
        blockchainSpecific: {
          case: 'thorchainSpecific',
          value: create(THORChainSpecificSchema, {
            accountNumber: 7n,
            sequence: 3n,
            fee: 2_000_000n,
            isDeposit: true,
            transactionType: TransactionType.UNSPECIFIED,
          }),
        },
        swapPayload: {
          case: 'thorchainSwapPayload',
          value: {
            fromCoin: {
              chain: Chain.Bitcoin,
              ticker: 'BTC',
              contractAddress: '',
              decimals: 8,
            },
            fromAmount: '10000000',
            vaultAddress: '',
            routerAddress: '',
            expirationTime: 0n,
          },
        },
      }),
      walletCore,
    })

    const deposit = input.messages[0]?.thorchainDepositMessage
    const depositCoin = deposit?.coins?.[0]
    expect(input.memo).toBe('')
    expect(deposit).toBeDefined()
    expect(deposit?.memo).toBe('SECURE-:bc1qp8278yutn09r2wu3jrc8xg2a7hgdgwv2gvsdyw')
    expect(depositCoin?.asset).toMatchObject({
      chain: 'BTC',
      symbol: 'BTC',
      ticker: 'BTC',
      secured: true,
    })
    expect(depositCoin?.amount).toBe('10000000')
    expect(depositCoin?.decimals.toString()).toBe('0')
  })

  it('keeps standard liquidity withdrawals on the native THOR asset path', async () => {
    const memo = '-:BTC.BTC:10000'
    const [input] = await getCosmosSigningInputs({
      keysignPayload: create(KeysignPayloadSchema, {
        coin: create(CoinSchema, {
          chain: Chain.THORChain,
          ticker: 'RUNE',
          address: thorSender,
          decimals: 8,
          isNativeToken: true,
          hexPublicKey: publicKeyHex,
        }),
        toAddress: '',
        toAmount: '1',
        memo,
        blockchainSpecific: {
          case: 'thorchainSpecific',
          value: create(THORChainSpecificSchema, {
            accountNumber: 7n,
            sequence: 3n,
            fee: 2_000_000n,
            isDeposit: true,
            transactionType: TransactionType.UNSPECIFIED,
          }),
        },
      }),
      walletCore,
    })

    const deposit = input.messages[0]?.thorchainDepositMessage
    const depositCoin = deposit?.coins?.[0]
    expect(input.memo).toBe(memo)
    expect(depositCoin?.asset).toMatchObject({
      chain: 'THOR',
      symbol: 'RUNE',
      ticker: 'RUNE',
      secured: false,
    })
    expect(depositCoin?.decimals.toString()).toBe('8')
  })

  it('encodes a secured-asset swap deposit with the L1 secured asset (native)', async () => {
    const memo = `=:ETH-USDC:${thorSender}`
    const [input] = await getCosmosSigningInputs({
      keysignPayload: create(KeysignPayloadSchema, {
        coin: create(CoinSchema, {
          chain: Chain.THORChain,
          ticker: 'RUNE',
          address: thorSender,
          decimals: 8,
          isNativeToken: true,
          hexPublicKey: publicKeyHex,
        }),
        toAddress: '',
        toAmount: '200000000',
        memo,
        blockchainSpecific: {
          case: 'thorchainSpecific',
          value: create(THORChainSpecificSchema, {
            accountNumber: 7n,
            sequence: 3n,
            fee: 2_000_000n,
            isDeposit: true,
            transactionType: TransactionType.UNSPECIFIED,
          }),
        },
        swapPayload: {
          case: 'thorchainSwapPayload',
          value: {
            fromCoin: {
              chain: Chain.THORChain,
              ticker: 'XRP',
              contractAddress: 'xrp-xrp',
              decimals: 8,
            },
            fromAmount: '200000000',
            vaultAddress: '',
            routerAddress: '',
            expirationTime: 0n,
          },
        },
      }),
      walletCore,
    })

    const depositCoin = input.messages[0]?.thorchainDepositMessage?.coins?.[0]
    expect(depositCoin?.asset).toMatchObject({
      chain: 'XRP',
      symbol: 'XRP',
      ticker: 'XRP',
      secured: true,
    })
    expect(depositCoin?.amount).toBe('200000000')
    expect(depositCoin?.decimals.toString()).toBe('8')
  })

  it('encodes a secured-asset swap deposit with the contract symbol (token)', async () => {
    const [input] = await getCosmosSigningInputs({
      keysignPayload: create(KeysignPayloadSchema, {
        coin: create(CoinSchema, {
          chain: Chain.THORChain,
          ticker: 'RUNE',
          address: thorSender,
          decimals: 8,
          isNativeToken: true,
          hexPublicKey: publicKeyHex,
        }),
        toAddress: '',
        toAmount: '41391997',
        memo: `=:XRP-XRP:${thorSender}`,
        blockchainSpecific: {
          case: 'thorchainSpecific',
          value: create(THORChainSpecificSchema, {
            accountNumber: 7n,
            sequence: 3n,
            fee: 2_000_000n,
            isDeposit: true,
            transactionType: TransactionType.UNSPECIFIED,
          }),
        },
        swapPayload: {
          case: 'thorchainSwapPayload',
          value: {
            fromCoin: {
              chain: Chain.THORChain,
              ticker: 'USDC',
              contractAddress: 'eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
              decimals: 8,
            },
            fromAmount: '41391997',
            vaultAddress: '',
            routerAddress: '',
            expirationTime: 0n,
          },
        },
      }),
      walletCore,
    })

    const depositCoin = input.messages[0]?.thorchainDepositMessage?.coins?.[0]
    expect(depositCoin?.asset).toMatchObject({
      chain: 'ETH',
      symbol: 'USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
      ticker: 'USDC',
      secured: true,
    })
    expect(depositCoin?.decimals.toString()).toBe('8')
  })

  // vultisig/vultisig-windows#4464: a THORChain-native token carries its bank
  // denom in `contractAddress`, which must NOT be appended to the deposit
  // symbol. iOS (`thorchain.swift` getSwapPreSignedInputData) and Android
  // (`ThorchainSwapHelper`) both encode the bare ticker; emitting `TCY-tcy`
  // moved the pre-image hash and 404'd every mixed-platform co-sign.
  //
  // Limited to all-uppercase tickers on purpose: iOS uppercases the deposit
  // symbol/ticker and Android does not, so a mixed-case ticker (`bRUNE`) is a
  // separate, still-unadjudicated iOS<->Android divergence. Pinning one side
  // here would fossilize an unverified choice.
  it.each([
    { label: 'TCY', ticker: 'TCY', contractAddress: 'tcy' },
    { label: 'RUJI', ticker: 'RUJI', contractAddress: 'x/ruji' },
  ])('encodes an intra-THORChain swap of $label on the bare ticker', async ({ ticker, contractAddress }) => {
    const [input] = await getCosmosSigningInputs({
      keysignPayload: create(KeysignPayloadSchema, {
        coin: create(CoinSchema, {
          chain: Chain.THORChain,
          ticker,
          address: thorSender,
          contractAddress,
          decimals: 8,
          isNativeToken: false,
          hexPublicKey: publicKeyHex,
        }),
        toAddress: '',
        toAmount: '100000000',
        memo: `=:THOR.RUNE:${thorSender}`,
        blockchainSpecific: {
          case: 'thorchainSpecific',
          value: create(THORChainSpecificSchema, {
            accountNumber: 7n,
            sequence: 3n,
            fee: 2_000_000n,
            isDeposit: false,
            transactionType: TransactionType.UNSPECIFIED,
          }),
        },
        swapPayload: {
          case: 'thorchainSwapPayload',
          value: {
            fromAddress: thorSender,
            fromCoin: {
              chain: Chain.THORChain,
              ticker,
              address: thorSender,
              contractAddress,
              decimals: 8,
              isNativeToken: false,
            },
            toCoin: {
              chain: Chain.THORChain,
              ticker: 'RUNE',
              address: thorSender,
              contractAddress: '',
              decimals: 8,
              isNativeToken: true,
            },
            fromAmount: '100000000',
            vaultAddress: '',
            routerAddress: '',
            expirationTime: 0n,
          },
        },
      }),
      walletCore,
    })

    const depositCoin = input.messages[0]?.thorchainDepositMessage?.coins?.[0]
    expect(depositCoin?.asset).toMatchObject({
      chain: 'THOR',
      symbol: ticker,
      ticker,
      synth: false,
      secured: false,
    })
    expect(depositCoin?.amount).toBe('100000000')
    expect(depositCoin?.decimals.toString()).toBe('8')
  })

  // The other side of the same gate: on a secured-asset withdrawal the
  // auxiliary coin IS an L1 token, and its contract address belongs in the
  // symbol (`ETH.USDC-0XA0B8…`). Pins the branch #4464's fix narrowed to.
  it('keeps the contract suffix on a secured withdrawal of an L1 token', async () => {
    const [input] = await getCosmosSigningInputs({
      keysignPayload: create(KeysignPayloadSchema, {
        coin: create(CoinSchema, {
          chain: Chain.THORChain,
          ticker: 'RUNE',
          address: thorSender,
          decimals: 8,
          isNativeToken: true,
          hexPublicKey: publicKeyHex,
        }),
        toAddress: '',
        toAmount: '10000000',
        memo: 'SECURE-:0x2e8f4c9b1a7d3e6f0b5c8a1d4e7f2a9c6b3d0e8f',
        blockchainSpecific: {
          case: 'thorchainSpecific',
          value: create(THORChainSpecificSchema, {
            accountNumber: 7n,
            sequence: 3n,
            fee: 2_000_000n,
            isDeposit: true,
            transactionType: TransactionType.UNSPECIFIED,
          }),
        },
        swapPayload: {
          case: 'thorchainSwapPayload',
          value: {
            fromCoin: {
              chain: Chain.Ethereum,
              ticker: 'USDC',
              contractAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
              decimals: 8,
            },
            fromAmount: '10000000',
            vaultAddress: '',
            routerAddress: '',
            expirationTime: 0n,
          },
        },
      }),
      walletCore,
    })

    const depositCoin = input.messages[0]?.thorchainDepositMessage?.coins?.[0]
    expect(depositCoin?.asset).toMatchObject({
      chain: 'ETH',
      symbol: 'USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
      ticker: 'USDC',
      secured: true,
    })
  })

  it.each(['bogus-usdc', '-usdc', '__proto__-usdc', 'constructor-usdc'])(
    'rejects a secured-asset swap deposit with a non-canonical chain prefix (%s)',
    contractAddress => {
      const resolve = () =>
        getCosmosSigningInputs({
          keysignPayload: create(KeysignPayloadSchema, {
            coin: create(CoinSchema, {
              chain: Chain.THORChain,
              ticker: 'RUNE',
              address: thorSender,
              decimals: 8,
              isNativeToken: true,
              hexPublicKey: publicKeyHex,
            }),
            toAddress: '',
            toAmount: '41391997',
            memo: `=:XRP-XRP:${thorSender}`,
            blockchainSpecific: {
              case: 'thorchainSpecific',
              value: create(THORChainSpecificSchema, {
                accountNumber: 7n,
                sequence: 3n,
                fee: 2_000_000n,
                isDeposit: true,
                transactionType: TransactionType.UNSPECIFIED,
              }),
            },
            swapPayload: {
              case: 'thorchainSwapPayload',
              value: {
                fromCoin: {
                  chain: Chain.THORChain,
                  ticker: 'USDC',
                  contractAddress,
                  decimals: 8,
                },
                fromAmount: '41391997',
                vaultAddress: '',
                routerAddress: '',
                expirationTime: 0n,
              },
            },
          }),
          walletCore,
        })

      expect(resolve).toThrow('Unsupported secured asset chain prefix')
    }
  )
})
