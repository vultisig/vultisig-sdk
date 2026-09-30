import { Buffer } from 'buffer'
import { create } from '@bufbuild/protobuf'
import { describe, expect, it } from 'vitest'
import { networks, payments, Psbt } from 'bitcoinjs-lib'

import { Chain } from '@vultisig/core-chain/Chain'
import { buildSignBitcoinFromPsbt } from '@vultisig/core-chain/chains/utxo/tx/buildSignBitcoinFromPsbt'

import { CoinSchema } from '../types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '../types/vultisig/keysign/v1/keysign_message_pb'
import { SwapKitSwapPayloadSchema } from '../types/vultisig/keysign/v1/swapkit_swap_payload_pb'
import { getSwapKitSignBitcoin } from './swapkitSignBitcoin'

const TEST_PUBKEY = Buffer.from('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 'hex')
const FOREIGN_PUBKEY = Buffer.from('02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5', 'hex')
const RECIPIENT_ADDRESS = 'bc1q0ht9tyks4vh7p5p904t340cr9nvahy7u3re7zg'

const ours = payments.p2wpkh({ pubkey: TEST_PUBKEY, network: networks.bitcoin })
const foreign = payments.p2wpkh({ pubkey: FOREIGN_PUBKEY, network: networks.bitcoin })

const bip32Derivation = [
  {
    masterFingerprint: Buffer.alloc(4),
    pubkey: TEST_PUBKEY,
    path: "m/84'/0'/0'/0/0",
  },
]

/** The decomposition the guard runs on, before the guard — to show what `isOurs` alone reports. */
const getSwapKitSignBitcoinUnchecked = (psbt: Psbt) => buildSignBitcoinFromPsbt({ psbt, senderAddress: ours.address! })

const toKeysignPayload = (psbt: Psbt) =>
  create(KeysignPayloadSchema, {
    coin: create(CoinSchema, {
      chain: Chain.Bitcoin,
      ticker: 'BTC',
      address: ours.address!,
      decimals: 8,
    }),
    toAddress: RECIPIENT_ADDRESS,
    toAmount: '90000',
    swapPayload: {
      case: 'swapkitSwapPayload',
      value: create(SwapKitSwapPayloadSchema, {
        txType: 'PSBT',
        txPayload: psbt.toBuffer(),
      }),
    },
  })

describe('getSwapKitSignBitcoin', () => {
  it('accepts a PSBT whose every input belongs to this vault', () => {
    const psbt = new Psbt({ network: networks.bitcoin })
    psbt.addInput({
      hash: 'aa'.repeat(32),
      index: 0,
      witnessUtxo: { script: Buffer.from(ours.output!), value: 100000n },
      bip32Derivation,
    })
    psbt.addOutput({ address: RECIPIENT_ADDRESS, value: 90000n })

    const signBitcoin = getSwapKitSignBitcoin(toKeysignPayload(psbt))

    expect(signBitcoin?.inputs.every(input => input.isOurs)).toBe(true)
  })

  // compileSignBitcoinTx gives an input marked not-ours an empty witness and
  // still returns a complete-looking transaction, which this route broadcasts
  // and the network rejects — after the ceremony has already run.
  it('refuses a foreign input that BIP-32 derivation data marks as not ours', () => {
    const psbt = new Psbt({ network: networks.bitcoin })
    psbt.addInput({
      hash: 'aa'.repeat(32),
      index: 0,
      witnessUtxo: { script: Buffer.from(ours.output!), value: 60000n },
      bip32Derivation,
    })
    psbt.addInput({
      hash: 'bb'.repeat(32),
      index: 0,
      witnessUtxo: { script: Buffer.from(foreign.output!), value: 40000n },
    })
    psbt.addOutput({ address: RECIPIENT_ADDRESS, value: 90000n })

    expect(() => getSwapKitSignBitcoin(toKeysignPayload(psbt))).toThrow(/input #1 does not pay to this vault's address/)
  })

  // With no BIP-32 derivation anywhere, buildSignBitcoinFromPsbt falls back to
  // marking every input ours, so `isOurs` alone would let this through and the
  // foreign input would be signed with this vault's key against a script that
  // key does not unlock.
  it('refuses a foreign input in a PSBT that carries no derivation data at all', () => {
    const psbt = new Psbt({ network: networks.bitcoin })
    psbt.addInput({
      hash: 'aa'.repeat(32),
      index: 0,
      witnessUtxo: { script: Buffer.from(ours.output!), value: 60000n },
    })
    psbt.addInput({
      hash: 'bb'.repeat(32),
      index: 0,
      witnessUtxo: { script: Buffer.from(foreign.output!), value: 40000n },
    })
    psbt.addOutput({ address: RECIPIENT_ADDRESS, value: 90000n })

    const signBitcoin = getSwapKitSignBitcoinUnchecked(psbt)
    expect(signBitcoin.inputs.every(input => input.isOurs)).toBe(true)

    expect(() => getSwapKitSignBitcoin(toKeysignPayload(psbt))).toThrow(/input #1 does not pay to this vault's address/)
  })
})
