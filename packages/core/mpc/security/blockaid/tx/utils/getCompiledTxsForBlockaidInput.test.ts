import { Buffer } from 'buffer'
import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { buildSignBitcoinFromPsbt } from '@vultisig/core-chain/chains/utxo/tx/buildSignBitcoinFromPsbt'
import { TW, initWasm, type WalletCore } from '@trustwallet/wallet-core'
import { Psbt, networks, payments } from 'bitcoinjs-lib'
import { beforeAll, describe, expect, it } from 'vitest'

import { CoinSchema } from '../../../../types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '../../../../types/vultisig/keysign/v1/keysign_message_pb'
import { getCompiledTxsForBlockaidInput } from './getCompiledTxsForBlockaidInput'

const TEST_PUBKEY = Buffer.from('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 'hex')
const RECIPIENT_ADDRESS = 'bc1q0ht9tyks4vh7p5p904t340cr9nvahy7u3re7zg'

describe('getCompiledTxsForBlockaidInput', () => {
  let walletCore: WalletCore

  beforeAll(async () => {
    walletCore = await initWasm()
  })

  it('compiles Bitcoin SignBitcoin PSBT payloads for Blockaid validation', async () => {
    const p2wpkh = payments.p2wpkh({ pubkey: TEST_PUBKEY, network: networks.bitcoin })
    const psbt = new Psbt({ network: networks.bitcoin })
    psbt.addInput({
      hash: 'aa'.repeat(32),
      index: 0,
      witnessUtxo: { script: Buffer.from(p2wpkh.output!), value: 100000n },
    })
    psbt.addOutput({
      address: RECIPIENT_ADDRESS,
      value: 90000n,
    })

    const signBitcoin = buildSignBitcoinFromPsbt({
      psbt,
      senderAddress: p2wpkh.address!,
    })
    const payload = create(KeysignPayloadSchema, {
      coin: create(CoinSchema, {
        chain: Chain.Bitcoin,
        ticker: 'BTC',
        address: p2wpkh.address!,
        decimals: 8,
        hexPublicKey: TEST_PUBKEY.toString('hex'),
      }),
      toAddress: RECIPIENT_ADDRESS,
      toAmount: '90000',
      signData: {
        case: 'signBitcoin',
        value: signBitcoin,
      },
    })

    const compiledTxs = await getCompiledTxsForBlockaidInput({ payload, walletCore })

    expect(compiledTxs).toHaveLength(1)
    const decoded = TW.Bitcoin.Proto.SigningOutput.decode(compiledTxs[0])
    expect(Buffer.from(decoded.encoded).length).toBeGreaterThan(0)
  })
})
