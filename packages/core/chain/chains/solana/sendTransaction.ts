import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { solanaRpcUrl } from './client'
import { solanaRpcTimeoutMs } from './rpcTimeout'

type SolanaRpcError = {
  code: number
  message: string
  data?: { err?: unknown; logs?: string[] | null }
}

type SendTransactionResponse = {
  result?: unknown
  error?: SolanaRpcError
}

const formatTransactionError = (err: unknown) => (typeof err === 'string' ? err : JSON.stringify(err))

/**
 * A `sendTransaction` call the node answered with a JSON-RPC error.
 *
 * On a preflight rejection the node's message is a fixed "Transaction
 * simulation failed" and the verdict lives in `data.err` (`BlockhashNotFound`,
 * `AccountNotFound`, an instruction error). `@solana/web3.js` drops that field,
 * so this names it in the message, where callers branch on it and users read
 * it. Program logs stay in `logs`, out of the message, so a program's own
 * output can never read as the node's verdict.
 */
export class SolanaSendTransactionError extends Error {
  readonly logs: string[]

  constructor({ message, data }: SolanaRpcError) {
    const err = data?.err
    super(err === undefined || err === null ? message : `${message}: ${formatTransactionError(err)}`)
    this.name = 'SolanaSendTransactionError'
    this.logs = data?.logs ?? []
  }
}

type SendSolanaTransactionInput = {
  rawTransaction: Uint8Array
  skipPreflight: boolean
  maxRetries: number
}

/**
 * Sends signed bytes to the Vultisig Solana RPC with the request
 * `Connection.sendRawTransaction` makes, and returns the signature the node
 * accepted. A rejection throws {@link SolanaSendTransactionError}, which keeps
 * the reason `web3.js` would discard.
 */
export const sendSolanaTransaction = async ({
  rawTransaction,
  skipPreflight,
  maxRetries,
}: SendSolanaTransactionInput): Promise<string> => {
  const { result, error } = await queryUrl<SendTransactionResponse>(solanaRpcUrl, {
    body: {
      jsonrpc: '2.0',
      id: 1,
      method: 'sendTransaction',
      params: [
        Buffer.from(rawTransaction).toString('base64'),
        {
          encoding: 'base64',
          maxRetries,
          // web3.js sends `processed` whenever preflight is skipped, as a
          // workaround for anza-xyz/agave#483; keep its request unchanged.
          ...(skipPreflight
            ? { skipPreflight, preflightCommitment: 'processed' }
            : { preflightCommitment: 'confirmed' }),
        },
      ],
    },
    timeoutMs: solanaRpcTimeoutMs,
  })

  if (error) {
    throw new SolanaSendTransactionError(error)
  }

  if (typeof result !== 'string') {
    throw new Error('Solana sendTransaction returned neither a signature nor an error')
  }

  return result
}
