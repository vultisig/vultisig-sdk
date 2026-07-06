/**
 * Byte-parity regression for per-UTXO Cardano native-token (CNT) planning.
 *
 * MPC keysign only converges when every co-signing device derives the exact
 * same Blake2b pre-image hash from the shared KeysignPayload. iOS maps
 * UtxoInfo.cardanoTokens onto WalletCore TxInput.tokenAmount (amounts as
 * minimal big-endian unsigned bytes); this suite pins the SDK resolver to the
 * same bytes on real WalletCore wasm:
 *
 * - a golden pre-image dataHash for a fixed token-carrying payload, for
 *   cross-verification against the iOS signer on the same fixture;
 * - a divergence regression documenting the failure mechanism this fixes:
 *   the token-blind mapping of the very same payload plans a different body
 *   (change output without a TokenBundle) and therefore a different sighash.
 */
import { Buffer } from 'buffer'

import { create } from '@bufbuild/protobuf'
import { initWasm, TW, type WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import { deriveCardanoAddress } from '@vultisig/core-chain/publicKey/address/cardano'
import { CardanoChainSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { CoinSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { UtxoInfoSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/utxo_info_pb'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { beforeAll, describe, expect, it } from 'vitest'

import { getPreSigningOutput } from '../../preSigningOutput'
import { getCardanoSigningInputs } from './cardano'

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')

const concat = (parts: Uint8Array[]) => {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0

  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }

  return result
}

// Deterministic ed25519Cardano keys, same construction as the compileTx
// golden suite: spending key repeated + constant chain-code bytes.
const cardanoPublicKeyFromEd25519 = (walletCore: WalletCore, keyByte: number, chainCodeByte: number) => {
  const spendingKey = new Uint8Array(
    walletCore.PrivateKey.createWithData(new Uint8Array(32).fill(keyByte)).getPublicKeyEd25519().data()
  )
  const chainCode = new Uint8Array(32).fill(chainCodeByte)

  return walletCore.PublicKey.createWithData(
    concat([spendingKey, spendingKey, chainCode, chainCode]),
    walletCore.PublicKeyType.ed25519Cardano
  )
}

// Real mainnet asset identities (SUNDAE, USDM) in canonical
// (policyId, assetNameHex) order, as the initiator attaches them.
const sundae = {
  policyId: '9a9693a9a37912a5097918f97918d15240c92ab729a0b7c4aa144d77',
  assetNameHex: '53554e444145',
  amount: '4500000',
}
const usdm = {
  policyId: 'c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad',
  assetNameHex: '0014df105553444d',
  amount: '665000',
}

// Golden vector, cross-checkable against the iOS signer
// (CardanoHelper.getPreSignedImageHash) by building the identical payload:
//   sender/change address: derived from key byte 0x01, chain-code byte 0x02
//   recipient address:     derived from key byte 0x02, chain-code byte 0x03
//   toAmount 1_000_000 lovelace, sendMaxAmount false, no memo
//   byteFee 200_000, ttl 500_000
//   UTXO 1: hash 11…11, index 0, 5_000_000 lovelace, tokens [SUNDAE, USDM]
//   UTXO 2: hash 22…22, index 1, 3_000_000 lovelace, no tokens
const SENDER_ADDRESS = 'addr1vyxk54m7j3q6mrkevcunryrwf4p7e68c93cjk8gzxkhlkpsjpczl2'
const RECIPIENT_ADDRESS = 'addr1vyqgk3uyfkfgzt7rp50s4jdkl0ecw7xvh2wmsvf2myreq7gd27kn4'
const EXPECTED_TOKEN_AWARE_PRE_IMAGE_HASH = '839ae494ce1af23729a8e918c2d63febb688f0055450865016721c2a62fba93b'
// What the pre-fix (token-blind) SDK derived from the same payload — pinned to
// document the exact divergence that made iOS↔SDK keysign fail to converge.
const TOKEN_BLIND_PRE_IMAGE_HASH = 'db6bde29ccda113233a4ac6bc668fd14ad114ca013698948cfe0d7aa818b7903'

describe('getCardanoSigningInputs — per-UTXO native tokens', () => {
  let walletCore: WalletCore

  beforeAll(async () => {
    walletCore = await initWasm()
  })

  const buildPayload = ({ withTokens }: { withTokens: boolean }) =>
    create(KeysignPayloadSchema, {
      coin: create(CoinSchema, {
        chain: Chain.Cardano,
        ticker: 'ADA',
        address: SENDER_ADDRESS,
        contractAddress: '',
        decimals: 6,
        isNativeToken: true,
      }),
      toAddress: RECIPIENT_ADDRESS,
      toAmount: '1000000',
      blockchainSpecific: {
        case: 'cardano',
        value: create(CardanoChainSpecificSchema, {
          byteFee: 200_000n,
          sendMaxAmount: false,
          ttl: 500_000n,
        }),
      },
      utxoInfo: [
        create(UtxoInfoSchema, {
          hash: '11'.repeat(32),
          amount: 5_000_000n,
          index: 0,
          cardanoTokens: withTokens ? [sundae, usdm] : [],
        }),
        create(UtxoInfoSchema, {
          hash: '22'.repeat(32),
          amount: 3_000_000n,
          index: 1,
        }),
      ],
    })

  const txInputDataFor = async (payload: ReturnType<typeof buildPayload>) => {
    const [signingInput] = await getCardanoSigningInputs({
      keysignPayload: payload,
      walletCore,
    })

    return TW.Cardano.Proto.SigningInput.encode(signingInput).finish()
  }

  it('uses the fixture addresses the golden vector documents', () => {
    expect(
      deriveCardanoAddress({
        publicKey: cardanoPublicKeyFromEd25519(walletCore, 1, 2),
        walletCore,
      })
    ).toBe(SENDER_ADDRESS)
    expect(
      deriveCardanoAddress({
        publicKey: cardanoPublicKeyFromEd25519(walletCore, 2, 3),
        walletCore,
      })
    ).toBe(RECIPIENT_ADDRESS)
  })

  it('maps utxoInfo.cardanoTokens onto TxInput.tokenAmount byte-identically to iOS', async () => {
    const txInputData = await txInputDataFor(buildPayload({ withTokens: true }))
    const decoded = TW.Cardano.Proto.SigningInput.decode(txInputData)

    expect(decoded.utxos).toHaveLength(2)

    const [tokenUtxo, plainUtxo] = decoded.utxos
    const tokens = (tokenUtxo.tokenAmount ?? []).map(({ policyId, assetNameHex, amount }) => ({
      policyId,
      assetNameHex,
      amount: hex(shouldBePresent(amount)),
    }))

    // Amounts are minimal big-endian unsigned bytes (iOS BigUInt.serialize
    // parity): 4_500_000 = 0x44aa20, 665_000 = 0x0a25a8 (whole-byte padded).
    expect(tokens).toEqual([
      {
        policyId: sundae.policyId,
        assetNameHex: sundae.assetNameHex,
        amount: '44aa20',
      },
      {
        policyId: usdm.policyId,
        assetNameHex: usdm.assetNameHex,
        amount: '0a25a8',
      },
    ])

    // Token-free UTXOs stay without a token_amount entry, matching iOS.
    expect(plainUtxo.tokenAmount ?? []).toHaveLength(0)
  })

  it('pins the golden pre-image hash for the token-carrying fixture', async () => {
    const txInputData = await txInputDataFor(buildPayload({ withTokens: true }))
    const preOutput = getPreSigningOutput({
      walletCore,
      txInputData,
      chain: Chain.Cardano,
    })

    expect(hex(preOutput.dataHash)).toBe(EXPECTED_TOKEN_AWARE_PRE_IMAGE_HASH)
  })

  it('diverges from the token-blind mapping of the same payload (the co-sign failure this fixes)', async () => {
    const tokenAware = getPreSigningOutput({
      walletCore,
      txInputData: await txInputDataFor(buildPayload({ withTokens: true })),
      chain: Chain.Cardano,
    })
    const tokenBlind = getPreSigningOutput({
      walletCore,
      txInputData: await txInputDataFor(buildPayload({ withTokens: false })),
      chain: Chain.Cardano,
    })

    // Token-aware planning re-emits the input tokens in the change output
    // (value conserved); the token-blind body consumes the same UTXOs but
    // carries no trace of the assets, which the node rejects at broadcast
    // (Ogmios 3123 "value not conserved").
    expect(hex(tokenAware.data)).toContain(sundae.policyId)
    expect(hex(tokenAware.data)).toContain(usdm.policyId)
    expect(hex(tokenBlind.data)).not.toContain(sundae.policyId)
    expect(hex(tokenBlind.data)).not.toContain(usdm.policyId)

    // Different body bytes ⇒ different Blake2b sighash ⇒ MPC cannot converge
    // when one device maps tokens and the other does not.
    expect(hex(tokenBlind.dataHash)).toBe(TOKEN_BLIND_PRE_IMAGE_HASH)
    expect(hex(tokenBlind.dataHash)).not.toBe(hex(tokenAware.dataHash))
  })
})
