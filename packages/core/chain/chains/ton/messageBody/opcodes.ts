/**
 * TON internal-message body opcodes for the operations Vultisig surfaces in
 * keysign verify/done screens. The opcode is encoded as the first 32 bits of
 * the message body cell.
 *
 * Sources:
 *  - Jetton transfer: TEP-74 (https://github.com/ton-blockchain/TEPs/blob/master/text/0074-jettons-standard.md)
 *  - NFT transfer:    TEP-62 (https://github.com/ton-blockchain/TEPs/blob/master/text/0062-nft-standard.md)
 *  - Excesses:        TEP-74 (return-of-gas notification)
 *  - STON.fi v2 swap: https://docs.ston.fi/developer-section/api-reference-v2/ops
 *  - DeDust swaps:    https://docs.tact-lang.org/cookbook/dexes/dedust/
 */
export const TonOp = {
  JETTON_TRANSFER: 0x0f8a7ea5,
  NFT_TRANSFER: 0x5fcc3d14,
  EXCESSES: 0xd53276db,
  PTON_TRANSFER: 0x01f3835d,
  STONFI_V2_SWAP: 0x6664de2a,
  DEDUST_NATIVE_SWAP: 0xea06185d,
  DEDUST_JETTON_SWAP: 0xe3a0d482,
} as const

export type TonOp = (typeof TonOp)[keyof typeof TonOp]
