import { Chain, type EvmChain } from '@vultisig/core-chain/Chain'
import { getChainKind } from '@vultisig/core-chain/ChainKind'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { formatUnits } from 'viem'

import type { Token } from '../types'
import { resolveChainReference } from '../utils/resolveChainReference'
import { parseThorSwapMemo } from '../utils/thorSwapMemo'
import { resolveTokenRef } from '../vault/tokenRef'

export type TxReadyObject = Record<string, unknown>

export type TxReadyTxArgs = TxReadyObject & {
  chain?: string
  chain_id?: string | number
  tx_encoding?: string
  to?: string
  amount?: string
  memo?: string
  msg_type?: string
  tx?: TxReadyObject
}

/**
 * Wire-level transaction envelope accepted from backend `tx_ready` events or
 * `execute_*` preparation tool output.
 *
 * The backend may add presentation metadata over time, so unknown fields stay
 * available to consumers while the signing-relevant fields are typed here.
 */
export type TxReadyEnvelope = TxReadyObject & {
  sequence?: number
  sequence_id?: string
  sequence_index?: number
  sequence_total?: number
  chain?: string
  chain_id?: string | number
  from_chain?: string
  action?: string
  signing_mode?: string
  unsigned_tx_hex?: string
  tx_details?: TxReadyObject
  keysign_payload?: string
  swap_tx?: TxReadyObject
  send_tx?: TxReadyObject
  tx?: TxReadyObject
  approvalTxArgs?: TxReadyTxArgs
  txArgs?: TxReadyTxArgs
  resolved?: {
    labels?: Record<string, unknown>
  }
  stepperConfig?: TxReadyObject
  __buildTx?: boolean
}

export type TxReadyEvmLeg = {
  role: 'single' | 'approval' | 'main'
  txArgs: TxReadyTxArgs | undefined
  tx: TxReadyObject
}

export type ParsedTxReadyRawEvm = {
  kind: 'raw-evm'
  chain: EvmChain
  legs: [TxReadyEvmLeg] | [TxReadyEvmLeg, TxReadyEvmLeg]
  envelope: TxReadyEnvelope
}

export type ParsedTxReadySend = {
  kind: 'send'
  chain: Chain
  to: string
  /** Human-unit decimal amount suitable for `VaultBase.send`. */
  amount: string
  symbol?: string
  memo?: string
  envelope: TxReadyEnvelope
}

export type ParsedTxReadyThorSwapDeposit = {
  kind: 'thor-swap-deposit'
  chain: typeof Chain.THORChain | typeof Chain.MayaChain
  fromSymbol: 'RUNE' | 'CACAO'
  toChain: Chain
  toSymbol: string
  amount: string
  recipient?: string
  memo: string
  envelope: TxReadyEnvelope
}

export type ParsedTxReadyThorLpDeposit = {
  kind: 'thor-lp-deposit'
  chain: typeof Chain.THORChain | typeof Chain.MayaChain
  amountBaseUnits: string
  memo: string
  envelope: TxReadyEnvelope
}

/** Canonical, execution-oriented interpretation of a tx-ready wire envelope. */
export type ParsedTxReadyEnvelope =
  | ParsedTxReadyRawEvm
  | ParsedTxReadySend
  | ParsedTxReadyThorSwapDeposit
  | ParsedTxReadyThorLpDeposit

export type TxReadyParseErrorCode =
  | 'INVALID_ENVELOPE'
  | 'UNKNOWN_CHAIN'
  | 'CHAIN_MISMATCH'
  | 'INVALID_AMOUNT'
  | 'UNSUPPORTED_ENVELOPE'
  | 'UNSUPPORTED_DEPOSIT'

export class TxReadyParseError extends Error {
  override readonly name = 'TxReadyParseError'

  constructor(
    readonly code: TxReadyParseErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
  }
}

export type ParseTxReadyOptions = {
  /** Consumer-owned fallback for legacy envelopes that omit chain metadata. */
  defaultChain?: Chain
  /** Vault-configured tokens used to resolve non-native send decimals. */
  tokens?: Token[]
}

const MAX_AMOUNT_DIGITS = 26

const isObject = (value: unknown): value is TxReadyObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asEnvelope = (value: unknown): TxReadyEnvelope => {
  if (!isObject(value)) {
    throw new TxReadyParseError('INVALID_ENVELOPE', 'tx_ready payload must be a JSON object')
  }
  return value as TxReadyEnvelope
}

