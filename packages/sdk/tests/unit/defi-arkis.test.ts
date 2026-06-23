import { encodeFunctionData, erc20Abi, getAddress } from 'viem'
import { describe, expect, it } from 'vitest'

import { ARKIS_OFFICIAL_ADDRESSES, buildArkisSupplyTx, parseArkisTokenAmount } from '@/tools/defi/arkis'

const SENDER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const POOL = '0x1111111111111111111111111111111111111111'
const ERC4626_POOL = '0x2222222222222222222222222222222222222222'
const USDC = '0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'

describe('parseArkisTokenAmount', () => {
  it('parses whole and fractional token amounts', () => {
    expect(parseArkisTokenAmount('1500', 6)).toBe(1_500_000_000n)
    expect(parseArkisTokenAmount('1500.5', 6)).toBe(1_500_500_000n)
  })

  it('rejects malformed or overly precise amounts', () => {
    expect(() => parseArkisTokenAmount('', 6)).toThrow(/empty/)
    expect(() => parseArkisTokenAmount('-1', 6)).toThrow(/negative/)
    expect(() => parseArkisTokenAmount('1.1234567', 6)).toThrow(/too many decimal/)
    expect(() => parseArkisTokenAmount('1.2.3', 6)).toThrow(/decimal points/)
  })
})

describe('buildArkisSupplyTx — Agreement path', () => {
  it('builds approve + deposit(uint128) for a standard Arkis Agreement', () => {
    const built = buildArkisSupplyTx({
      poolKind: 'agreement',
      poolAddress: POOL,
      tokenAddress: USDC,
      from: SENDER,
      amount: '1500',
      decimals: 6,
    })

    expect(built.protocol).toBe('Arkis')
    expect(built.chain).toBe('Ethereum')
    expect(built.chainId).toBe('1')
    expect(built.poolKind).toBe('agreement')
    expect(built.amountRaw).toBe('1500000000')
    expect(built.transactions).toHaveLength(2)

    const [approveTx, depositTx] = built.transactions
    expect(approveTx.to).toBe(getAddress(USDC))
    expect(approveTx.action).toBe('approve')
    expect(approveTx.value).toBe('0')
    expect(approveTx.data).toBe(
      encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [getAddress(POOL), 1_500_000_000n],
      })
    )

    expect(depositTx.to).toBe(getAddress(POOL))
    expect(depositTx.action).toBe('deposit')
    expect(depositTx.data).toBe(
      encodeFunctionData({
        abi: [
          {
            name: 'deposit',
            type: 'function',
            stateMutability: 'nonpayable',
            inputs: [{ name: 'amount', type: 'uint128' }],
            outputs: [],
          },
        ] as const,
        functionName: 'deposit',
        args: [1_500_000_000n],
      })
    )
  })

  it('rejects an amount that overflows uint128 on the Agreement path', () => {
    expect(() =>
      buildArkisSupplyTx({
        poolKind: 'agreement',
        poolAddress: POOL,
        tokenAddress: USDC,
        from: SENDER,
        amountRaw: 1n << 200n,
      })
    ).toThrow(/uint128/)
  })
})

describe('buildArkisSupplyTx — ERC-4626 path', () => {
  it('builds approve + deposit(uint256,address) with receiver fixed to self', () => {
    const built = buildArkisSupplyTx({
      poolKind: 'erc4626_vault',
      poolAddress: ERC4626_POOL,
      tokenAddress: USDC,
      from: SENDER,
      amountRaw: 1_500_000_000n,
    })

    expect(built.poolKind).toBe('erc4626_vault')
    expect(built.receiver).toBe(getAddress(SENDER))

    const [, depositTx] = built.transactions
    expect(depositTx.data).toBe(
      encodeFunctionData({
        abi: [
          {
            name: 'deposit',
            type: 'function',
            stateMutability: 'nonpayable',
            inputs: [
              { name: 'assets', type: 'uint256' },
              { name: 'receiver', type: 'address' },
            ],
            outputs: [{ type: 'uint256' }],
          },
        ] as const,
        functionName: 'deposit',
        args: [1_500_000_000n, getAddress(SENDER)],
      })
    )
  })
})

describe('buildArkisSupplyTx — validation + injectable affiliate', () => {
  it('rejects bad addresses, zero amounts, and missing amount inputs', () => {
    expect(() =>
      buildArkisSupplyTx({
        poolKind: 'agreement',
        poolAddress: 'nope',
        tokenAddress: USDC,
        from: SENDER,
        amountRaw: 1n,
      })
    ).toThrow(/pool_address/)
    expect(() =>
      buildArkisSupplyTx({
        poolKind: 'agreement',
        poolAddress: POOL,
        tokenAddress: USDC,
        from: SENDER,
        amountRaw: 0n,
      })
    ).toThrow(/positive/)
    expect(() =>
      buildArkisSupplyTx({
        poolKind: 'agreement',
        poolAddress: POOL,
        tokenAddress: USDC,
        from: SENDER,
      })
    ).toThrow(/amountRaw.*amount.*decimals/)
  })

  it('omits affiliate by default (neutral/off) and echoes it when injected', () => {
    const neutral = buildArkisSupplyTx({
      poolKind: 'agreement',
      poolAddress: POOL,
      tokenAddress: USDC,
      from: SENDER,
      amountRaw: 1n,
    })
    expect(neutral.affiliate).toBeUndefined()

    const tagged = buildArkisSupplyTx({
      poolKind: 'agreement',
      poolAddress: POOL,
      tokenAddress: USDC,
      from: SENDER,
      amountRaw: 1n,
      affiliate: 'some-consumer',
    })
    expect(tagged.affiliate).toBe('some-consumer')
    // affiliate is metadata only — it must not alter the on-chain calldata.
    expect(tagged.transactions[0].data).toBe(neutral.transactions[0].data)
    expect(tagged.transactions[1].data).toBe(neutral.transactions[1].data)
  })

  it('exposes the published Arkis mainnet addresses', () => {
    expect(ARKIS_OFFICIAL_ADDRESSES.dispatcher).toBe('0x2f01D7CFfe62673B3D2b680295A2D047F3848e4c')
  })
})
