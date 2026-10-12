import { Buffer } from 'buffer'

import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { initWasm, TW, type WalletCore } from '@trustwallet/wallet-core'
import {
  CosmosSpecificSchema,
  TransactionType,
} from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { CoinSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { VoteOption } from 'cosmjs-types/cosmos/gov/v1beta1/gov'
import { MsgVote } from 'cosmjs-types/cosmos/gov/v1beta1/tx'
import { SignDoc, TxBody } from 'cosmjs-types/cosmos/tx/v1beta1/tx'
import { beforeAll, describe, expect, it } from 'vitest'

import { getCosmosSigningInputs } from './index'

describe('getCosmosSigningInputs dYdX governance vote', () => {
  let walletCore: WalletCore
  let voter: string
  let publicKeyHex: string

  beforeAll(async () => {
    walletCore = await initWasm()

    const privateKey = walletCore.PrivateKey.createWithData(new Uint8Array(32).fill(1))
    const publicKey = privateKey.getPublicKeySecp256k1(true)

    voter = walletCore.AnyAddress.createWithPublicKey(publicKey, walletCore.CoinType.dydx).description()
    publicKeyHex = Buffer.from(publicKey.data()).toString('hex')
  })

  const buildPayload = ({ chain = Chain.Dydx, memo }: { chain?: Chain; memo: string }) =>
    create(KeysignPayloadSchema, {
      coin: create(CoinSchema, {
        chain,
        ticker: 'DYDX',
        address: voter,
        contractAddress: '',
        decimals: 18,
        isNativeToken: true,
        hexPublicKey: publicKeyHex,
      }),
      toAddress: '',
      toAmount: '0',
      memo,
      blockchainSpecific: {
        case: 'cosmosSpecific',
        value: create(CosmosSpecificSchema, {
          accountNumber: 7n,
          sequence: 3n,
          gas: 2500000000000000n,
          transactionType: TransactionType.VOTE,
        }),
      },
    })

  // Decodes the SignDoc WalletCore would hash, so the assertion is on the bytes
  // that get signed rather than on the intermediate SigningInput.
  const getSignedBody = async (memo: string) => {
    const [input] = await getCosmosSigningInputs({ keysignPayload: buildPayload({ memo }), walletCore })
    const preSigningOutput = TW.TxCompiler.Proto.PreSigningOutput.decode(
      walletCore.TransactionCompiler.preImageHashes(
        walletCore.CoinType.dydx,
        TW.Cosmos.Proto.SigningInput.encode(input).finish()
      )
    )
    expect(preSigningOutput.errorMessage).toBe('')

    return TxBody.decode(SignDoc.decode(preSigningOutput.data).bodyBytes)
  }

  it.each([
    ['Yes', VoteOption.VOTE_OPTION_YES],
    ['Abstain', VoteOption.VOTE_OPTION_ABSTAIN],
    ['No', VoteOption.VOTE_OPTION_NO],
    ['No with Veto', VoteOption.VOTE_OPTION_NO_WITH_VETO],
  ])('signs a MsgVote for "%s" with no tx memo', async (token, option) => {
    const body = await getSignedBody(`DYDX_VOTE:${token}:42`)

    expect(body.memo).toBe('')
    expect(body.messages).toHaveLength(1)
    expect(body.messages[0].typeUrl).toBe('/cosmos.gov.v1beta1.MsgVote')

    const vote = MsgVote.decode(body.messages[0].value)
    expect(vote.proposalId).toBe(42n)
    expect(vote.voter).toBe(voter)
    expect(vote.option).toBe(option)
  })

  it('refuses a malformed vote memo instead of signing a MsgSend', () => {
    expect(() => getCosmosSigningInputs({ keysignPayload: buildPayload({ memo: 'VOTE' }), walletCore })).toThrow(
      /Invalid dYdX vote memo/
    )
  })

  it('refuses VOTE on an ibc-enabled chain other than dYdX', () => {
    expect(() =>
      getCosmosSigningInputs({
        keysignPayload: buildPayload({ chain: Chain.Cosmos, memo: 'DYDX_VOTE:Yes:42' }),
        walletCore,
      })
    ).toThrow(/VOTE is only supported on dYdX/)
  })
})