const resolveReference = (value: unknown): Chain | undefined => {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  return resolveChainReference(value)
}

const resolveObjectChain = (value: TxReadyObject | undefined, context: string): Chain | undefined => {
  if (!value) return undefined
  const candidates = (['chain', 'from_chain', 'chain_id'] as const).flatMap(key => {
    const reference = value[key]
    if (reference === undefined) return []
    const resolved = resolveReference(reference)
    if (!resolved) {
      throw new TxReadyParseError(
        'UNKNOWN_CHAIN',
        `${context} contains an unrecognized ${key} reference '${String(reference)}'`
      )
    }
    return [[key, resolved] as [string, Chain]]
  })
  const chain = candidates[0]?.[1]
  const mismatch = candidates.find(([, candidate]) => candidate !== chain)
  if (chain && mismatch) {
    throw new TxReadyParseError(
      'CHAIN_MISMATCH',
      `${context} chain references disagree: ${candidates.map(([key, candidate]) => `${key}=${candidate}`).join(', ')}`
    )
  }
  return chain
}

const resolveTransactionChain = (tx: TxReadyObject | undefined, context: string): Chain | undefined => {
  const reference = tx?.['chainId']
  if (reference === undefined) return undefined
  const chain = resolveReference(reference)
  if (!chain) {
    throw new TxReadyParseError(
      'UNKNOWN_CHAIN',
      `${context} contains an unrecognized chainId reference '${String(reference)}'`
    )
  }
  return chain
}

const extractRawTx = (
  envelope: TxReadyEnvelope
): { tx: TxReadyObject; txArgs: TxReadyTxArgs | undefined } | undefined => {
  const candidates: Array<{ value: unknown; txArgs: TxReadyTxArgs | undefined }> = [
    { value: envelope.swap_tx, txArgs: undefined },
    { value: envelope.send_tx, txArgs: undefined },
    { value: envelope.tx, txArgs: undefined },
    { value: envelope.txArgs?.tx, txArgs: envelope.txArgs },
  ]
  const candidate = candidates.find(({ value }) => isObject(value))
  return candidate ? { tx: candidate.value as TxReadyObject, txArgs: candidate.txArgs } : undefined
}

const resolveEnvelopeChain = (envelope: TxReadyEnvelope, defaultChain?: Chain): Chain => {
  const outerChain = resolveObjectChain(envelope, 'tx_ready envelope')
  const innerChain = resolveObjectChain(envelope.txArgs, 'tx_ready txArgs')
  const nestedChain = extractRawTx(envelope)
  const txChain = resolveTransactionChain(nestedChain?.tx, 'tx_ready transaction')

  if (outerChain && innerChain && outerChain !== innerChain) {
    throw new TxReadyParseError(
      'CHAIN_MISMATCH',
      `tx_ready envelope chain '${outerChain}' disagrees with txArgs chain '${innerChain}'`
    )
  }

  const metadataChain = outerChain ?? innerChain
  if (metadataChain && txChain && metadataChain !== txChain) {
    throw new TxReadyParseError(
      'CHAIN_MISMATCH',
      `tx_ready metadata chain '${metadataChain}' disagrees with transaction chainId '${txChain}'`
    )
  }

  const chain = metadataChain ?? txChain ?? defaultChain
  if (!chain) {
    throw new TxReadyParseError('UNKNOWN_CHAIN', 'tx_ready envelope is missing a recognized chain reference')
  }
  return chain
}

const assertAmount = (amountRaw: unknown, chain: Chain, context: string): string => {
  if (typeof amountRaw !== 'string' || amountRaw.length === 0) {
    throw new TxReadyParseError('INVALID_ENVELOPE', `${context}: missing 'amount' field for ${chain}`)
  }
  if (!/^\d+$/.test(amountRaw)) {
    throw new TxReadyParseError(
      'INVALID_AMOUNT',
      `${context}: failed to convert amount '${amountRaw}' for ${chain}: value must be an unsigned base-10 integer string`
    )
  }
  if (amountRaw.length > MAX_AMOUNT_DIGITS) {
    throw new TxReadyParseError(
      'INVALID_AMOUNT',
      `${context}: amount '${amountRaw}' for ${chain} exceeds ${MAX_AMOUNT_DIGITS}-digit safety bound. Likely a quote-side bug. Refusing to sign.`
    )
  }
  return amountRaw
}

