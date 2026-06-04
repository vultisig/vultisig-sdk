import { hashTypedData, keccak256, stringToHex } from 'viem'
import { describe, expect, it } from 'vitest'

import { COW_SETTLEMENT_ADDRESS } from '../../config'
import { buildCowSwapOrder } from '../buildCowSwapOrder'
import { buildCowSwapOrderTypedData, cowSwapOrderEip712Fields } from '../buildCowSwapOrderTypedData'

const ETHEREUM_CHAIN_ID = 1

const order = buildCowSwapOrder({
  quoteResponse: {
    quote: {
      sellToken: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      buyToken: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      receiver: '0x1111111111111111111111111111111111111111',
      sellAmount: '1000000000000000000',
      buyAmount: '990000000',
      validTo: 1893456000,
      appData: '{}',
      feeAmount: '10000000000000000',
      kind: 'sell',
      partiallyFillable: false,
      sellTokenBalance: 'erc20',
      buyTokenBalance: 'erc20',
    },
    from: '0x1111111111111111111111111111111111111111',
    expiration: '2030-01-01T00:00:00.000Z',
    id: 1,
  },
  receiver: '0x1111111111111111111111111111111111111111',
})

describe('cowSwapOrderEip712Fields', () => {
  // Consensus-critical: this string IS the GPv2 `Order` type. If it drifts, the
  // EIP-712 digest changes and the orderbook rejects every signature. Pinned to
  // the canonical definition in GPv2Order.sol.
  it('encodes to the canonical GPv2 Order type string', () => {
    const encodeType = `Order(${cowSwapOrderEip712Fields.map(f => `${f.type} ${f.name}`).join(',')})`
    expect(encodeType).toBe(
      'Order(address sellToken,address buyToken,address receiver,uint256 sellAmount,uint256 buyAmount,uint32 validTo,bytes32 appData,uint256 feeAmount,string kind,bool partiallyFillable,string sellTokenBalance,string buyTokenBalance)'
    )
  })

  // GPv2Order.TYPE_HASH constant from the deployed settlement contract.
  it('hashes to the GPv2 Order TYPE_HASH', () => {
    const encodeType = `Order(${cowSwapOrderEip712Fields.map(f => `${f.type} ${f.name}`).join(',')})`
    expect(keccak256(stringToHex(encodeType))).toBe(
      '0xd5a25ba2e97094ad7d83dc28a6572da797d6b3e7fc6663bd93efb789fc17e489'
    )
  })
})

describe('buildCowSwapOrderTypedData', () => {
  it('builds the GPv2 EIP-712 domain', () => {
    const { domain } = buildCowSwapOrderTypedData({ order, chainId: ETHEREUM_CHAIN_ID })
    expect(domain.name).toBe('Gnosis Protocol')
    expect(domain.version).toBe('v2')
    expect(domain.chainId).toBe(ETHEREUM_CHAIN_ID)
    expect(domain.verifyingContract).toBe(COW_SETTLEMENT_ADDRESS)
  })

  it('signs over the appData HASH (bytes32), not the appData JSON string', () => {
    const { message } = buildCowSwapOrderTypedData({ order, chainId: ETHEREUM_CHAIN_ID })
    expect(message.appData).toBe(order.appDataHash)
    expect(message.appData).toMatch(/^0x[0-9a-f]{64}$/)
    expect(message.appData).not.toBe(order.appData)
  })

  it('maps every order field through to the message verbatim', () => {
    const { message } = buildCowSwapOrderTypedData({ order, chainId: ETHEREUM_CHAIN_ID })
    expect(message.sellToken).toBe(order.sellToken)
    expect(message.buyToken).toBe(order.buyToken)
    expect(message.receiver).toBe(order.receiver)
    expect(message.sellAmount).toBe(order.sellAmount)
    expect(message.buyAmount).toBe(order.buyAmount)
    expect(message.validTo).toBe(order.validTo)
    expect(message.feeAmount).toBe(order.feeAmount)
    expect(message.kind).toBe('sell')
    expect(message.partiallyFillable).toBe(false)
    expect(message.sellTokenBalance).toBe('erc20')
    expect(message.buyTokenBalance).toBe('erc20')
  })

  // The cast localizes the boundary between our `string`-typed order fields and
  // viem's strict `0x${string}` / `bigint` typed-data inference; viem still
  // validates the structure at runtime and throws on a malformed document.
  const digestOf = (td: ReturnType<typeof buildCowSwapOrderTypedData>) =>
    hashTypedData({
      domain: td.domain,
      types: { Order: [...td.types.Order] },
      primaryType: 'Order',
      message: td.message,
    } as Parameters<typeof hashTypedData>[0])

  it('produces a typed-data document that viem accepts and hashes deterministically', () => {
    const typedData = buildCowSwapOrderTypedData({ order, chainId: ETHEREUM_CHAIN_ID })

    const digest = digestOf(typedData)

    expect(digest).toMatch(/^0x[0-9a-f]{64}$/)
    expect(digest).toBe(digestOf(typedData))
  })

  it('changes the digest when the chainId changes (domain separation)', () => {
    const base = buildCowSwapOrderTypedData({ order, chainId: 1 })
    const arbitrum = buildCowSwapOrderTypedData({ order, chainId: 42161 })

    expect(digestOf(base)).not.toBe(digestOf(arbitrum))
  })
})
