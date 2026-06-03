import { CowSwapOrder } from './buildCowSwapOrder'
import { buildEip712Domain, Eip712Domain } from './buildEip712Domain'

/**
 * EIP-712 field descriptors for the CoW Protocol (GPv2) `Order` struct.
 *
 * This list — names, types AND order — is consensus-critical: it must match
 * `GPv2Order.TYPE_HASH` byte-for-byte or the orderbook rejects the signature.
 * The canonical definition lives in GPv2's `GPv2Order.sol`
 * (`Order(address sellToken,address buyToken,address receiver,uint256 sellAmount,
 * uint256 buyAmount,uint32 validTo,bytes32 appData,uint256 feeAmount,string kind,
 * bool partiallyFillable,string sellTokenBalance,string buyTokenBalance)`).
 *
 * NOTE: `kind`, `sellTokenBalance`, `buyTokenBalance` are EIP-712 `string`
 * fields (hashed as keccak256 of their utf-8 bytes), NOT enums — the
 * `'sell' | 'buy'` / `'erc20'` values flow through verbatim.
 */
export const cowSwapOrderEip712Fields = [
  { name: 'sellToken', type: 'address' },
  { name: 'buyToken', type: 'address' },
  { name: 'receiver', type: 'address' },
  { name: 'sellAmount', type: 'uint256' },
  { name: 'buyAmount', type: 'uint256' },
  { name: 'validTo', type: 'uint32' },
  { name: 'appData', type: 'bytes32' },
  { name: 'feeAmount', type: 'uint256' },
  { name: 'kind', type: 'string' },
  { name: 'partiallyFillable', type: 'bool' },
  { name: 'sellTokenBalance', type: 'string' },
  { name: 'buyTokenBalance', type: 'string' },
] as const

const eip712DomainFields = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
] as const

/** The EIP-712 message body for a GPv2 `Order`. `appData` is the bytes32 hash
 * of the appData JSON (NOT the JSON itself) — the orderbook re-derives and
 * verifies it against the submitted `appData` string. */
export type CowSwapOrderEip712Message = {
  sellToken: string
  buyToken: string
  receiver: string
  sellAmount: string
  buyAmount: string
  validTo: number
  appData: string
  feeAmount: string
  kind: string
  partiallyFillable: boolean
  sellTokenBalance: string
  buyTokenBalance: string
}

/** Self-contained EIP-712 typed-data document, ready to JSON-stringify and feed
 * to an `eth_signTypedData_v4` signer (the same shape WalletConnect / MetaMask
 * accept). Includes `EIP712Domain` in `types` for spec-completeness; signers
 * that build the domain separator separately simply omit it. */
export type CowSwapOrderTypedData = {
  primaryType: 'Order'
  domain: Eip712Domain
  types: {
    EIP712Domain: typeof eip712DomainFields
    Order: typeof cowSwapOrderEip712Fields
  }
  message: CowSwapOrderEip712Message
}

type BuildCowSwapOrderTypedDataInput = {
  order: CowSwapOrder
  chainId: number
}

/**
 * Build the `eth_signTypedData_v4` document for a CowSwap order.
 *
 * The resulting digest (EIP-712 hash of this document) is what the MPC ceremony
 * signs; the 65-byte `r||s||v` signature is submitted to the orderbook alongside
 * the order via `submitCowSwapOrder`. The order's `appDataHash` becomes the
 * signed `appData` field — the orderbook verifies it matches the `appData`
 * string in the submitted order.
 */
export const buildCowSwapOrderTypedData = ({
  order,
  chainId,
}: BuildCowSwapOrderTypedDataInput): CowSwapOrderTypedData => ({
  primaryType: 'Order',
  domain: buildEip712Domain(chainId),
  types: {
    EIP712Domain: eip712DomainFields,
    Order: cowSwapOrderEip712Fields,
  },
  message: {
    sellToken: order.sellToken,
    buyToken: order.buyToken,
    receiver: order.receiver,
    sellAmount: order.sellAmount,
    buyAmount: order.buyAmount,
    validTo: order.validTo,
    appData: order.appDataHash,
    feeAmount: order.feeAmount,
    kind: order.kind,
    partiallyFillable: order.partiallyFillable,
    sellTokenBalance: order.sellTokenBalance,
    buyTokenBalance: order.buyTokenBalance,
  },
})
