import type { AccountData, DirectSignResponse } from '@cosmjs/proto-signing';
import type { RujiraSigner, VultisigSignature, VultisigVault } from './types';

interface SignDoc {
  bodyBytes: Uint8Array;
  authInfoBytes: Uint8Array;
  chainId: string;
  accountNumber: bigint;
}

const THORCHAIN_CONFIG = {
  chain: 'THORChain' as const,
  ticker: 'RUNE',
  decimals: 8,
};

export class VultisigRujiraProvider implements RujiraSigner {
  private readonly vault: VultisigVault;
  private readonly chainId: string;
  private cachedAddress: string | null = null;
  private cachedChainPubKey: Uint8Array | null = null;

  constructor(vault: VultisigVault, chainId = 'thorchain-1') {
    this.vault = vault;
    this.chainId = chainId;
  }

  /**
   * Get the underlying VultisigVault for advanced operations
   * This is needed for operations that bypass SignDirect (e.g., MsgDeposit for withdrawals)
   */
  getVault(): VultisigVault {
    return this.vault;
  }

  /**
   * Get the THORChain-derived public key (not the master key!)
   * This requires preparing a dummy tx to extract the derived key from the SDK
   */
  private async getChainPublicKey(): Promise<Uint8Array> {
    if (this.cachedChainPubKey) {
      return this.cachedChainPubKey;
    }
    
    const address = await this.getAddress();
    
    // Prepare a dummy tx to get the chain-derived public key
    // The SDK returns the correct derived key in keysignPayload.coin.hexPublicKey
    const keysignPayload = await this.vault.prepareSignDirectTx({
      chain: THORCHAIN_CONFIG.chain,
      coin: {
        chain: THORCHAIN_CONFIG.chain,
        address,
        decimals: THORCHAIN_CONFIG.decimals,
        ticker: THORCHAIN_CONFIG.ticker,
      },
      // Dummy values - we just need the payload to extract the pubkey
      bodyBytes: Buffer.from('dummy').toString('base64'),
      authInfoBytes: Buffer.from('dummy').toString('base64'),
      chainId: this.chainId,
      accountNumber: '0',
    });
    
    const hexPubKey = (keysignPayload as any).coin?.hexPublicKey;
    if (!hexPubKey) {
      // Fallback to master key (will likely fail on broadcast)
      console.warn('VultisigRujiraProvider: Could not get chain-derived pubkey, using master key');
      return this.hexToBytes(this.vault.publicKeys.ecdsa);
    }
    
    this.cachedChainPubKey = this.hexToBytes(hexPubKey);
    return this.cachedChainPubKey;
  }

  async getAccounts(): Promise<readonly AccountData[]> {
    const address = await this.getAddress();
    const pubkey = await this.getChainPublicKey();
    return [{ address, pubkey, algo: 'secp256k1' }];
  }

  async signDirect(signerAddress: string, signDoc: SignDoc): Promise<DirectSignResponse> {
    const ourAddress = await this.getAddress();
    if (signerAddress !== ourAddress) {
      throw new Error(`Signer address mismatch: expected ${ourAddress}, got ${signerAddress}`);
    }
    if (signDoc.chainId !== this.chainId) {
      throw new Error(`Chain ID mismatch: expected ${this.chainId}, got ${signDoc.chainId}`);
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
    });

    const messageHashes = await this.vault.extractMessageHashes(keysignPayload);
    const signature = await this.vault.sign({
      transaction: keysignPayload,
      chain: THORCHAIN_CONFIG.chain,
      messageHashes,
    });

    // Normalize signature (convert DER to raw r+s if needed)
    const normalizedSig = this.normalizeSignature(signature);

    // Use the chain-derived public key from keysignPayload, NOT the master key
    // The keysignPayload.coin.hexPublicKey contains the THORChain-derived key
    const coinPubKey = (keysignPayload as any).coin?.hexPublicKey;
    const pubKey = coinPubKey 
      ? this.hexToBytes(coinPubKey)
      : this.getPublicKeyBytes(); // Fallback to master key (will fail on THORChain)
    
