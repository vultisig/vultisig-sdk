/**
 * Offline integration: real chain-specific/signing-input resolvers, WalletCore
 * preimages and compileTx, decoded with @ton/core. Only RPC state and the clock
 * are fixtures; no MPC ceremony, broadcast or on-chain acceptance is exercised.
 */
import { create } from '@bufbuild/protobuf'
import { Cell, loadMessage } from '@ton/core'
import { initWasm, TW, type WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import { deriveTonAddress } from '@vultisig/core-chain/chains/ton/wallet'
import { compileTx } from '@vultisig/core-mpc/tx/compile/compileTx'
import { getPreSigningHashes } from '@vultisig/core-mpc/tx/preSigningHashes'
import { CoinSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { Buffer } from 'buffer'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { getTonChainSpecific } from '../../../chainSpecific/resolvers/ton'
import { getTonSigningInputs } from './index'

const { accountInfo } = vi.hoisted(() => ({ accountInfo: vi.fn() }))
vi.mock('@vultisig/core-chain/chains/ton/account/getTonAccountInfo', () => ({
  getTonAccountInfo: accountInfo,
}))
vi.mock('@vultisig/core-chain/chains/ton/api', () => ({
  getTonWalletState: async () => 'active',
  getJettonWalletAddress: async () => 'EQCIcjES4cQET0z6nRixZ0MdvTB4u3_8triztLSrIIrDkpgJ',
}))

const now = 1_800_000_000
const recipient = 'UQDmLe6ticcY_uLZsfurdYONshNuCn8IS81KcJ8p6M6ISMcB'
let walletCore: WalletCore
beforeAll(async () => {
  walletCore = await initWasm()
})
afterEach(() => vi.restoreAllMocks())

const scenarios = [
  { transfer: 'native', validUntil: undefined, requestedExpiry: now + 600 },
  { transfer: 'jetton', validUntil: undefined, requestedExpiry: now + 600 },
  { transfer: 'dApp', validUntil: now + 60, requestedExpiry: now + 60 },
] as const

describe.each(['v4r2', 'v5r1'] as const)('%s resolver-to-signed-output expiry', walletVersion => {
  it('rejects an expired dApp deadline even for seqno 0', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(now * 1000)
    accountInfo.mockResolvedValue({ account_state: { seqno: 0 } })
    const keysignPayload = create(KeysignPayloadSchema, {
      coin: create(CoinSchema, { chain: Chain.Ton, address: recipient, ticker: 'TON', isNativeToken: true }),
      toAddress: recipient,
      toAmount: '1',
    })
    await expect(getTonChainSpecific({ keysignPayload, walletCore, validUntil: now })).rejects.toThrow(
      `TON request deadline (valid_until ${now}) has already passed`
    )
  })

  describe.each([0, 7])('seqno %i', seqno => {
    it.each(scenarios)('$transfer: requested deadline versus compiled expiry', async scenario => {
      vi.spyOn(Date, 'now').mockReturnValue(now * 1000)
      accountInfo.mockResolvedValue({ account_state: { seqno } })
      const privateKey = walletCore.PrivateKey.createWithData(new Uint8Array(32).fill(0x11))
      const publicKey = privateKey.getPublicKeyEd25519()
      try {
        const keysignPayload = create(KeysignPayloadSchema, {
          coin: create(CoinSchema, {
            chain: Chain.Ton,
            ticker: scenario.transfer === 'jetton' ? 'USDT' : 'TON',
            contractAddress: scenario.transfer === 'jetton' ? recipient : '',
            isNativeToken: scenario.transfer !== 'jetton',
            decimals: 9,
            address: deriveTonAddress({ publicKey, walletCore, version: walletVersion }),
            hexPublicKey: Buffer.from(publicKey.data()).toString('hex'),
          }),
          toAddress: recipient,
          toAmount: '1000000',
          ...(scenario.transfer === 'dApp'
            ? {
                signData: {
                  case: 'signTon' as const,
                  value: { tonMessages: [{ to: recipient, amount: '1000000' }] },
                },
              }
            : {}),
        })
        const specific = await getTonChainSpecific({
          keysignPayload,
          walletCore,
          validUntil: scenario.validUntil,
        })
        expect(specific.expireAt).toBe(BigInt(scenario.requestedExpiry))
        keysignPayload.blockchainSpecific = { case: 'tonSpecific', value: specific }
        const [input] = await getTonSigningInputs({ keysignPayload, walletCore })
        expect(input.expireAt).toBe(scenario.requestedExpiry)
        expect(input.sequenceNumber).toBe(seqno)
        expect(input.walletVersion).toBe(
          walletVersion === 'v4r2'
            ? TW.TheOpenNetwork.Proto.WalletVersion.WALLET_V4_R2
            : TW.TheOpenNetwork.Proto.WalletVersion.WALLET_V5_R1
        )
        const txInputData = TW.TheOpenNetwork.Proto.SigningInput.encode(input).finish()
        const hashes = getPreSigningHashes({ walletCore, chain: Chain.Ton, txInputData })
        expect(hashes).toHaveLength(1)
        const hash = hashes[0]
        const hashHex = Buffer.from(hash).toString('hex')
        const signature = Buffer.from(privateKey.sign(hash, walletCore.Curve.ed25519)).toString('hex')
        const output = TW.TheOpenNetwork.Proto.SigningOutput.decode(
          compileTx({
            walletCore,
            chain: Chain.Ton,
            txInputData,
            publicKey,
            signatures: {
              [hashHex]: { msg: hashHex, r: signature.slice(0, 64), s: signature.slice(64), der_signature: '' },
            },
          })
        )
        expect(output.error).toBe(0)
        const reference = TW.TheOpenNetwork.Proto.SigningOutput.decode(
          walletCore.AnySigner.sign(
            TW.TheOpenNetwork.Proto.SigningInput.encode({ ...input, privateKey: privateKey.data() }).finish(),
            walletCore.CoinType.ton
          )
        )
        expect(reference.error).toBe(0)
        expect(output.encoded).toBe(reference.encoded)
        const message = loadMessage(Cell.fromBase64(output.encoded).beginParse())
        expect(message.info.type).toBe('external-in')
        expect(!!message.init).toBe(seqno === 0)
        const body = message.body.beginParse()
        if (walletVersion === 'v4r2') body.skip(512)
        else expect(body.loadUint(32)).toBe(0x7369676e)
        body.skip(32) // wallet ID
        expect(body.loadUint(32)).toBe(seqno === 0 ? 0xffffffff : scenario.requestedExpiry)
        expect(body.loadUint(32)).toBe(seqno)
      } finally {
        publicKey.delete()
        privateKey.delete()
      }
    })
  })
})
