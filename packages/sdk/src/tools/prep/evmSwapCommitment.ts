import { Chain } from '@vultisig/core-chain/Chain'
import { assertKnownAggregatorRouter } from '@vultisig/core-chain/swap/general/knownAggregatorRouters'
import {
  type Abi,
  decodeAbiParameters,
  decodeFunctionData,
  hexToBytes,
  isHex,
  parseAbi,
  parseAbiParameters,
  toFunctionSelector,
} from 'viem'

// See docs/evm-swap-commitments.md for verified contracts, semantics and residual coverage.
const nativeToken = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
const zeroAddress = '0x0000000000000000000000000000000000000000'
const ethereumThorRouter = '0xd37bbe5744d730a1d98d8dc97c42f0ca46ad7146'
const ethereumUniversalRouter = '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad'
const ethereumWrappedEther = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
const universalRouterAddressThis = '0x0000000000000000000000000000000000000002'
const contractBalance = 1n << 255n
const addressMask = (1n << 160n) - 1n

const oneInchDescription =
  '(address srcToken,address dstToken,address srcReceiver,address dstReceiver,uint256 amount,uint256 minReturnAmount,uint256 flags)'
const oneInchV5Abi = parseAbi([
  `function swap(address executor,${oneInchDescription} desc,bytes permit,bytes data) payable`,
])
const oneInchV6Abi = parseAbi([
  `function swap(address executor,${oneInchDescription} desc,bytes data) payable`,
  'function unoswap(uint256 token,uint256 amount,uint256 minReturn,uint256 dex)',
  'function unoswap2(uint256 token,uint256 amount,uint256 minReturn,uint256 dex,uint256 dex2)',
  'function unoswap3(uint256 token,uint256 amount,uint256 minReturn,uint256 dex,uint256 dex2,uint256 dex3)',
  'function unoswapTo(uint256 to,uint256 token,uint256 amount,uint256 minReturn,uint256 dex)',
  'function unoswapTo2(uint256 to,uint256 token,uint256 amount,uint256 minReturn,uint256 dex,uint256 dex2)',
  'function unoswapTo3(uint256 to,uint256 token,uint256 amount,uint256 minReturn,uint256 dex,uint256 dex2,uint256 dex3)',
  'function ethUnoswap(uint256 minReturn,uint256 dex) payable',
  'function ethUnoswap2(uint256 minReturn,uint256 dex,uint256 dex2) payable',
  'function ethUnoswap3(uint256 minReturn,uint256 dex,uint256 dex2,uint256 dex3) payable',
  'function ethUnoswapTo(uint256 to,uint256 minReturn,uint256 dex) payable',
  'function ethUnoswapTo2(uint256 to,uint256 minReturn,uint256 dex,uint256 dex2) payable',
  'function ethUnoswapTo3(uint256 to,uint256 minReturn,uint256 dex,uint256 dex2,uint256 dex3) payable',
])
const kyberDescription =
  '(address srcToken,address dstToken,address[] srcReceivers,uint256[] srcAmounts,address[] feeReceivers,uint256[] feeAmounts,address dstReceiver,uint256 amount,uint256 minReturnAmount,uint256 flags,bytes permit)'
const kyberExecution = `(address callTarget,address approveTarget,bytes targetData,${kyberDescription} desc,bytes clientData)`
const kyberAbi = parseAbi([
  `function swap(${kyberExecution} execution) payable`,
  `function swapGeneric(${kyberExecution} execution) payable`,
  `function swapSimpleMode(address caller,${kyberDescription} desc,bytes executorData,bytes clientData)`,
])
const thorAbi = parseAbi([
  'function depositWithExpiry(address vault,address asset,uint256 amount,string memo,uint256 expiration) payable',
])
const universalAbi = parseAbi([
  'function execute(bytes commands,bytes[] inputs,uint256 deadline) payable',
  'function execute(bytes commands,bytes[] inputs) payable',
])

export type EvmSwapCommitment = {
  /** Gross source funds authorized by this call, before fees and partial-fill refunds. */
  sellAmount?: bigint
  /** Undefined means the amount is not independently interpretable for this layout. */
  sourceToken?: string
  deadline?: { seconds: bigint; inclusive: boolean }
}

type Input = {
  chain: Chain
  tx: { to: string; data: string; value: string }
}

const malformed = (): never => {
  throw new Error('prepareSwapTxFromKeys: malformed recognized EVM swap calldata; refresh the quote before signing')
}