const toDecimalAmount = (amountRaw: unknown, chain: Chain, context: string, decimals?: number): string => {
  const amount = assertAmount(amountRaw, chain, context)
  const resolvedDecimals = decimals ?? chainFeeCoin[chain]?.decimals
  if (resolvedDecimals === undefined) {
    throw new TxReadyParseError('UNKNOWN_CHAIN', `${context}: no native decimals registered for ${chain}`)
  }
  try {
    return formatUnits(BigInt(amount), resolvedDecimals)
  } catch (error) {
    throw new TxReadyParseError(
      'INVALID_AMOUNT',
      `${context}: failed to convert amount '${amount}' for ${chain}: ${(error as Error).message}`,
      { cause: error }
    )
  }
}

const parseThorDeposit = (
  envelope: TxReadyEnvelope,
  chain: typeof Chain.THORChain | typeof Chain.MayaChain,
  txArgs: TxReadyTxArgs
): ParsedTxReadyThorSwapDeposit | ParsedTxReadyThorLpDeposit => {
  const memo = typeof txArgs.memo === 'string' ? txArgs.memo : ''

  if (memo.startsWith('=:')) {
    let parsedMemo: ReturnType<typeof parseThorSwapMemo>
    try {
      parsedMemo = parseThorSwapMemo(memo)
    } catch (error) {
      const code = isObject(error) && error['code'] === 'UNSUPPORTED_CHAIN' ? 'UNKNOWN_CHAIN' : 'INVALID_ENVELOPE'
      throw new TxReadyParseError(code, (error as Error).message, { cause: error })
    }
    if (/\s/.test(parsedMemo.destAddress)) {
      throw new TxReadyParseError(
        'INVALID_ENVELOPE',
        `tx_ready THOR swap destination address in memo '${memo}' must not contain whitespace`
      )
    }

    return {
      kind: 'thor-swap-deposit',
      chain,
      fromSymbol: chain === Chain.THORChain ? 'RUNE' : 'CACAO',
      toChain: parsedMemo.toChain,
      toSymbol: parsedMemo.destAsset,
      amount: toDecimalAmount(txArgs.amount, chain, 'tx_ready THOR swap deposit'),
      ...(parsedMemo.destAddress && { recipient: parsedMemo.destAddress }),
      memo,
      envelope,
    }
  }

  if (memo.startsWith('+:') || memo.startsWith('-:')) {
    return {
      kind: 'thor-lp-deposit',
      chain,
      amountBaseUnits: assertAmount(txArgs.amount, chain, 'tx_ready THOR LP deposit'),
      memo,
      envelope,
    }
  }

  throw new TxReadyParseError(
    'UNSUPPORTED_DEPOSIT',
    `tx_ready MsgDeposit memo prefix not supported on ${chain}: '${memo}'. Supported prefixes: '=:' (swap), '+:' (LP add), '-:' (LP remove). Loan / validator ops are out of scope.`
  )
}

const assertRawTransaction = (tx: TxReadyObject, context: string): void => {
  if (tx['status'] === 'error' || tx['error']) {
    throw new TxReadyParseError(
      'INVALID_ENVELOPE',
      `${context} reports an error: ${String(tx['error'] ?? 'unknown error')}`
    )
  }
  if (typeof tx['to'] !== 'string' || tx['to'] === '') {
    throw new TxReadyParseError('INVALID_ENVELOPE', `${context} is missing required 'to' field`)
  }
}

