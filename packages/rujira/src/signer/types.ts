import type {
  OfflineDirectSigner,
  AccountData,
  DirectSignResponse
} from '@cosmjs/proto-signing';

type SignDoc = Parameters<OfflineDirectSigner['signDirect']>[1];

export interface RujiraSigner extends OfflineDirectSigner {
  getAccounts(): Promise<readonly AccountData[]>;
  signDirect(signerAddress: string, signDoc: SignDoc): Promise<DirectSignResponse>;
}

export type VultisigChain = 'THORChain' | 'MayaChain' | string;

export interface VultisigSignature {
  signature: string;
  recovery?: number;
  format: 'DER' | 'ECDSA' | 'EdDSA' | 'Ed25519';
}

/**
 * Keysign payload structure for MPC signing
 * 
 * This matches the protobuf KeysignPayload schema from vultisig/keysign/v1.
 * The payload is cross-platform compatible (iOS, Android, Windows, SDK).
 */
export interface KeysignPayload {
  /** Coin information - the asset being transacted */
  coin?: {
    chain: string;
    ticker: string;
    address: string;
    contractAddress: string;
    decimals: number;
    priceProviderId: string;
    isNativeToken: boolean;
    hexPublicKey: string;
    logo: string;
  };
  
  /** Destination address (empty for MsgDeposit) */
  toAddress?: string;
  
  /** Amount in base units */
  toAmount?: string;
  
  /** Blockchain-specific parameters */
  blockchainSpecific?: {
    case: 'thorchainSpecific' | 'utxoSpecific' | 'ethereumSpecific' | 'cosmosSpecific' | string | undefined;
    value?: {
      // THORChain specific fields
      accountNumber?: bigint;
      sequence?: bigint;
      fee?: bigint;
      isDeposit?: boolean;
      transactionType?: number;
      // Other chains have different fields
      [key: string]: unknown;
    };
  };
  
  /** Transaction memo */
  memo?: string;
  
  /** UTXO inputs (for Bitcoin-like chains) */
  utxoInfo?: unknown[];
  
  /** Swap payload (for THORChain/Maya swaps) */
  swapPayload?: { case: string | undefined; value?: unknown };
  
  /** Contract payload (for WASM/EVM contracts) */
  contractPayload?: { case: string | undefined; value?: unknown };
  
  /** Sign data (SignAmino, SignDirect, SignSolana) */
  signData?: { case: string | undefined; value?: unknown };
  
  /** Vault's ECDSA public key */
  vaultPublicKeyEcdsa?: string;
  
  /** Local party ID for MPC */
  vaultLocalPartyId?: string;
  
  /** MPC library type (GG20 or DKLS) */
  libType?: string;
  
  /** Skip broadcast after signing */
  skipBroadcast?: boolean;
  
  /** Allow additional fields for extensibility */
  [key: string]: unknown;
}

export interface SignDirectInput {
  chain: VultisigChain;
  coin: {
    chain: VultisigChain;
    address: string;
    decimals: number;
    ticker: string;
  };
  bodyBytes: string;
  authInfoBytes: string;
  chainId: string;
  accountNumber: string;
  memo?: string;
}

export interface SigningPayload {
  transaction: KeysignPayload;
  chain: VultisigChain;
  messageHashes: string[];
}

export interface VultisigVault {
  address(chain: VultisigChain): Promise<string>;
  readonly publicKeys: {
    readonly ecdsa: string;
    readonly eddsa: string;
  };
  prepareSignDirectTx(
    input: SignDirectInput,
    options?: { skipChainSpecificFetch?: boolean }
  ): Promise<KeysignPayload>;
  extractMessageHashes(keysignPayload: KeysignPayload): Promise<string[]>;
  sign(
    payload: SigningPayload,
    options?: { signal?: AbortSignal }
  ): Promise<VultisigSignature>;
  broadcastTx(params: {
    chain: VultisigChain;
    keysignPayload: KeysignPayload;
    signature: VultisigSignature;
  }): Promise<string>;
}

export interface ExtendedAccountData extends AccountData {
  accountNumber?: number;
  sequence?: number;
}

export interface SigningResult {
  signedTxBytes: Uint8Array;
  signature: Uint8Array;
  pubKey: Uint8Array;
}
