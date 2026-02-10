import type { AccountData, DirectSignResponse } from '@cosmjs/proto-signing'

import { base64Encode, bytesToBase64, hexEncode } from '../utils/encoding.js'
import type { RujiraSigner, VultisigSignature, VultisigVault } from './types.js'

type SignDoc = {
  bodyBytes: Uint8Array
  authInfoBytes: Uint8Array
  chainId: string
  accountNumber: bigint
}

const THORCHAIN_CONFIG = {
  chain: 'THORChain' as const,
  ticker: 'RUNE',
  decimals: 8,
}

export class VultisigRujiraProvider implements RujiraSigner {
  private readonly vault: VultisigVault
  private readonly chainId: string
  private cachedAddress: string | null = null
  private cachedChainPubKey: Uint8Array | null = null

  constructor(vault: VultisigVault, chainId = 'thorchain-1') {
    this.vault = vault
    this.chainId = chainId
  }

  getVault(): VultisigVault {
    return this.vault
  }

  private async getChainPublicKey(): Promise<Uint8Array> {
    if (this.cachedChainPubKey) {
      return this.cachedChainPubKey
    }

    const address = await this.getAddress()

    const keysignPayload = await this.vault.prepareSignDirectTx({
      chain: THORCHAIN_CONFIG.chain,
      coin: {
        chain: THORCHAIN_CONFIG.chain,
        address,
        decimals: THORCHAIN_CONFIG.decimals,
        ticker: THORCHAIN_CONFIG.ticker,
      },
      bodyBytes: base64Encode('dummy'),
      authInfoBytes: base64Encode('dummy'),
      chainId: this.chainId,
      accountNumber: '0',
    })

    const hexPubKey = keysignPayload.coin?.hexPublicKey
    if (!hexPubKey) {
      throw new Error(
        `VultisigRujiraProvider: Could not derive public key for chain ${THORCHAIN_CONFIG.chain}. Verify vault supports this chain.`
      )
    }

    this.cachedChainPubKey = this.hexToBytes(hexPubKey)
    return this.cachedChainPubKey
  }

  async getAccounts(): Promise<readonly AccountData[]> {
    const address = await this.getAddress()
    const pubkey = await this.getChainPublicKey()
    return [{ address, pubkey, algo: 'secp256k1' }]
  }

  async signDirect(signerAddress: string, signDoc: SignDoc): Promise<DirectSignResponse> {
    const ourAddress = await this.getAddress()
    if (signerAddress !== ourAddress) {
      throw new Error(`Signer address mismatch: expected ${ourAddress}, got ${signerAddress}`)
    }
    if (signDoc.chainId !== this.chainId) {
      throw new Error(`Chain ID mismatch: expected ${this.chainId}, got ${signDoc.chainId}`)
    }

    const keysignPayload = await this.vault.prepareSignDirectTx({
      chain: THORCHAIN_CONFIG.chain,
      coin: {
        chain: THORCHAIN_CONFIG.chain,
        address: ourAddress,
        decimals: THORCHAIN_CONFIG.decimals,
        ticker: THORCHAIN_CONFIG.ticker,
      },
      bodyBytes: this.uint8ArrayToBase64(signDoc.bodyBytes),
      authInfoBytes: this.uint8ArrayToBase64(signDoc.authInfoBytes),
      chainId: signDoc.chainId,
      accountNumber: signDoc.accountNumber.toString(),
    })

    const messageHashes = await this.vault.extractMessageHashes(keysignPayload)
    const signature = await this.vault.sign({
      transaction: keysignPayload,
      chain: THORCHAIN_CONFIG.chain,
      messageHashes,
    })

    const normalizedSig = this.normalizeSignature(signature)

    const coinPubKey = keysignPayload.coin?.hexPublicKey
    if (!coinPubKey) {
      throw new Error(`VultisigRujiraProvider: Missing public key in signed payload for ${THORCHAIN_CONFIG.chain}`)
    }
    const pubKey = this.hexToBytes(coinPubKey)

    return {
      signed: signDoc,
      signature: {
        pub_key: {
          type: 'tendermint/PubKeySecp256k1',
          value: bytesToBase64(pubKey),
        },
        signature: this.hexToBase64(normalizedSig),
      },
    }
  }

  private derToRaw(derHex: string): string {
    const der = this.hexToBytes(derHex)

    if (der[0] !== 0x30) {
      return derHex
    }

    let offset = 2

    if (der[offset] !== 0x02) throw new Error('Invalid DER: expected 0x02 for r')
    offset++
    const rLen = der[offset++]
    let r = der.slice(offset, offset + rLen)
    offset += rLen

    if (der[offset] !== 0x02) throw new Error('Invalid DER: expected 0x02 for s')
    offset++
    const sLen = der[offset++]
    let s = der.slice(offset, offset + sLen)

    while (r.length > 32 && r[0] === 0) r = r.slice(1)
    while (s.length > 32 && s[0] === 0) s = s.slice(1)

    while (r.length < 32) r = new Uint8Array([0, ...r])
    while (s.length < 32) s = new Uint8Array([0, ...s])

    const raw = new Uint8Array(64)
    raw.set(r, 0)
    raw.set(s, 32)

    return hexEncode(raw)
  }

