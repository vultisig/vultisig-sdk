import { getErc20Allowance } from '@vultisig/core-chain/chains/evm/erc20/getErc20Allowance'
import { Chain } from '@vultisig/core-chain/Chain'
import { KeysignLibType } from '@vultisig/core-mpc/mpcLib'
import { WalletCore } from '@trustwallet/wallet-core'
import { PublicKey } from '@trustwallet/wallet-core/dist/src/wallet-core'
import { beforeEach, describe, expect, it, Mock, vi } from 'vitest'

import {
  buildVultStakeKeysignPayload,
  encodeVultCancelUnstake,
  encodeVultClaim,
  encodeVultDepositFor,
  encodeVultRequestUnstake,
} from './build'

vi.mock('@vultisig/core-chain/chains/evm/erc20/getErc20Allowance', () => ({
  getErc20Allowance: vi.fn(),
}))

vi.mock('@vultisig/core-mpc/keysign/chainSpecific', () => ({
  getChainSpecific: vi.fn(async () => ({ case: 'ethereumSpecific', value: {} })),
}))

const account = '0x8b937c5395d95a8c8948c7c5b844e1541798d90c'

// Golden vectors — selectors must match the deployed sVULT ABI on Ethereum
// mainnet (0x11113d7311FB8584a6e82BB126aA11D92e5fB39B). A signature typo would
// change the 4-byte selector and fail here instead of silently on-chain.
describe('VULT staking calldata', () => {
  it('encodes depositFor(address,uint256)', () => {
    expect(encodeVultDepositFor(account, 1000000000000000000n)).toBe(
      '0x2f4f21e20000000000000000000000008b937c5395d95a8c8948c7c5b844e1541798d90c0000000000000000000000000000000000000000000000000de0b6b3a7640000'
    )
  })

  it('encodes requestUnstake(uint256)', () => {
    expect(encodeVultRequestUnstake(500000000000000000n)).toBe(
      '0x2309572100000000000000000000000000000000000000000000000006f05b59d3b20000'
    )
  })

  it('encodes claim(uint256,address)', () => {
    expect(encodeVultClaim(3n, account)).toBe(
      '0xddd5e1b200000000000000000000000000000000000000000000000000000000000000030000000000000000000000008b937c5395d95a8c8948c7c5b844e1541798d90c'
    )
  })

  it('encodes cancelUnstake(uint256)', () => {
    expect(encodeVultCancelUnstake(3n)).toBe(
      '0x2b187b2b0000000000000000000000000000000000000000000000000000000000000003'
    )
  })
})

describe('buildVultStakeKeysignPayload', () => {
  const stakingContractAddress = '0x11113d7311FB8584a6e82BB126aA11D92e5fB39B'
  const amount = 1000000000000000000n

  const baseInput = {
    vaultAddress: account,
    vaultId: 'vault-ecdsa',
    localPartyId: 'party-1',
    publicKey: {
      data: () => new Uint8Array([1, 2, 3]),
    } as unknown as PublicKey,
    libType: 'DKLS' as KeysignLibType,
    walletCore: {} as unknown as WalletCore,
  }

  const underlyingToken = {
    chain: Chain.Ethereum,
    id: '0xb788144DF611029C60b859DF47e79B7726C4DEBa',
    ticker: 'VULT',
    decimals: 18,
    logo: 'vult',
    priceProviderId: 'vultisig',
  }

  const allowanceMock = getErc20Allowance as unknown as Mock

  beforeEach(() => {
    allowanceMock.mockReset()
  })

  it('attaches an approve when the allowance is insufficient', async () => {
    allowanceMock.mockResolvedValue(0n)

    const payload = await buildVultStakeKeysignPayload({
      ...baseInput,
      underlyingToken,
      stakingContractAddress,
      amount,
    })

    expect(payload.erc20ApprovePayload?.spender).toBe(stakingContractAddress)
    expect(payload.erc20ApprovePayload?.amount).toBe(amount.toString())
  })

  it('skips the approve when the allowance is sufficient', async () => {
    allowanceMock.mockResolvedValue(amount * 2n)

    const payload = await buildVultStakeKeysignPayload({
      ...baseInput,
      underlyingToken,
      stakingContractAddress,
      amount,
    })

    expect(payload.erc20ApprovePayload).toBeUndefined()
  })

  it('rejects non-Ethereum tokens', async () => {
    await expect(
      buildVultStakeKeysignPayload({
        ...baseInput,
        underlyingToken: { ...underlyingToken, chain: Chain.Base },
        stakingContractAddress,
        amount,
      })
    ).rejects.toThrow('only supported on Ethereum')
  })
})
