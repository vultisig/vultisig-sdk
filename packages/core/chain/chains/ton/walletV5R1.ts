import { Address, beginCell, Cell, contractAddress, StateInit } from '@ton/core'
import { Buffer } from 'buffer'

/**
 * Wallet V5R1 (W5) compiled code cell, base64 — the StateInit WalletCore 4.7
 * emits for `WALLET_V5_R1`, code hash
 * 20834b7b72b112147e1b2fb457b84e74d1a30f04f737d4f62a668e9552d2b72f, the
 * published W5R1 mainnet code. Keep it copy-paste identical; do not reformat.
 */
const walletV5R1CodeBase64 =
  'te6cckECFAEAAoEAART/APSkE/S88sgLAQIBIAINAgFIAwQC3NAg10nBIJFbj2Mg1wsfIIIQZXh0br0hghBzaW50vbCSXwPgghBleHRuuo60gCDXIQHQdNch+kAw+kT4KPpEMFi9kVvg7UTQgQFB1yH0BYMH9A5voTGRMOGAQNchcH/bPOAxINdJgQKAuZEw4HDiEA8CASAFDAIBIAYJAgFuBwgAGa3OdqJoQCDrkOuF/8AAGa8d9qJoQBDrkOuFj8ACAUgKCwAXsyX7UTQcdch1wsfgABGyYvtRNDXCgCAAGb5fD2omhAgKDrkPoCwBAvIOAR4g1wsfghBzaWduuvLgin8PAeaO8O2i7fshgwjXIgKDCNcjIIAg1yHTH9Mf0x/tRNDSANMfINMf0//XCgAK+QFAzPkQmiiUXwrbMeHywIffArNQB7Dy0IRRJbry4IVQNrry4Ib4I7vy0IgikvgA3gGkf8jKAMsfAc8Wye1UIJL4D95w2zzYEAP27aLt+wL0BCFukmwhjkwCIdc5MHCUIccAs44tAdcoIHYeQ2wg10nACPLgkyDXSsAC8uCTINcdBscSwgBSMLDy0InXTNc5MAGk6GwShAe78uCT10rAAPLgk+1V4tIAAcAAkVvg69csCBQgkXCWAdcsCBwS4lIQseMPINdKERITAJYB+kAB+kT4KPpEMFi68uCR7UTQgQFB1xj0BQSdf8jKAEAEgwf0U/Lgi44UA4MH9Fvy4Iwi1woAIW4Bs7Dy0JDiyFADzxYS9ADJ7VQAcjDXLAgkji0h8uCS0gDtRNDSAFETuvLQj1RQMJExnAGBAUDXIdcKAPLgjuLIygBYzxbJ7VST8sCN4gAQk1vbMeHXTNC01sNe'

/**
 * W5R1 wallet id on mainnet, as the contract stores it: the network's global
 * id (-239) XOR'd with the client context `1 | workchain 0 | version 0 |
 * subwallet 0` (0x80000000), giving 0x7FFFFF11. WalletCore hardcodes this
 * value for `WALLET_V5_R1`, so it is the only id that can be co-signed.
 */
export const tonV5R1WalletId = 2147483409

const baseWorkchain = 0

let cachedCodeCell: Cell | undefined
/** Parsed on first use: `Cell.fromBoc` needs the Buffer polyfill, which a React Native entry installs at startup. */
const getWalletV5R1CodeCell = (): Cell => {
  if (!cachedCodeCell) {
    const [cell] = Cell.fromBoc(Buffer.from(walletV5R1CodeBase64, 'base64'))
    if (!cell) {
      throw new Error('TON W5 code cell failed to parse')
    }
    cachedCodeCell = cell
  }
  return cachedCodeCell
}

type BuildTonV5R1StateInitInput = {
  /** The wallet's Ed25519 public key, 32 bytes. */
  publicKey: Uint8Array
  /** Defaults to the mainnet id WalletCore uses. */
  walletId?: number
}

/**
 * The W5R1 StateInit for a key: the published code cell plus the data cell
 * `is_signature_allowed(1)=1 || seqno(32)=0 || wallet_id(int32) || publicKey(256) || bit(0)`
 * (an empty extensions dictionary). Byte-identical to WalletCore's
 * `WalletV5R1::state_init_impl`, but built from `@ton/core` alone so it runs
 * wherever the key bytes are available — including React Native, whose native
 * WalletCore bridge has no `TONWallet`.
 */
export const buildTonV5R1StateInit = ({
  publicKey,
  walletId = tonV5R1WalletId,
}: BuildTonV5R1StateInitInput): StateInit => {
  if (publicKey.length !== 32) {
    throw new Error(`TON Ed25519 public key must be 32 bytes, got ${publicKey.length}`)
  }

  const data = beginCell()
    .storeBit(true)
    .storeUint(0, 32)
    .storeInt(walletId, 32)
    .storeBuffer(Buffer.from(publicKey))
    .storeBit(false)
    .endCell()

  return { code: getWalletV5R1CodeCell(), data }
}

/** The W5R1 wallet address (workchain 0) for a key: the hash of its StateInit. */
export const getTonV5R1Address = (input: BuildTonV5R1StateInitInput): Address =>
  contractAddress(baseWorkchain, buildTonV5R1StateInit(input))
