import { Buffer } from 'buffer'

import { initWasm, TW, type WalletCore } from '@trustwallet/wallet-core'
import { beforeAll, describe, expect, it } from 'vitest'

import fixtures from './fixtures/mobile/tron.json'

// Provenance: supplemental Stake 2.0 vectors, independently generated with
// @trustwallet/wallet-core 4.7.3 TransactionCompiler and direct protobuf inputs.
// These reuse the original mobile TRX vector's owner, amount and block context;
// they are not recovered mobile vectors. No SDK mapper, signing resolver or
// pre-signing helper participates in this reference construction. The separate
// mobileFixtures suite checks the SDK path against the same committed hashes.
const reference = fixtures[0].keysign_payload
const block = reference.BlockchainSpecific.TronSpecific
const ownerAddress = reference.coin.address

const contracts = [
  ['FREEZE:BANDWIDTH', { freezeBalanceV2: { ownerAddress, frozenBalance: '1000000', resource: 'BANDWIDTH' } }],
  ['FREEZE:ENERGY', { freezeBalanceV2: { ownerAddress, frozenBalance: '1000000', resource: 'ENERGY' } }],
  ['UNFREEZE:BANDWIDTH', { unfreezeBalanceV2: { ownerAddress, unfreezeBalance: '1000000', resource: 'BANDWIDTH' } }],
  ['UNFREEZE:ENERGY', { unfreezeBalanceV2: { ownerAddress, unfreezeBalance: '1000000', resource: 'ENERGY' } }],
  ['WITHDRAW_EXPIRE_UNFREEZE', { withdrawExpireUnfreeze: { ownerAddress } }],
] as const

describe('Tron Stake 2.0 independent WalletCore fixture provenance', () => {
  let walletCore: WalletCore
  beforeAll(async () => {
    walletCore = await initWasm()
  })

  it.each(contracts)('reproduces the committed %s hash without SDK transaction mapping', (memo, contract) => {
    const fixture = fixtures.find(({ name }) => name === `Tron Stake 2.0 ${memo}`)
    expect(fixture).toBeDefined()
    expect(fixture?.keysign_payload).toEqual({ ...reference, memo, to_address: ownerAddress })

    const input = TW.Tron.Proto.SigningInput.fromObject({
      transaction: {
        ...contract,
        timestamp: String(block.timestamp),
        expiration: String(block.expiration),
        feeLimit: '0',
        blockHeader: {
          timestamp: String(block.block_header_timestamp),
          number: String(block.block_header_number),
          version: block.block_header_version,
          txTrieRoot: Buffer.from(block.block_header_tx_trie_root, 'hex'),
          parentHash: Buffer.from(block.block_header_parent_hash, 'hex'),
          witnessAddress: Buffer.from(block.block_header_witness_address, 'hex'),
        },
      },
    })
    const output = TW.TxCompiler.Proto.PreSigningOutput.decode(
      walletCore.TransactionCompiler.preImageHashes(
        walletCore.CoinType.tron,
        TW.Tron.Proto.SigningInput.encode(input).finish()
      )
    )
    expect(output.error).toBe(TW.Common.Proto.SigningError.OK)
    expect(output.dataHash).toHaveLength(32)
    expect([Buffer.from(output.dataHash).toString('hex')]).toEqual(fixture?.expected_image_hash)
  })
})