const parseRawEvm = (envelope: TxReadyEnvelope, chain: Chain): ParsedTxReadyRawEvm => {
  if (getChainKind(chain) !== 'evm') {
    throw new TxReadyParseError(
      'UNSUPPORTED_ENVELOPE',
      `tx_ready raw transaction envelope resolved to non-EVM chain ${chain}`
    )
  }

  const approvalArgs = isObject(envelope.approvalTxArgs) ? (envelope.approvalTxArgs as TxReadyTxArgs) : undefined
  const mainArgs = isObject(envelope.txArgs) ? (envelope.txArgs as TxReadyTxArgs) : undefined

  if (approvalArgs && mainArgs) {
    const approvalChain = resolveObjectChain(approvalArgs, 'tx_ready approvalTxArgs')
    const mainChain = resolveObjectChain(mainArgs, 'tx_ready txArgs')
    if (!approvalChain || !mainChain || approvalChain !== mainChain || approvalChain !== chain) {
      throw new TxReadyParseError(
        'CHAIN_MISMATCH',
        `tx_ready multi-leg chain mismatch: parent=${chain}, approval=${approvalChain ?? 'unresolved'}, main=${mainChain ?? 'unresolved'}`
      )
    }
    if (!isObject(approvalArgs.tx) || !isObject(mainArgs.tx)) {
      throw new TxReadyParseError('INVALID_ENVELOPE', 'tx_ready multi-leg envelope requires tx objects in both legs')
    }
    assertRawTransaction(approvalArgs.tx, 'tx_ready approval transaction')
    assertRawTransaction(mainArgs.tx, 'tx_ready main transaction')
    const approvalTxChain = resolveTransactionChain(approvalArgs.tx, 'tx_ready approval transaction')
    const mainTxChain = resolveTransactionChain(mainArgs.tx, 'tx_ready main transaction')
    if ((approvalTxChain && approvalTxChain !== chain) || (mainTxChain && mainTxChain !== chain)) {
      throw new TxReadyParseError(
        'CHAIN_MISMATCH',
        `tx_ready multi-leg transaction chain mismatch: parent=${chain}, approval=${approvalTxChain ?? 'unspecified'}, main=${mainTxChain ?? 'unspecified'}`
      )
    }
    return {
      kind: 'raw-evm',
      chain: chain as EvmChain,
      legs: [
        { role: 'approval', txArgs: approvalArgs, tx: approvalArgs.tx },
        { role: 'main', txArgs: mainArgs, tx: mainArgs.tx },
      ],
      envelope,
    }
  }

  const raw = extractRawTx(envelope)
  if (!raw) {
    throw new TxReadyParseError('INVALID_ENVELOPE', 'tx_ready raw EVM envelope is missing a transaction object')
  }
  assertRawTransaction(raw.tx, 'tx_ready raw EVM transaction')

  return {
    kind: 'raw-evm',
    chain: chain as EvmChain,
    legs: [{ role: 'single', txArgs: raw.txArgs, tx: raw.tx }],
    envelope,
  }
}

/**
 * Parse a backend `tx_ready` or `execute_*` preparation envelope into the
 * canonical execution shape consumed by SDK clients.
 *
 * This function is pure and vault-free. It validates chain continuity,
 * converts send/swap base units exactly, and never signs or broadcasts.
 */
export const parseTxReadyEnvelope = (value: unknown, options: ParseTxReadyOptions = {}): ParsedTxReadyEnvelope => {
  const envelope = asEnvelope(value)
  const chain = resolveEnvelopeChain(envelope, options.defaultChain)
  const txArgs = isObject(envelope.txArgs) ? (envelope.txArgs as TxReadyTxArgs) : undefined

  if (txArgs?.msg_type === 'deposit' && (chain === Chain.THORChain || chain === Chain.MayaChain)) {
    return parseThorDeposit(envelope, chain, txArgs)
  }

  const hasMultiLeg = isObject(envelope.approvalTxArgs) && isObject(envelope.txArgs)
  if (hasMultiLeg || extractRawTx(envelope)) {
    return parseRawEvm(envelope, chain)
  }

  const sendArgs = txArgs ?? envelope
  const to = typeof sendArgs['to'] === 'string' ? sendArgs['to'] : undefined
  if (!to) {
    throw new TxReadyParseError('INVALID_ENVELOPE', `tx_ready send envelope missing 'to' field for ${chain}`)
  }

  const tokenResolved = envelope.resolved?.labels?.['token_resolved']
  const nativeTicker = chainFeeCoin[chain]?.ticker
  const symbol =
    typeof tokenResolved === 'string' && tokenResolved.toUpperCase() !== nativeTicker?.toUpperCase()
      ? tokenResolved
      : undefined
  const memo = typeof sendArgs['memo'] === 'string' && sendArgs['memo'].length > 0 ? sendArgs['memo'] : undefined

  let decimals: number | undefined
  if (symbol) {
    try {
      decimals = resolveTokenRef(chain, symbol, options.tokens ?? []).decimals
    } catch (error) {
      throw new TxReadyParseError(
        'INVALID_ENVELOPE',
        `tx_ready send: token decimals unavailable for '${symbol}' on ${chain}`,
        { cause: error }
      )
    }
  }

  return {
    kind: 'send',
    chain,
    to,
    amount: toDecimalAmount(sendArgs['amount'], chain, 'tx_ready send', decimals),
    ...(symbol && { symbol }),
    ...(memo && { memo }),
    envelope,
  }
}
