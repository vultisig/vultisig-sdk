/**
 * VaultError and VaultErrorCode for structured error handling
 * Following the architecture rules for clear debugging
 */

export enum VaultErrorCode {
  InvalidConfig = 'INVALID_CONFIG',
  SigningFailed = 'SIGNING_FAILED',
  NotImplemented = 'NOT_IMPLEMENTED',
  AddressDerivationFailed = 'ADDRESS_DERIVATION_FAILED',
  WalletCoreNotInitialized = 'WALLET_CORE_NOT_INITIALIZED',
  UnsupportedChain = 'UNSUPPORTED_CHAIN',
  ChainNotSupported = 'CHAIN_NOT_SUPPORTED',
  NetworkError = 'NETWORK_ERROR',
  InvalidVault = 'INVALID_VAULT',
  InvalidPublicKey = 'INVALID_PUBLIC_KEY',
  InvalidChainCode = 'INVALID_CHAIN_CODE',
  BalanceFetchFailed = 'BALANCE_FETCH_FAILED',
  UnsupportedToken = 'UNSUPPORTED_TOKEN',
  GasEstimationFailed = 'GAS_ESTIMATION_FAILED',
  BroadcastFailed = 'BROADCAST_FAILED',
  CreateFailed = 'CREATE_FAILED',
  Timeout = 'TIMEOUT',
  /** Caller cancelled via AbortSignal */
  OperationAborted = 'OPERATION_ABORTED',
  InvalidAmount = 'INVALID_AMOUNT',
  /** Examples / IPC: vault id not present in local SDK store */
  VaultNotFound = 'VAULT_NOT_FOUND',
  /** Browser-only flows where `document` is unavailable */
  BrowserDocumentRequired = 'BROWSER_DOCUMENT_REQUIRED',
  /** User dismissed an in-page password prompt */
  PasswordEntryCancelled = 'PASSWORD_ENTRY_CANCELLED',
}

/**
 * Vault import error codes
 */
export enum VaultImportErrorCode {
  INVALID_FILE_FORMAT = 'INVALID_FILE_FORMAT',
  PASSWORD_REQUIRED = 'PASSWORD_REQUIRED',
  INVALID_PASSWORD = 'INVALID_PASSWORD',
  CORRUPTED_DATA = 'CORRUPTED_DATA',
  UNSUPPORTED_FORMAT = 'UNSUPPORTED_FORMAT',
}

export class VaultError extends Error {
  constructor(
    public code: VaultErrorCode,
    message: string,
    public originalError?: Error
  ) {
    super(message)
    this.name = 'VaultError'

    // Maintain proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, VaultError)
    }
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      stack: this.stack,
      originalError: this.originalError?.message,
    }
  }
}

/**
 * Vault import error class
 */
export class VaultImportError extends Error {
  constructor(
    public code: VaultImportErrorCode,
    message: string,
    public originalError?: Error
  ) {
    super(message)
    this.name = 'VaultImportError'
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      stack: this.stack,
      originalError: this.originalError?.message,
    }
  }
}
