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

export interface KeysignPayload {
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