// Only malformed *recognized* selectors fail closed. Unknown formats retain the existing
// quote binding and expiry checks; a selector alone never establishes router identity.
const decodeKnown = <T extends Abi>(abi: T, data: string) => {
  const selector = data.slice(0, 10).toLowerCase()
  if (!abi.some(item => item.type === 'function' && toFunctionSelector(item) === selector)) return undefined
  if (!isHex(data) || !/^0x(?:[\da-fA-F]{2})+$/.test(data)) return malformed()
  try {
    return decodeFunctionData({ abi, data })
  } catch {
    return malformed()
  }
}

const parseValue = (value: string): bigint => {
  if (!/^(?:\d+|0x[\da-fA-F]+)$/.test(value)) return malformed()
  return BigInt(value)
}

const assertTransactionValue = (value: string, expected: bigint): void => {
  const actual = parseValue(value)
  if (actual !== expected) {
    throw new Error(
      `prepareSwapTxFromKeys: encoded EVM swap transaction value mismatch; expected ${expected}, received ${actual}; refresh the quote before signing`
    )
  }
}

const isKnownRouter = (provider: '1inch' | 'kyber', input: Input): boolean => {
  try {
    assertKnownAggregatorRouter(provider, input.tx.to, input.chain)
    return true
  } catch {
    return false
  }
}

const sourceCommitment = (sourceToken: string, sellAmount: bigint): EvmSwapCommitment => ({
  sourceToken: sourceToken.toLowerCase(),
  sellAmount,
})

const decodeOneInch = (input: Input): EvmSwapCommitment => {
  const { tx } = input
  const abi = tx.to.toLowerCase() === '0x1111111254eeb25477b68fb85ed929f73a960582' ? oneInchV5Abi : oneInchV6Abi
  const decoded = decodeKnown(abi, tx.data)
  if (!decoded) return {}
  if (decoded.functionName === 'swap') {
    const desc = decoded.args[1]
    // Extra-native-value routes need a separate fee authorization contract. Do not
    // equate their transaction value with the source amount or invent a tolerance.
    if (desc.flags & 2n) return {}
    const native = [nativeToken, zeroAddress].includes(desc.srcToken.toLowerCase())
    assertTransactionValue(tx.value, native ? desc.amount : 0n)
    return sourceCommitment(native ? zeroAddress : desc.srcToken, desc.amount)
  }
  let token: bigint
  let amount: bigint
  let firstPool: bigint
  switch (decoded.functionName) {
    case 'unoswap':
    case 'unoswap2':
    case 'unoswap3':
      ;[token, amount, , firstPool] = decoded.args
      break
    case 'unoswapTo':
    case 'unoswapTo2':
    case 'unoswapTo3':
      ;[, token, amount, , firstPool] = decoded.args
      break
    default:
      return sourceCommitment(zeroAddress, parseValue(tx.value))
  }
  // V6 ignores `token` when the first pool is V3: the callback obtains the
  // debit asset from the pool instead. Without independently reading that pool,
  // the argument cannot establish the units of `amount` (and may legitimately be 0).
  if (firstPool >> 253n === 1n) return {}
  assertTransactionValue(tx.value, 0n)
  return sourceCommitment(`0x${(token & addressMask).toString(16).padStart(40, '0')}`, amount)
}

const decodeKyber = (input: Input): EvmSwapCommitment => {
  const decoded = decodeKnown(kyberAbi, input.tx.data)
  if (!decoded) return {}
  const simple = decoded.functionName === 'swapSimpleMode'
  const desc = simple ? decoded.args[1] : decoded.args[0].desc
  const simpleMode = simple || (decoded.functionName === 'swap' && (desc.flags & 32n) !== 0n)
  let deadline: EvmSwapCommitment['deadline']
  if (simpleMode) {
    const data = simple ? decoded.args[2] : decoded.args[0].targetData
    try {
      const [value] = decodeAbiParameters(
        [
          {
            type: 'tuple',
            components: [
              { type: 'address[]' },
              { type: 'uint256[]' },
              { type: 'bytes[]' },
              { type: 'uint256' },
              { type: 'bytes' },
            ],
          },
        ],
        data
      )
      deadline = { seconds: value[3], inclusive: true }
    } catch {
      return malformed()
    }
  }
  // Gross desc.amount includes source fees. Do not compare the post-fee executor
  // amount, srcAmounts sum, or output-token affiliate fees to the user's input.
  if (desc.flags & 2n) return { deadline }
  const native = desc.srcToken.toLowerCase() === nativeToken
  assertTransactionValue(input.tx.value, native ? desc.amount : 0n)
  return { ...sourceCommitment(native ? zeroAddress : desc.srcToken, desc.amount), deadline }
}

