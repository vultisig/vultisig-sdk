/**
 * Error types for Rujira SDK
 * @module errors
 */

/**
 * Error codes for Rujira operations
 */
export enum RujiraErrorCode {
  // Network errors
  NETWORK_ERROR = 'NETWORK_ERROR',
  RPC_ERROR = 'RPC_ERROR',
  TIMEOUT = 'TIMEOUT',
  NOT_CONNECTED = 'NOT_CONNECTED',
  
  // Validation errors
  INVALID_ASSET = 'INVALID_ASSET',
  INVALID_AMOUNT = 'INVALID_AMOUNT',
  INVALID_ADDRESS = 'INVALID_ADDRESS',
  INVALID_PAIR = 'INVALID_PAIR',
  INVALID_SLIPPAGE = 'INVALID_SLIPPAGE',
  
  // Balance errors
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  INSUFFICIENT_GAS = 'INSUFFICIENT_GAS',
  
  // Swap errors
  NO_ROUTE = 'NO_ROUTE',
  SLIPPAGE_EXCEEDED = 'SLIPPAGE_EXCEEDED',
  QUOTE_EXPIRED = 'QUOTE_EXPIRED',
  PRICE_IMPACT_TOO_HIGH = 'PRICE_IMPACT_TOO_HIGH',
  
  // Order errors
  ORDER_NOT_FOUND = 'ORDER_NOT_FOUND',
  INVALID_PRICE = 'INVALID_PRICE',
  MIN_ORDER_SIZE = 'MIN_ORDER_SIZE',
  ORDER_ALREADY_FILLED = 'ORDER_ALREADY_FILLED',
  
  // Transaction errors
  SIGNING_FAILED = 'SIGNING_FAILED',
  BROADCAST_FAILED = 'BROADCAST_FAILED',
  TX_FAILED = 'TX_FAILED',
  TX_NOT_FOUND = 'TX_NOT_FOUND',
  
  // Contract errors
  CONTRACT_NOT_FOUND = 'CONTRACT_NOT_FOUND',
  CONTRACT_ERROR = 'CONTRACT_ERROR',
  
  // Configuration errors
  INVALID_CONFIG = 'INVALID_CONFIG',
  MISSING_SIGNER = 'MISSING_SIGNER',
}

/**
 * Base error class for Rujira SDK
 */
export class RujiraError extends Error {
  /** Error code for programmatic handling */
  public readonly code: RujiraErrorCode;
  /** Additional error details */
  public readonly details?: unknown;
  /** Whether this error is retryable */
  public readonly retryable: boolean;

  constructor(
    code: RujiraErrorCode,
    message: string,
    details?: unknown,
    retryable = false
  ) {
    super(message);
    this.name = 'RujiraError';
    this.code = code;
    this.details = details;
    this.retryable = retryable;
    
    // Maintain proper stack trace (Node.js specific)
    if (typeof (Error as any).captureStackTrace === 'function') {
      (Error as any).captureStackTrace(this, RujiraError);
    }
  }

  /**
   * Create a user-friendly error message
   */
  toUserMessage(): string {
    return USER_FRIENDLY_MESSAGES[this.code] || this.message;
  }

  /**
   * Convert to JSON for logging
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
      retryable: this.retryable,
      stack: this.stack,
    };
  }
}

/**
 * User-friendly error messages
 */
const USER_FRIENDLY_MESSAGES: Record<RujiraErrorCode, string> = {
  [RujiraErrorCode.NETWORK_ERROR]: 'Network connection failed. Please check your internet connection.',
  [RujiraErrorCode.RPC_ERROR]: 'Failed to communicate with the blockchain. Please try again.',
  [RujiraErrorCode.TIMEOUT]: 'Request timed out. Please try again.',
  [RujiraErrorCode.NOT_CONNECTED]: 'Not connected to the network. Please connect first.',
  
  [RujiraErrorCode.INVALID_ASSET]: 'Invalid asset. Please check the asset identifier.',
  [RujiraErrorCode.INVALID_AMOUNT]: 'Invalid amount. Please enter a valid number.',
  [RujiraErrorCode.INVALID_ADDRESS]: 'Invalid address format.',
  [RujiraErrorCode.INVALID_PAIR]: 'Trading pair not found or not supported.',
  [RujiraErrorCode.INVALID_SLIPPAGE]: 'Invalid slippage tolerance. Must be between 0.01% and 50%.',
  
  [RujiraErrorCode.INSUFFICIENT_BALANCE]: 'Insufficient balance for this transaction.',
  [RujiraErrorCode.INSUFFICIENT_GAS]: 'Insufficient RUNE for gas fees.',
  
  [RujiraErrorCode.NO_ROUTE]: 'No swap route available for this pair.',
  [RujiraErrorCode.SLIPPAGE_EXCEEDED]: 'Price moved too much. Try increasing slippage tolerance.',
  [RujiraErrorCode.QUOTE_EXPIRED]: 'Quote expired. Please get a new quote.',
  [RujiraErrorCode.PRICE_IMPACT_TOO_HIGH]: 'Price impact is too high. Consider reducing the amount.',
  
  [RujiraErrorCode.ORDER_NOT_FOUND]: 'Order not found.',
  [RujiraErrorCode.INVALID_PRICE]: 'Invalid order price.',
  [RujiraErrorCode.MIN_ORDER_SIZE]: 'Order size is below the minimum.',
  [RujiraErrorCode.ORDER_ALREADY_FILLED]: 'Order has already been filled.',
  
  [RujiraErrorCode.SIGNING_FAILED]: 'Failed to sign the transaction.',
  [RujiraErrorCode.BROADCAST_FAILED]: 'Failed to broadcast the transaction.',
  [RujiraErrorCode.TX_FAILED]: 'Transaction failed on chain.',
  [RujiraErrorCode.TX_NOT_FOUND]: 'Transaction not found.',
  
  [RujiraErrorCode.CONTRACT_NOT_FOUND]: 'Contract not found at the specified address.',
  [RujiraErrorCode.CONTRACT_ERROR]: 'Contract execution failed.',
  
  [RujiraErrorCode.INVALID_CONFIG]: 'Invalid configuration.',
  [RujiraErrorCode.MISSING_SIGNER]: 'No signer provided. Connect a wallet first.',
};

/**
 * Retryable error codes
 */
const RETRYABLE_ERRORS = new Set([
  RujiraErrorCode.NETWORK_ERROR,
  RujiraErrorCode.RPC_ERROR,
  RujiraErrorCode.TIMEOUT,
]);

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof RujiraError) {
    return error.retryable || RETRYABLE_ERRORS.has(error.code);
  }
  return false;
}

/**
 * Wrap an error in RujiraError
 */
export function wrapError(error: unknown, defaultCode = RujiraErrorCode.NETWORK_ERROR): RujiraError {
  if (error instanceof RujiraError) {
    return error;
  }
  
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    
    // Detect specific error types from message
    if (message.includes('insufficient funds') || message.includes('insufficient balance')) {
      return new RujiraError(
        RujiraErrorCode.INSUFFICIENT_BALANCE,
        error.message,
        error
      );
    }
    
    if (message.includes('timeout') || message.includes('timed out')) {
      return new RujiraError(
        RujiraErrorCode.TIMEOUT,
        error.message,
        error,
        true
      );
    }
    
    if (message.includes('slippage') || message.includes('min_return')) {
      return new RujiraError(
        RujiraErrorCode.SLIPPAGE_EXCEEDED,
        error.message,
        error
      );
    }
    
    return new RujiraError(defaultCode, error.message, error);
  }
  
  return new RujiraError(
    defaultCode,
    String(error),
    error
  );
}
