/**
 * Wallet V5R1 (W5) contract helpers — address derivation + StateInit builder.
 *
 * Same discipline as `walletV4R2.ts`: just enough of the contract to derive
 * the address and deploy it on the first send, built on `@ton/core` only so
 * the RN bridge stays Hermes-safe. The code cell and data layout must match
 * WalletCore's `WALLET_V5R1_CODE` / `WalletV5R1::state_init_impl` byte for
 * byte — a different StateInit is a different address, and funds sent to it
 * are not ours.
 */
import type { StateInit } from '@ton/core'
import { Address, beginCell, Cell, contractAddress } from '@ton/core'

import type { TonV4R2Wallet } from './walletV4R2'

/**
 * Wallet V5R1 compiled code cell, base64. Extracted from the StateInit
 * WalletCore 4.7.0 emits for `WALLET_V5_R1` (code hash
 * 20834b7b72b112147e1b2fb457b84e74d1a30f04f737d4f62a668e9552d2b72f, the
 * published W5R1 mainnet code). Keep it copy-paste identical; do not reformat.
 */
const WALLET_V5R1_CODE_BASE64 =
  'te6cckECFAEAAoEAART/APSkE/S88sgLAQIBIAINAgFIAwQC3NAg10nBIJFbj2Mg1wsfIIIQZXh0br0hghBzaW50vbCSXwPgghBleHRuuo60gCDXIQHQdNch+kAw+kT4KPpEMFi9kVvg7UTQgQFB1yH0BYMH9A5voTGRMOGAQNchcH/bPOAxINdJgQKAuZEw4HDiEA8CASAFDAIBIAYJAgFuBwgAGa3OdqJoQCDrkOuF/8AAGa8d9qJoQBDrkOuFj8ACAUgKCwAXsyX7UTQcdch1wsfgABGyYvtRNDXCgCAAGb5fD2omhAgKDrkPoCwBAvIOAR4g1wsfghBzaWduuvLgin8PAeaO8O2i7fshgwjXIgKDCNcjIIAg1yHTH9Mf0x/tRNDSANMfINMf0//XCgAK+QFAzPkQmiiUXwrbMeHywIffArNQB7Dy0IRRJbry4IVQNrry4Ib4I7vy0IgikvgA3gGkf8jKAMsfAc8Wye1UIJL4D95w2zzYEAP27aLt+wL0BCFukmwhjkwCIdc5MHCUIccAs44tAdcoIHYeQ2wg10nACPLgkyDXSsAC8uCTINcdBscSwgBSMLDy0InXTNc5MAGk6GwShAe78uCT10rAAPLgk+1V4tIAAcAAkVvg69csCBQgkXCWAdcsCBwS4lIQseMPINdKERITAJYB+kAB+kT4KPpEMFi68uCR7UTQgQFB1xj0BQSdf8jKAEAEgwf0U/Lgi44UA4MH9Fvy4Iwi1woAIW4Bs7Dy0JDiyFADzxYS9ADJ7VQAcjDXLAgkji0h8uCS0gDtRNDSAFETuvLQj1RQMJExnAGBAUDXIdcKAPLgjuLIygBYzxbJ7VST8sCN4gAQk1vbMeHXTNC01sNe'

/**
 * W5R1 wallet id on mainnet: network global id (-239) XOR the client context
 * `1 | workchain 0 | version 0 | subwallet 0` (0x80000000) = 0x7FFFFF11.
 * WalletCore hardcodes this for `WALLET_V5_R1`, so it is the only id that can
 * be given an independent parity proof.
 */
export const TON_V5R1_WALLET_ID = 2147483409

let cachedV5R1CodeCell: Cell | undefined
/** Parsed lazily for the same Buffer-polyfill reason as the V4R2 code cell. */
function getWalletV5R1CodeCell(): Cell {
  if (!cachedV5R1CodeCell) {
    cachedV5R1CodeCell = Cell.fromBoc(Buffer.from(WALLET_V5R1_CODE_BASE64, 'base64'))[0]!
  }
  return cachedV5R1CodeCell
}

/**
 * Build the W5R1 data cell:
 *   is_signature_allowed(1)=1 || seqno(32)=0 || wallet_id(int32) || publicKey(256) || bit(0) (empty extensions dict)
 *
 * Must match WalletCore's `WalletV5R1::state_init_impl`.
 */
function buildV5R1DataCell(publicKey: Uint8Array, walletId: number): Cell {
  if (publicKey.length !== 32) {
    throw new Error(`TON Ed25519 pubkey must be 32 bytes, got ${publicKey.length}`)
  }
  return beginCell()
    .storeBit(true)
    .storeUint(0, 32)
    .storeInt(walletId, 32)
    .storeBuffer(Buffer.from(publicKey))
    .storeBit(false)
    .endCell()
}

/** Same view as a V4R2 wallet; the contract differs, the shape does not. */
export type TonV5R1Wallet = TonV4R2Wallet

/**
 * Construct a W5R1 wallet view (address + StateInit) for the given Ed25519
 * public key. Matches WalletCore's `WalletV5R1::with_public_key` byte for byte.
 */
export function buildV5R1Wallet(opts: {
  publicKeyEd25519: Uint8Array
  workchain?: number
  walletId?: number
}): TonV5R1Wallet {
  const workchain = opts.workchain ?? 0
  const walletId = opts.walletId ?? TON_V5R1_WALLET_ID
  const data = buildV5R1DataCell(opts.publicKeyEd25519, walletId)
  const init: StateInit = { code: getWalletV5R1CodeCell(), data }
  const address: Address = contractAddress(workchain, init)
  return {
    address,
    init,
    addressString: (o = {}) => address.toString({ bounceable: o.bounceable ?? false, testOnly: o.testOnly ?? false }),
    walletId,
  }
}