    return {
      signed: signDoc,
      signature: {
        pub_key: {
          type: 'tendermint/PubKeySecp256k1',
          value: Buffer.from(pubKey).toString('base64'),
        },
        signature: this.hexToBase64(normalizedSig),
      },
    };
  }

  /**
   * Convert DER signature to raw r+s format (64 bytes)
   * DER format: 0x30 [total-len] 0x02 [r-len] [r] 0x02 [s-len] [s]
   */
  private derToRaw(derHex: string): string {
    const der = this.hexToBytes(derHex);
    
    // Check DER prefix
    if (der[0] !== 0x30) {
      // Not DER format, assume it's already raw
      return derHex;
    }
    
    let offset = 2; // Skip 0x30 and length byte
    
    // Parse r
    if (der[offset] !== 0x02) throw new Error('Invalid DER: expected 0x02 for r');
    offset++;
    const rLen = der[offset++];
    let r = der.slice(offset, offset + rLen);
    offset += rLen;
    
    // Parse s
    if (der[offset] !== 0x02) throw new Error('Invalid DER: expected 0x02 for s');
    offset++;
    const sLen = der[offset++];
    let s = der.slice(offset, offset + sLen);
    
    // Remove leading zeros (DER uses variable length, we need fixed 32 bytes each)
    while (r.length > 32 && r[0] === 0) r = r.slice(1);
    while (s.length > 32 && s[0] === 0) s = s.slice(1);
    
    // Pad to 32 bytes if needed
    while (r.length < 32) r = new Uint8Array([0, ...r]);
    while (s.length < 32) s = new Uint8Array([0, ...s]);
    
    // Combine r + s (64 bytes total)
    const raw = new Uint8Array(64);
    raw.set(r, 0);
    raw.set(s, 32);
    
    return Buffer.from(raw).toString('hex');
  }

  /**
   * Validate and normalize signature format with stricter validation
   * Accepts DER or raw format, returns raw r+s format
   */
  private normalizeSignature(signature: VultisigSignature): string {
    if (!signature || typeof signature !== 'object') {
      throw new Error('Invalid signature: expected object, got ' + typeof signature);
    }

    if (!signature.signature || typeof signature.signature !== 'string') {
      throw new Error('Invalid signature: missing or invalid signature field');
    }

    let sig = signature.signature.trim();
    
    // Check for empty signature after trimming
    if (sig.length === 0) {
      throw new Error('Invalid signature: empty signature string');
    }
    
    // Strict hex format validation (with optional 0x prefix)
    const hexRegex = /^(0x)?[0-9a-fA-F]+$/;
    if (!hexRegex.test(sig)) {
      throw new Error('Invalid signature format: expected hex string, got non-hex characters');
    }

    // Remove 0x prefix
    sig = sig.startsWith('0x') ? sig.slice(2) : sig;
    
    // Check minimum length before processing
    if (sig.length < 128) {
      throw new Error(`Invalid signature length: too short, expected at least 128 hex chars, got ${sig.length}`);
    }
    
    // Check maximum reasonable length (DER shouldn't exceed 144 chars typically)
    if (sig.length > 200) {
      throw new Error(`Invalid signature length: too long, got ${sig.length} hex chars`);
    }
    
    // Convert DER to raw if needed
    if (sig.length > 130) {
      try {
        sig = this.derToRaw(sig);
      } catch (error) {
        throw new Error(`Failed to convert DER signature to raw format: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    // Strict final length validation (only 128 or 130 chars allowed)
    if (sig.length !== 128 && sig.length !== 130) {
      throw new Error(
        `Invalid signature length: expected exactly 128 or 130 hex chars, got ${sig.length}`
      );
    }
    
    // Validate r and s values are not zero (would be invalid ECDSA signature)
    const rHex = sig.slice(0, 64);
    const sHex = sig.slice(64, 128);
    
    if (rHex === '0'.repeat(64) || sHex === '0'.repeat(64)) {
      throw new Error('Invalid signature: r or s value is zero');
    }
    
    // Validate r and s are within valid secp256k1 curve range
    // secp256k1 order: 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
    const secp256k1Order = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
    const r = BigInt('0x' + rHex);
    const s = BigInt('0x' + sHex);
    
    if (r >= secp256k1Order || s >= secp256k1Order) {
      throw new Error('Invalid signature: r or s value exceeds secp256k1 curve order');
    }
    
    // Return just r+s (128 chars), strip recovery byte if present
    return sig.slice(0, 128);
  }

  async getAddress(): Promise<string> {
    if (this.cachedAddress === null) {
      this.cachedAddress = await this.vault.address(THORCHAIN_CONFIG.chain);
    }
    return this.cachedAddress;
  }

  getPublicKeyBytes(): Uint8Array {
    return this.hexToBytes(this.vault.publicKeys.ecdsa);
  }

  getPublicKeyHex(): string {
    return this.vault.publicKeys.ecdsa;
  }

  getChainId(): string {
    return this.chainId;
  }

  clearCache(): void {
    this.cachedAddress = null;
  }

  async signAndBroadcast(signDoc: SignDoc): Promise<string> {
    const address = await this.getAddress();
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
    });

    const messageHashes = await this.vault.extractMessageHashes(keysignPayload);
    const signature = await this.vault.sign({
      transaction: keysignPayload,
      chain: THORCHAIN_CONFIG.chain,
      messageHashes,
    });

    return this.vault.broadcastTx({
      chain: THORCHAIN_CONFIG.chain,
      keysignPayload,
      signature,
    });
  }

  private hexToBytes(hex: string): Uint8Array {
    const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
    const bytes = new Uint8Array(cleanHex.length / 2);
    for (let i = 0; i < cleanHex.length; i += 2) {
      bytes[i / 2] = parseInt(cleanHex.slice(i, i + 2), 16);
    }
    return bytes;
  }

  private hexToBase64(hex: string): string {
    return Buffer.from(this.hexToBytes(hex)).toString('base64');
  }

  private uint8ArrayToBase64(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('base64');
  }
}

export function createMockSigner(address: string, pubKeyHex?: string): RujiraSigner {
  const pubKey = pubKeyHex
    ? new Uint8Array(Buffer.from(pubKeyHex.replace('0x', ''), 'hex'))
    : new Uint8Array(33);

  return {
    async getAccounts() {
      return [{ address, pubkey: pubKey, algo: 'secp256k1' as const }];
    },
    async signDirect() {
      throw new Error('Mock signer cannot sign transactions');
    },
  };
}

export function isVultisigVault(vault: unknown): vault is VultisigVault {
  if (!vault || typeof vault !== 'object') return false;
  const v = vault as Record<string, unknown>;
  return (
    typeof v.address === 'function' &&
    typeof v.publicKeys === 'object' &&
    v.publicKeys !== null &&
    typeof (v.publicKeys as Record<string, unknown>).ecdsa === 'string' &&
    typeof v.prepareSignDirectTx === 'function' &&
    typeof v.extractMessageHashes === 'function' &&
    typeof v.sign === 'function'
  );
}
