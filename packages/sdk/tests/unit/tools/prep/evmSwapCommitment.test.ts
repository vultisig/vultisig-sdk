import { Chain } from '@vultisig/core-chain/Chain'
import type { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { getSwapQuoteSafetyFingerprint } from '@vultisig/core-chain/swap/quote/getSwapQuoteSafetyFingerprint'
import { AbiCoder, Interface } from 'ethers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ wallet: vi.fn(), key: vi.fn(), build: vi.fn() }))
vi.mock('@/context/wasmRuntime', () => ({ getWalletCore: mocks.wallet }))
vi.mock('@vultisig/core-chain/publicKey/getPublicKey', () => ({ getPublicKey: mocks.key }))
vi.mock('@vultisig/core-mpc/keysign/swap/build', () => ({ buildSwapKeysignPayload: mocks.build }))

import { decodeEvmSwapCommitment } from '@/tools/prep/evmSwapCommitment'
import { prepareSwapTxFromKeys, SwapQuoteExpiredError } from '@/tools/prep/swap'

const zero = '0x0000000000000000000000000000000000000000'
const user = '0x1111111111111111111111111111111111111111'
const token = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const weth = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
const native = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
const oneinch = '0x111111125421ca6dc452d289314280a0f8842a65'
const v5 = '0x1111111254eeb25477b68fb85ed929f73a960582'
const kyber = '0x6131b5fae19ea4f9d964eac0408e4408b66337b5'
const thor = '0xd37bbe5744d730a1d98d8dc97c42f0ca46ad7146'
const ur = '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad'
const balance = 1n << 255n
const abiCoder = AbiCoder.defaultAbiCoder()
const inchDesc = '(address,address,address,address,uint256,uint256,uint256)'
const kyberDesc = '(address,address,address[],uint256[],address[],uint256[],address,uint256,uint256,uint256,bytes)'
const kyberExec = `(address,address,bytes,${kyberDesc},bytes)`
const encode = (signature: string, args: readonly unknown[]) =>
  new Interface([`function ${signature}`]).encodeFunctionData(signature.split('(')[0], args)
const tx = (to: string, data: string, value = 0n) => ({ to, data, value: value.toString(), from: user })
const decode = (to: string, data: string, value = 0n, chain: Chain = Chain.Ethereum) =>
  decodeEvmSwapCommitment({ chain, tx: tx(to, data, value) })
const inch = (amount = 100n, src = token, flags = 0n, legacy = false) =>
  encode(`swap(address,${inchDesc},bytes${legacy ? ',bytes' : ''})`, [
    user,
    [src, weth, user, user, amount, 1n, flags],
    '0x',
    ...(legacy ? ['0x'] : []),
  ])
const deposit = (asset = token, amount = 100n, expiry = 2_000_000_000n) =>
  encode('depositWithExpiry(address,address,uint256,string,uint256)', [user, asset, amount, 'memo', expiry])
const execute = (commands: string, inputs: string[], expiry?: bigint) =>
  encode(`execute(bytes,bytes[]${expiry === undefined ? '' : ',uint256'})`, [
    commands,
    inputs,
    ...(expiry === undefined ? [] : [expiry]),
  ])
const leg = (amount: bigint, payer = true, v3 = false, src = token) =>
  abiCoder.encode(
    ['address', 'uint256', 'uint256', v3 ? 'bytes' : 'address[]', 'bool'],
    [user, amount, 1n, v3 ? `${src}000bb8${weth.slice(2)}` : [src, weth], payer]
  )
const simpleData = (expiry: bigint) =>
  abiCoder.encode(['tuple(address[],uint256[],bytes[],uint256,bytes)'], [[[user], [100n], ['0x'], expiry, '0x']])
const kyberCall = (name = 'swap', amount = 100n, src = token, flags = 0n, data = '0x1234') => {
  const desc = [src, weth, [user], [amount], [], [], user, amount, 1n, flags, '0x']
  return name === 'swapSimpleMode'
    ? encode(`swapSimpleMode(address,${kyberDesc},bytes,bytes)`, [user, desc, data, '0x'])
    : encode(`${name}(${kyberExec})`, [[user, user, data, desc, '0x']])
}

describe('verified EVM swap commitments', () => {
  it.each([false, true])('decodes 1inch generic swap, V5=%s', legacy => {
    expect(decode(legacy ? v5 : oneinch, inch(100n, token, 0n, legacy))).toMatchObject({
      sellAmount: 100n,
      sourceToken: token,
    })
    expect(decode(legacy ? v5 : oneinch, inch(100n, native, 0n, legacy), 100n).sellAmount).toBe(100n)
    expect(() => decode(legacy ? v5 : oneinch, inch(100n, native, 0n, legacy), 101n)).toThrow(
      'transaction value mismatch; expected 100, received 101'
    )
  })
  it.each(['unoswap', 'unoswap2', 'unoswap3', 'unoswapTo', 'unoswapTo2', 'unoswapTo3'])(
    'uses real V6 uint256 token/to ABI for %s',
    name => {
      const pools = Number(name.slice(-1)) || 1
      const to = name.includes('To')
      const signature = `${name}(${Array(pools + 3 + Number(to))
        .fill('uint256')
        .join(',')})`
      const args = [...(to ? [BigInt(user)] : []), BigInt(token) | (1n << 255n), 100n, 1n, ...Array(pools).fill(1n)]
      expect(decode(oneinch, encode(signature, args))).toMatchObject({ sellAmount: 100n, sourceToken: token })
    }
  )
  it.each(['ethUnoswap', 'ethUnoswap2', 'ethUnoswap3', 'ethUnoswapTo', 'ethUnoswapTo2', 'ethUnoswapTo3'])(
    'uses transaction value for %s',
    name => {
      const pools = Number(name.slice(-1)) || 1
      const to = name.includes('To')
      expect(
        decode(
          oneinch,
          encode(
            `${name}(${Array(pools + 1 + Number(to))
              .fill('uint256')
              .join(',')})`,
            [...(to ? [BigInt(user)] : []), 1n, ...Array(pools).fill(1n)]
          ),
          100n
        )
      ).toMatchObject({ sellAmount: 100n, sourceToken: zero })
    }
  )
  it.each(['unoswap', 'unoswapTo'])('does not treat the ignored V3 source argument in %s as authority', name => {
    const to = name.includes('To')
    const data = encode(
      `${name}(${Array(4 + Number(to))
        .fill('uint256')
        .join(',')})`,
      [...(to ? [BigInt(user)] : []), 0n, 100n, 1n, (1n << 253n) | BigInt(user)]
    )
    expect(decode(oneinch, data)).toEqual({})
  })
  it('preserves gross input for partial-fill refunds and skips extra ETH fee semantics', () => {
    expect(decode(oneinch, inch(100n, token, 1n)).sellAmount).toBe(100n)
    expect(decode(oneinch, inch(100n, native, 2n), 120n)).toEqual({})
  })
  it.each(['swap', 'swapGeneric', 'swapSimpleMode'])('decodes Kyber %s gross amount', name => {
    expect(
      decode(kyber, kyberCall(name, 100n, token, 0n, name === 'swapSimpleMode' ? simpleData(200n) : '0x1234'))
        .sellAmount
    ).toBe(100n)
  })
  it('keeps Kyber simple-mode deadlines independent of amount coverage', () => {
    for (const name of ['swap', 'swapSimpleMode']) {
      expect(decode(kyber, kyberCall(name, 100n, token, 34n, simpleData(200n)))).toEqual({
        deadline: { seconds: 200n, inclusive: true },
      })
    }
    expect(() => decode(kyber, kyberCall('swap', 100n, token, 32n, '0x1234'))).toThrow('malformed')
    expect(decode(kyber, kyberCall('swapGeneric', 100n, token, 32n, '0x1234')).deadline).toBeUndefined()
  })
  it('binds native Kyber value and amount together', () => {
    expect(decode(kyber, kyberCall('swap', 100n, native), 100n).sellAmount).toBe(100n)
    expect(() => decode(kyber, kyberCall('swap', 100n, native), 101n)).toThrow(
      'transaction value mismatch; expected 100, received 101'
    )
  })
  it('uses native THOR value even when the encoded amount differs', () => {
    expect(decode(thor, deposit(zero, 999n), 100n)).toEqual({
      sellAmount: 100n,
      sourceToken: zero,
      deadline: { seconds: 2_000_000_000n, inclusive: false },
    })
    expect(decode(thor, deposit()).sellAmount).toBe(100n)
  })
  it.each([undefined, 200n])('handles Universal Router deadline overload %s', expiry => {
    expect(decode(ur, execute('0x08', [leg(100n)], expiry))).toEqual({
      sellAmount: 100n,
      sourceToken: token,
      deadline: expiry === undefined ? undefined : { seconds: expiry, inclusive: true },
    })
    expect(decode(ur, execute('0x00', [leg(100n, true, true)], expiry)).sellAmount).toBe(100n)
  })
  it.each(['0x09', '0x01', '0x88', '0x10', '0x21'])(
    'retains the outer deadline for unsupported command %s',
    command => {
      expect(decode(ur, execute(command, ['0x'], 200n))).toEqual({ deadline: { seconds: 200n, inclusive: true } })
    }
  )
  it.each([false, true])('rejects native value on a payer-funded token leg, V3=%s', v3 => {
    expect(() => decode(ur, execute(v3 ? '0x00' : '0x08', [leg(100n, true, v3)], 200n), 1n)).toThrow(
      'transaction value mismatch; expected 0, received 1'
    )
  })
  it.each([false, true])('rejects malformed value after supported inner decoding, wrapped=%s', wrapped => {
    const wrap = abiCoder.encode(['address', 'uint256'], ['0x0000000000000000000000000000000000000002', balance])
    const data = wrapped
      ? execute('0x0b00', [wrap, leg(balance, false, true, weth)], 200n)
      : execute('0x08', [leg(100n)], 200n)
    expect(() => decodeEvmSwapCommitment({ chain: Chain.Ethereum, tx: { ...tx(ur, data), value: 'invalid' } })).toThrow(
      'malformed recognized EVM swap calldata'
    )
  })
  it.each([false, true])('rejects native value on unwrapped router-funded and sentinel legs, V3=%s', v3 => {
    for (const input of [leg(100n, false, v3), leg(balance, true, v3), leg(0n, true, v3)]) {
      const data = execute(v3 ? '0x00' : '0x08', [input], 200n)
      expect(() => decode(ur, data, 1n)).toThrow('transaction value mismatch; expected 0, received 1')
      expect(decode(ur, data)).toEqual({ deadline: { seconds: 200n, inclusive: true } })
    }
  })
  it('retains deadlines for undecodable inner swaps, mixed routes, sentinels, and router-funded legs', () => {
    for (const data of [
      execute('0x08', ['0x'], 200n),
      execute('0x0808', [leg(100n), leg(200n)], 200n),
      execute('0x08', [leg(balance)], 200n),
      execute('0x08', [leg(0n)], 200n),
      execute('0x08', [leg(100n, false)], 200n),
      execute('0x0b08', ['0x', leg(100n, false, false, weth)], 200n),
    ]) {
      expect(decode(ur, data)).toEqual({ deadline: { seconds: 200n, inclusive: true } })
    }
  })
  it('binds wrapped native input to wallet value, not contract-balance sentinels', () => {
    const wrap = abiCoder.encode(['address', 'uint256'], ['0x0000000000000000000000000000000000000002', balance])
    expect(decode(ur, execute('0x0b00', [wrap, leg(balance, false, true, weth)], 200n), 100n)).toMatchObject({
      sellAmount: 100n,
      sourceToken: zero,
    })
  })
  it('does not apply a selector to an unknown router, version, or chain', () => {
    expect(decode(user, inch())).toEqual({})
    expect(decode(oneinch, inch(100n, token, 0n, true))).toEqual({})
    expect(decode(thor, deposit(), 0n, Chain.Base)).toEqual({})
    expect(decode(oneinch, inch(), 0n, Chain.Zksync)).toEqual({})
  })
  it('rejects truncated known calldata while retaining unsupported formats', () => {
    expect(() => decode(oneinch, inch().slice(0, 10))).toThrow('malformed')
    expect(() => decode(thor, deposit().slice(0, -64))).toThrow('malformed')
    expect(decode(oneinch, '0x12345678')).toEqual({})
    expect(() => decode(ur, execute('0x0808', [leg(100n)], 200n))).toThrow('malformed')
  })
})

describe('preparation semantic checks after valid fingerprint binding', () => {
  const coin: AccountCoin = { chain: Chain.Ethereum, address: user, decimals: 0, ticker: 'USDC', id: token }
  const toCoin = { ...coin, id: weth, ticker: 'WETH' }
  const identity = {
    ecdsaPublicKey: 'test',
    eddsaPublicKey: 'test',
    hexChainCode: 'test',
    localPartyId: 'test',
    libType: 'DKLS' as const,
  }
  const prepare = (transaction: ReturnType<typeof tx>, fromCoin = coin, amount = 100n) => {
    const quote = { general: { provider: '1inch' as const, dstAmount: '1', tx: { evm: transaction } } }
    const expiresAt = Date.now() + 300_000
    const swapQuote = {
      quote,
      discounts: [],
      requestedAmount: amount,
      expiresAt,
      safetyFingerprint: getSwapQuoteSafetyFingerprint({
        from: fromCoin,
        to: toCoin,
        requestedAmount: amount,
        expiresAt,
        quote,
      }),
    }
    return prepareSwapTxFromKeys(identity, { fromCoin, toCoin, amount: amount.toString(), swapQuote })
  }
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.wallet.mockResolvedValue({})
    mocks.build.mockResolvedValue({ ok: true })
  })
  afterEach(() => {
    vi.useRealTimers()
  })
  it.each([
    ['1inch', oneinch, inch(101n)],
    ['Kyber', kyber, kyberCall('swap', 101n)],
    ['THOR', thor, deposit(token, 101n)],
    ['Universal', ur, execute('0x08', [leg(101n)])],
  ])('rejects initially inconsistent %s before wallet, key or payload work', async (_, router, data) => {
    await expect(prepare(tx(router, data))).rejects.toThrow('committed source amount')
    expect(mocks.wallet).not.toHaveBeenCalled()
    expect(mocks.key).not.toHaveBeenCalled()
    expect(mocks.build).not.toHaveBeenCalled()
  })
  it('rejects an initially inconsistent native THOR value', async () => {
    await expect(prepare(tx(thor, deposit(zero, 100n), 101n), { ...coin, id: undefined })).rejects.toThrow(
      'committed source amount'
    )
    expect(mocks.wallet).not.toHaveBeenCalled()
  })
  it.each([true, false])(
    'rejects extra native value before wallet, key or payload work, payer-funded=%s',
    async payer => {
      await expect(prepare(tx(ur, execute('0x08', [leg(100n, payer)]), 1n))).rejects.toThrow(
        'transaction value mismatch'
      )
      expect(mocks.wallet).not.toHaveBeenCalled()
      expect(mocks.key).not.toHaveBeenCalled()
      expect(mocks.build).not.toHaveBeenCalled()
    }
  )
  it('rejects a different encoded source asset', async () => {
    await expect(prepare(tx(oneinch, inch(100n, weth)))).rejects.toThrow('source token')
    expect(mocks.build).not.toHaveBeenCalled()
  })
  it.each([undefined, ''])('accepts native source coin ID %s and still checks the committed value', async id => {
    const nativeCoin = { ...coin, id }
    await expect(prepare(tx(thor, deposit(zero, 100n), 100n), nativeCoin)).resolves.toEqual({ ok: true })
    mocks.wallet.mockClear()
    await expect(prepare(tx(thor, deposit(zero, 100n), 101n), nativeCoin)).rejects.toThrow('committed source amount')
    expect(mocks.wallet).not.toHaveBeenCalled()
    await expect(prepare(tx(oneinch, inch()), nativeCoin)).rejects.toThrow('source token')
  })
  it('retains deadline enforcement without an amount and respects exact contract boundaries', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-01T00:00:00.500Z'))
    const now = BigInt(Math.floor(Date.now() / 1000))
    await expect(prepare(tx(ur, execute('0x10', ['0x'], now - 1n)))).rejects.toBeInstanceOf(SwapQuoteExpiredError)
    await expect(prepare(tx(thor, deposit(token, 100n, now)))).rejects.toBeInstanceOf(SwapQuoteExpiredError)
    await expect(
      prepare(tx(kyber, kyberCall('swapSimpleMode', 100n, token, 0n, simpleData(now - 1n))))
    ).rejects.toBeInstanceOf(SwapQuoteExpiredError)
    expect(mocks.wallet).not.toHaveBeenCalled()
    await expect(prepare(tx(ur, execute('0x08', [leg(100n)], now)))).resolves.toEqual({ ok: true })
  })
  it('keeps full uint256 deadlines precise and prepares valid known and unsupported routes', async () => {
    for (const transaction of [
      tx(oneinch, inch()),
      tx(kyber, kyberCall()),
      tx(thor, deposit(token, 100n, (1n << 256n) - 1n)),
      tx(ur, execute('0x08', [leg(100n)])),
      tx(user, '0x12345678'),
    ]) {
      await expect(prepare(transaction)).resolves.toEqual({ ok: true })
    }
  })
})