const decodeThor = (input: Input): EvmSwapCommitment => {
  const decoded = decodeKnown(thorAbi, input.tx.data)
  if (!decoded) return {}
  const [, asset, amount, , expiration] = decoded.args
  const native = asset.toLowerCase() === zeroAddress
  if (!native) assertTransactionValue(input.tx.value, 0n)
  return {
    ...sourceCommitment(asset, native ? parseValue(input.tx.value) : amount),
    deadline: { seconds: expiration, inclusive: false },
  }
}

const decodeUniversal = (input: Input): EvmSwapCommitment => {
  const decoded = decodeKnown(universalAbi, input.tx.data)
  if (!decoded) return {}
  const [commands, inputs, expiration] = decoded.args
  const deadline = expiration === undefined ? undefined : { seconds: expiration, inclusive: true }
  const partial = { deadline }
  const ops = Array.from(hexToBytes(commands))
  if (ops.length !== inputs.length) return malformed()
  // A display decoder that skips commands or aggregates intermediate amounts is
  // not a spending proof. Only a single payer-funded exact-in leg is compared.
  // Exact-out, subplans, split/mixed routes and allow-revert legs keep the outer deadline.
  const wrapped = ops.length === 2 && ops[0] === 0x0b
  if (!(ops.length === 1 || wrapped)) return partial
  const index = wrapped ? 1 : 0
  const op = ops[index]
  if (op !== 0x00 && op !== 0x08) return partial
  try {
    const [, amount, , path, payerIsUser] =
      op === 0x08
        ? decodeAbiParameters(parseAbiParameters('address,uint256,uint256,address[],bool'), inputs[index])
        : decodeAbiParameters(parseAbiParameters('address,uint256,uint256,bytes,bool'), inputs[index])
    const source = typeof path === 'string' ? path.slice(0, 42) : path[0]
    if (!source || (typeof path === 'string' ? path.length < 88 : path.length < 2)) return partial
    if (wrapped) {
      const [recipient] = decodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], inputs[0])
      // WRAP_ETH may use CONTRACT_BALANCE. Its numeric sentinel is never the
      // user's input; the native funds leaving the wallet are exactly tx.value.
      if (
        payerIsUser ||
        ![input.tx.to.toLowerCase(), universalRouterAddressThis].includes(recipient.toLowerCase()) ||
        source.toLowerCase() !== ethereumWrappedEther
      )
        return partial
      return { ...sourceCommitment(zeroAddress, parseValue(input.tx.value)), deadline }
    }
    // V2 zero means ALREADY_PAID; V3's high bit means router balance. Neither
    // is a literal amount the wallet authorizes. Keep the independently known deadline.
    if (!payerIsUser || amount === 0n || amount === contractBalance) return partial
    if (parseValue(input.tx.value) !== 0n) return partial
    return { ...sourceCommitment(source, amount), deadline }
  } catch {
    // The outer deadline is still authoritative even if the inner format is unknown.
    return partial
  }
}

/**
 * Decode independently verifiable source commitments at known deployed routers.
 * This is intentionally partial, not an authenticity check or a generic calldata
 * interpreter. Unsupported layouts return no amount, retaining any known deadline.
 */
export const decodeEvmSwapCommitment = (input: Input): EvmSwapCommitment => {
  if (isKnownRouter('1inch', input)) return decodeOneInch(input)
  if (isKnownRouter('kyber', input)) return decodeKyber(input)
  if (input.chain === Chain.Ethereum) {
    const router = input.tx.to.toLowerCase()
    if (router === ethereumThorRouter) return decodeThor(input)
    if (router === ethereumUniversalRouter) return decodeUniversal(input)
  }
  return {}
}

/** Verify source-asset identity before comparing quantities with different units. */
export const assertEvmSwapSourceToken = (fromToken: string | undefined, commitment: EvmSwapCommitment): void => {
  const expected = fromToken ? fromToken.toLowerCase() : zeroAddress
  if (commitment.sourceToken !== undefined && commitment.sourceToken !== expected) {
    throw new Error('prepareSwapTxFromKeys: encoded EVM swap source token does not match the requested source asset')
  }
}
