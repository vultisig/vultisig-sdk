/**
 * Wallet V4R2 contract helpers — address derivation + StateInit builder.
 *
 * This module inlines just enough of `@ton/ton`'s WalletContractV4 to let
 * the RN bridge derive a TON address and attach a StateInit to the first
 * transfer (when seqno === 0). We do NOT import `@ton/ton` because its
 * top-level index.js pulls `MultisigOrder` / `testUtils`, which pull
 * `@ton/crypto`. Going through `@ton/core` directly is Hermes-safe.
 *
 * The wallet V4R2 code cell is baked into the Vultisig-iOS / Vultisig-Windows
 * signing flow and must match byte-for-byte with the reference
 * implementation — any difference means the derived address changes and
 * funds stop flowing.
 */
import type { StateInit } from '@ton/core'
import { Address, beginCell, Cell, contractAddress, storeStateInit } from '@ton/core'

/**
 * Wallet V4R2 compiled code cell, base64. This is the exact string baked
 * into `@ton/ton@14.x` at `dist/wallets/v4/WalletContractV4.js` line 29.
 * Keep it copy-paste identical; do not reformat.
 */
const WALLET_V4R2_CODE_BASE64 =
  'te6ccgECFAEAAtQAART/APSkE/S88sgLAQIBIAIDAgFIBAUE+PKDCNcYINMf0x/THwL4I7vyZO1E0NMf0x/T//QE0VFDuvKhUVG68qIF+QFUEGT5EPKj+AAkpMjLH1JAyx9SMMv/UhD0AMntVPgPAdMHIcAAn2xRkyDXSpbTB9QC+wDoMOAhwAHjACHAAuMAAcADkTDjDQOkyMsfEssfy/8QERITAubQAdDTAyFxsJJfBOAi10nBIJJfBOAC0x8hghBwbHVnvSKCEGRzdHK9sJJfBeAD+kAwIPpEAcjKB8v/ydDtRNCBAUDXIfQEMFyBAQj0Cm+hMbOSXwfgBdM/yCWCEHBsdWe6kjgw4w0DghBkc3RyupJfBuMNBgcCASAICQB4AfoA9AQw+CdvIjBQCqEhvvLgUIIQcGx1Z4MesXCAGFAEywUmzxZY+gIZ9ADLaRfLH1Jgyz8gyYBA+wAGAIpQBIEBCPRZMO1E0IEBQNcgyAHPFvQAye1UAXKwjiOCEGRzdHKDHrFwgBhQBcsFUAPPFiP6AhPLassfyz/JgED7AJJfA+ICASAKCwBZvSQrb2omhAgKBrkPoCGEcNQICEekk30pkQzmkD6f+YN4EoAbeBAUiYcVnzGEAgFYDA0AEbjJftRNDXCx+AA9sp37UTQgQFA1yH0BDACyMoHy//J0AGBAQj0Cm+hMYAIBIA4PABmtznaiaEAga5Drhf/AABmvHfaiaEAQa5DrhY/AAG7SB/oA1NQi+QAFyMoHFcv/ydB3dIAYyMsFywIizxZQBfoCFMtrEszMyXP7AMhAFIEBCPRR8qcCAHCBAQjXGPoA0z/IVCBHgQEI9FHyp4IQbm90ZXB0gBjIywXLAlAGzxZQBPoCFMtqEssfyz/Jc/sAAgBsgQEI1xj6ANM/MFIkgQEI9Fnyp4IQZHN0cnB0gBjIywXLAlAFzxZQA/oCE8tqyx8Syz/Jc/sAAAr0AMntVA=='

/** Sub-wallet ID for V4R2 on workchain=0. Matches @ton/ton default. */
export const TON_V4R2_SUB_WALLET_ID = 698983191

/**
 * Decoded V4R2 code cell. Parsed once at module-init so `contractAddress` and
 * `storeStateInit` see the same instance across tx builds (avoids recomputing
 * the cell's repr hash).
 */
const WALLET_V4R2_CODE_CELL = Cell.fromBoc(Buffer.from(WALLET_V4R2_CODE_BASE64, 'base64'))[0]

/**
 * Build the V4R2 data cell:
 *   seqno(32) || subWalletId(32) || publicKey(256) || bit(0) (empty plugins dict)
 *
 * Must match the encoding in `@ton/ton`'s WalletContractV4 constructor.
 */
function buildV4R2DataCell(publicKey: Uint8Array, walletId: number): Cell {
  if (publicKey.length !== 32) {
    throw new Error(`TON Ed25519 pubkey must be 32 bytes, got ${publicKey.length}`)
  }
  return beginCell().storeUint(0, 32).storeUint(walletId, 32).storeBuffer(Buffer.from(publicKey)).storeBit(0).endCell()
}

export type TonV4R2Wallet = {
  address: Address
  init: StateInit
  /** Convenience: address rendered with the passed bounceable/testOnly flags. */
  addressString: (opts?: { bounceable?: boolean; testOnly?: boolean }) => string
  /** Wallet id (subwallet + workchain) used in signing payloads. */
  walletId: number
}

/**
 * Construct a V4R2 wallet view (address + StateInit) for the given Ed25519
 * public key on the given workchain. Matches
 * `WalletContractV4.create({ workchain, publicKey })` byte-for-byte.
 */
export function buildV4R2Wallet(opts: {
  publicKeyEd25519: Uint8Array
  workchain?: number
  walletId?: number
}): TonV4R2Wallet {
  const workchain = opts.workchain ?? 0
  const walletId = opts.walletId ?? TON_V4R2_SUB_WALLET_ID + workchain
  const data = buildV4R2DataCell(opts.publicKeyEd25519, walletId)
  const init: StateInit = { code: WALLET_V4R2_CODE_CELL, data }
  const address = contractAddress(workchain, init)
  return {
    address,
    init,
    addressString: (o = {}) => address.toString({ bounceable: o.bounceable ?? false, testOnly: o.testOnly ?? false }),
    walletId,
  }
}

/**
 * Serialize a StateInit to a Cell — handy when the caller wants to attach
 * it as a ref to the wallet's external message (seqno === 0 deploys).
 */
export function storeStateInitCell(init: StateInit): Cell {
  return beginCell().store(storeStateInit(init)).endCell()
}