  private normalizeSignature(signature: VultisigSignature): string {
    if (!signature || typeof signature !== 'object') {
      throw new Error('Invalid signature: expected object, got ' + typeof signature)
    }

    if (!signature.signature || typeof signature.signature !== 'string') {
      throw new Error('Invalid signature: missing or invalid signature field')
    }

    let sig = signature.signature.trim()

    // Check for empty signature after trimming
    if (sig.length === 0) {
      throw new Error('Invalid signature: empty signature string')
    }

    const hexRegex = /^(0x)?[0-9a-fA-F]+$/
    if (!hexRegex.test(sig)) {
      throw new Error('Invalid signature format: expected hex string, got non-hex characters')
    }

    sig = sig.startsWith('0x') ? sig.slice(2) : sig

    if (sig.length < 128) {
      throw new Error(`Invalid signature length: too short, expected at least 128 hex chars, got ${sig.length}`)
    }

    if (sig.length > 200) {
      throw new Error(`Invalid signature length: too long, got ${sig.length} hex chars`)
    }

    if (sig.length > 130) {
      try {
        sig = this.derToRaw(sig)
      } catch (error) {
        throw new Error(
          `Failed to convert DER signature to raw format: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }

    if (sig.length !== 128 && sig.length !== 130) {
      throw new Error(`Invalid signature length: expected exactly 128 or 130 hex chars, got ${sig.length}`)
    }

    const rHex = sig.slice(0, 64)
    const sHex = sig.slice(64, 128)

    if (rHex === '0'.repeat(64) || sHex === '0'.repeat(64)) {
      throw new Error('Invalid signature: r or s value is zero')
    }

    const secp256k1Order = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141')
    const r = BigInt('0x' + rHex)
    const s = BigInt('0x' + sHex)

    if (r >= secp256k1Order || s >= secp256k1Order) {
      throw new Error('Invalid signature: r or s value exceeds secp256k1 curve order')
    }

    return sig.slice(0, 128)
  }

  async getAddress(): Promise<string> {
    if (this.cachedAddress === null) {
      this.cachedAddress = await this.vault.address(THORCHAIN_CONFIG.chain)
    }
    return this.cachedAddress
  }

  getPublicKeyBytes(): Uint8Array {
    return this.hexToBytes(this.vault.publicKeys.ecdsa)
  }

  getPublicKeyHex(): string {
    return this.vault.publicKeys.ecdsa
  }

  getChainId(): string {
    return this.chainId
  }

  clearCache(): void {
    this.cachedAddress = null
  }

  async signAndBroadcast(signDoc: SignDoc): Promise<string> {
    const address = await this.getAddress()
    const keysignPayload = await this.vault.prepareSignDirectTx({
      chain: THORCHAIN_CONFIG.chain,
      coin: {
        chain: THORCHAIN_CONFIG.chain,
        address,
        decimals: THORCHAIN_CONFIG.decimals,
        ticker: THORCHAIN_CONFIG.ticker,
      },
      bodyBytes: this.uint8ArrayToBase64(signDoc.bodyBytes),
      authInfoBytes: this.uint8ArrayToBase64(signDoc.authInfoBytes),
      chainId: signDoc.chainId,
      accountNumber: signDoc.accountNumber.toString(),
    })

    const messageHashes = await this.vault.extractMessageHashes(keysignPayload)
    const signature = await this.vault.sign({
      transaction: keysignPayload,
      chain: THORCHAIN_CONFIG.chain,
      messageHashes,
    })

    return this.vault.broadcastTx({
      chain: THORCHAIN_CONFIG.chain,
      keysignPayload,
      signature,
    })
  }

  private hexToBytes(hex: string): Uint8Array {
    const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex
    const bytes = new Uint8Array(cleanHex.length / 2)
    for (let i = 0; i < cleanHex.length; i += 2) {
      bytes[i / 2] = parseInt(cleanHex.slice(i, i + 2), 16)
    }
    return bytes
  }

  private hexToBase64(hex: string): string {
    return bytesToBase64(this.hexToBytes(hex))
  }

  private uint8ArrayToBase64(bytes: Uint8Array): string {
    return bytesToBase64(bytes)
  }
}

export function isVultisigVault(vault: unknown): vault is VultisigVault {
  if (!vault || typeof vault !== 'object') return false
  const v = vault as Record<string, unknown>
  return (
    typeof v.address === 'function' &&
    typeof v.publicKeys === 'object' &&
    v.publicKeys !== null &&
    typeof (v.publicKeys as Record<string, unknown>).ecdsa === 'string' &&
    typeof v.prepareSignDirectTx === 'function' &&
    typeof v.extractMessageHashes === 'function' &&
    typeof v.sign === 'function'
  )
}
