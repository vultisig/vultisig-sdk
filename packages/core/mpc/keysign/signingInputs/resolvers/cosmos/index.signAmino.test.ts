import { Buffer } from 'buffer'

import { create, fromBinary, toBinary } from '@bufbuild/protobuf'
import { initWasm, TW, type WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import { CosmosSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { CoinSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { SignAminoSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/wasm_execute_contract_payload_pb'
import { beforeAll, describe, expect, it } from 'vitest'

import { getCosmosSigningInputs } from './index'

// An Osmosis-frontend IBC deposit doc, addresses swapped for a test key.
const receiver = 'osmo1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu'
const msgTransferValue = (sender: string) => ({
  source_port: 'transfer',
  source_channel: 'channel-141',
  token: { denom: 'uatom', amount: '330699' },
  sender,
  receiver,
  timeout_height: { revision_height: '74177604', revision_number: '1' },
})

// The canonical amino sign doc the chain rebuilds from the broadcast tx.
const expectedPreimage = (sender: string, timeoutHeight: string | undefined) =>
  '{"account_number":"3393979","chain_id":"cosmoshub-4",' +
  '"fee":{"amount":[{"amount":"5802","denom":"uatom"}],"gas":"193367"},' +
  '"memo":"OsmosisFE","msgs":[{"type":"cosmos-sdk/MsgTransfer","value":{' +
  `"receiver":"${receiver}","sender":"${sender}",` +
  '"source_channel":"channel-141","source_port":"transfer",' +
  '"timeout_height":{"revision_height":"74177604","revision_number":"1"},' +
  '"token":{"amount":"330699","denom":"uatom"}}}],"sequence":"14"' +
  (timeoutHeight === undefined ? '' : `,"timeout_height":"${timeoutHeight}"`) +
  '}'

describe('getCosmosSigningInputs signAmino', () => {
  let walletCore: WalletCore
  let sender: string
  let publicKeyHex: string

  beforeAll(async () => {
    walletCore = await initWasm()
    const publicKey = walletCore.PrivateKey.createWithData(new Uint8Array(32).fill(1)).getPublicKeySecp256k1(true)
    sender = walletCore.AnyAddress.createWithPublicKey(publicKey, walletCore.CoinType.cosmos).description()
    publicKeyHex = Buffer.from(publicKey.data()).toString('hex')
  })

  const preimageFor = async (timeoutHeight: bigint | undefined): Promise<string> => {
    const keysignPayload = create(KeysignPayloadSchema, {
      coin: create(CoinSchema, {
        chain: Chain.Cosmos,
        ticker: 'ATOM',
        address: sender,
        decimals: 6,
        isNativeToken: true,
        hexPublicKey: publicKeyHex,
      }),
      memo: 'OsmosisFE',
      blockchainSpecific: {
        case: 'cosmosSpecific',
        value: create(CosmosSpecificSchema, {
          accountNumber: 3393979n,
          sequence: 14n,
        }),
      },
      signData: {
        case: 'signAmino',
        value: create(SignAminoSchema, {
          fee: { amount: [{ denom: 'uatom', amount: '5802' }], gas: '193367' },
          msgs: [
            {
              type: 'cosmos-sdk/MsgTransfer',
              value: JSON.stringify(msgTransferValue(sender)),
            },
          ],
          timeoutHeight,
        }),
      },
    })

    // A co-signer derives its preimage from the payload as decoded off the wire.
    const joinerPayload = fromBinary(KeysignPayloadSchema, toBinary(KeysignPayloadSchema, keysignPayload))
    const [input] = await getCosmosSigningInputs({
      keysignPayload: joinerPayload,
      walletCore,
    })
    const preSigning = TW.TxCompiler.Proto.PreSigningOutput.decode(
      walletCore.TransactionCompiler.preImageHashes(
        walletCore.CoinType.cosmos,
        TW.Cosmos.Proto.SigningInput.encode(input).finish()
      )
    )
    expect(preSigning.errorMessage).toBe('')
    return new TextDecoder().decode(preSigning.data)
  }

  it("signs the dApp's tx-level timeout_height", async () => {
    expect(await preimageFor(33737015n)).toBe(expectedPreimage(sender, '33737015'))
  })

  it.each([undefined, 0n])('leaves timeout_height out of the sign doc when it is %s', async timeoutHeight => {
    expect(await preimageFor(timeoutHeight)).toBe(expectedPreimage(sender, undefined))
  })
})
