/**
 * Decoded intent extracted from a TON internal-message body BOC.
 *
 * Returned by `decodeTonMessageBody` when the body's leading opcode matches a
 * known operation. Addresses are user-friendly (bounceable, mainnet) strings
 * so they render directly in the UI without further conversion.
 */
export type TonMessageBodyIntent =
  | {
      kind: 'jettonTransfer'
      queryId: bigint
      /** Jetton units the sender is moving (in jetton's own decimals). */
      amount: bigint
      /** Real recipient of the jettons (NOT the jetton wallet contract). */
      destination: string
      /** Where excess TON gas is refunded to. May be null. */
      responseDestination: string | null
      /** TON forwarded with the inner notification to the recipient's jetton wallet. */
      forwardTonAmount: bigint
    }
  | {
      kind: 'nftTransfer'
      queryId: bigint
      /** Address that receives ownership of the NFT. */
      newOwner: string
      /** Where excess TON gas is refunded to. May be null. */
      responseDestination: string | null
      /** TON forwarded with the ownership-change notification. */
      forwardAmount: bigint
    }
  | {
      kind: 'excesses'
      queryId: bigint
    }
  | TonSwapIntent

export type TonSwapIntent = {
  kind: 'swap'
  provider: 'stonfi' | 'dedust'
  /** Asset being offered by the signed message. */
  offerAsset: 'ton' | 'jetton'
  /** Offered amount in the source asset's base units. */
  offerAmount: bigint
  /** Minimum output encoded in the swap payload, when the protocol exposes it. */
  minOut: bigint | null
  /** Final recipient, when encoded by the swap protocol. */
  receiverAddress: string | null
  /** Refund target, when encoded by the swap protocol. */
  refundAddress: string | null
  /** Excess gas target, when encoded by the swap protocol. */
  excessesAddress: string | null
  /** Protocol-side pool/token wallet that identifies the swap route. */
  targetAddress: string | null
}
