/**
 * Real-WalletCore regression for THORChain swaps from Zcash. THORChain
 * publishes its ZEC inbound vault as a ZIP-320 TEX address (`tex1…`, bech32m
 * over a P2PKH hash). This WalletCore parses TEX natively, so the resolver
 * passes the vault through unchanged. iOS and Android sign the same payload
 * with older WalletCore builds that only parse `t1…`, so they convert the
 * vault first (vultisig-ios#5530, vultisig-android#6032). Both paths must pay
 * the same P2PKH script, or a co-signed swap diverges on its sighash.
 */
import { create } from '@bufbuild/protobuf'
import { initWasm, TW, WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import { UTXOSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { CoinSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { THORChainSwapPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/thorchain_swap_payload_pb'
import { UtxoInfoSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/utxo_info_pb'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { getUtxoSigningInputs } from './utxo'

vi.mock('@vultisig/core-chain/chains/utxo/zcashBranchId', () => ({
  getZcashBranchIdHex: vi.fn(async () => '30f33754'),
}))

// Live THORChain ZEC inbound and its transparent form (vectors shared with iOS and Android).
const texVaultAddress = 'tex1z8e8k9jg5xh28ny8ctek2dwpnc6qd9qd037yju'
const transparentVaultAddress = 't1KWVyTZA6DPBDrHPERjuHSFWmAioomt5mE'
const zcashAddress = 't1PoLLLwEcVhqMBhk53tANtSepnPXAQJkPM'
const memo = '=:ETH.ETH:0x2f7a1d0b9b6c4e6a8f0c3b7d5e1a9c2b4d6f8e0a:0/1/0:vi:50'

const buildThorchainZcashSwapPayload = (vaultAddress: string) => {
  const zec = create(CoinSchema, {
    chain: Chain.Zcash,
    ticker: 'ZEC',
    address: zcashAddress,
    decimals: 8,
    isNativeToken: true,
  })

  return create(KeysignPayloadSchema, {
    coin: zec,
    toAddress: vaultAddress,
    toAmount: '5000000',
    memo,
    blockchainSpecific: {
      case: 'utxoSpecific',
      value: create(UTXOSpecificSchema, {
        byteFee: '100',
        sendMaxAmount: false,
      }),
    },
    utxoInfo: [
      create(UtxoInfoSchema, {
        hash: '00'.repeat(32),
        amount: 20_000_000n,
        index: 0,
      }),
    ],
    swapPayload: {
      case: 'thorchainSwapPayload',
      value: create(THORChainSwapPayloadSchema, {
        fromAddress: zcashAddress,
        fromCoin: zec,
        vaultAddress,
        fromAmount: '5000000',
      }),
    },
  })
}

describe('getUtxoSigningInputs — THORChain swap from Zcash', () => {
  let walletCore: WalletCore

  beforeAll(async () => {
    walletCore = await initWasm()
  })

  const getPreSigningHashes = async (vaultAddress: string): Promise<string[]> => {
    const [signingInput] = await getUtxoSigningInputs({
      keysignPayload: buildThorchainZcashSwapPayload(vaultAddress),
      walletCore,
      publicKey: {} as never,
    })
    const { errorMessage, hashPublicKeys } = TW.Bitcoin.Proto.PreSigningOutput.decode(
      walletCore.TransactionCompiler.preImageHashes(
        walletCore.CoinType.zcash,
        TW.Bitcoin.Proto.SigningInput.encode(signingInput).finish()
      )
    )
    expect(errorMessage).toBe('')

    return hashPublicKeys.map(({ dataHash }) => walletCore.HexCoding.encode(shouldBePresent(dataHash, 'dataHash')))
  }

  it('locks the TEX vault to the same P2PKH script as its transparent form', () => {
    const lockScript = (address: string) =>
      walletCore.HexCoding.encode(
        walletCore.BitcoinScript.lockScriptForAddress(address, walletCore.CoinType.zcash).data()
      )

    expect(lockScript(texVaultAddress)).toBe(lockScript(transparentVaultAddress))
  })

  it('signs a swap to the TEX vault exactly like one to its transparent form', async () => {
    const texHashes = await getPreSigningHashes(texVaultAddress)

    expect(texHashes).toHaveLength(1)
    expect(texHashes).toEqual(await getPreSigningHashes(transparentVaultAddress))
  })
})
