import type { Chain, VaultBase, VaultIdentity } from '@vultisig/sdk'
import {
  assertSafeDestination,
  buildCw20TransferMsg,
  buildDelegateMsg,
  buildRedelegateMsg,
  buildSplTransfer,
  buildUndelegateMsg,
  buildWithdrawRewardsMsg,
  prepareContractCallTxFromKeys,
  prepareIbcTransfer,
  prepareJettonTransferTxFromKeys,
  preparePolkadotAssetSend,
  prepareSuiTokenTransferFromKeys,
  prepareTrc20TransferFromKeys,
} from '@vultisig/sdk'

import { InvalidInputError } from '../core/errors'
import { isJsonOutput, outputJson, printResult } from '../lib/output'

type JsonRecord = Record<string, unknown>

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const parseJson = (raw: string, label: string): unknown => {
  try {
    return JSON.parse(raw)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new InvalidInputError(`Invalid ${label} JSON: ${message}`)
  }
}

const parseJsonArray = (raw: string, label: string): readonly unknown[] => {
  const value = parseJson(raw, label)
  if (!Array.isArray(value)) {
    throw new InvalidInputError(`${label} must be a JSON array`)
  }
  return value
}

const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER)

const assertLosslessJsonNumberLexemes = (raw: string, label: string): void => {
  let inString = false
  let escaped = false

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        inString = false
      }
      continue
    }
    if (character === '"') {
      inString = true
      continue
    }
    if (character !== '-' && (character < '0' || character > '9')) continue

    const match = raw.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/)
    if (match === null) continue
    const lexeme = match[0]
    if (/[.eE]/.test(lexeme) || BigInt(lexeme) > MAX_SAFE_INTEGER || BigInt(lexeme) < -MAX_SAFE_INTEGER) {
      throw new InvalidInputError(
        `${label} numeric values must be safe base-10 integer literals; pass ABI integers as decimal strings`
      )
    }
    index += lexeme.length - 1
  }
}

const parseLosslessJsonArray = (raw: string, label: string): readonly unknown[] => {
  assertLosslessJsonNumberLexemes(raw, label)
  const value = parseJsonArray(raw, label)
  return value
}

const parseDecimalBigInt = (raw: string, label: string): bigint => {
  if (!/^-?\d+$/.test(raw)) {
    throw new InvalidInputError(`${label} must be a base-10 integer string`)
  }
  return BigInt(raw)
}

const parseInteger = (raw: string, label: string): number => {
  if (!/^-?\d+$/.test(raw)) {
    throw new InvalidInputError(`${label} must be an integer`)
  }
  const value = Number(raw)
  if (!Number.isSafeInteger(value)) {
    throw new InvalidInputError(`${label} must be a safe integer`)
  }
  return value
}

const parseOptionalInteger = (raw: string | undefined, label: string): number | undefined =>
  raw === undefined ? undefined : parseInteger(raw, label)

const parseIdentity = (raw: string): VaultIdentity => {
  const value = parseJson(raw, 'identity')
  if (!isRecord(value)) {
    throw new InvalidInputError('identity must be a JSON object')
  }

  const requiredStrings = ['ecdsaPublicKey', 'eddsaPublicKey', 'hexChainCode', 'localPartyId', 'libType'] as const
  for (const field of requiredStrings) {
    if (typeof value[field] !== 'string' || value[field].length === 0) {
      throw new InvalidInputError(`identity.${field} must be a non-empty string`)
    }
  }
  if (!['GG20', 'DKLS', 'KeyImport'].includes(value.libType as string)) {
    throw new InvalidInputError('identity.libType must be GG20, DKLS, or KeyImport')
  }
  if (value.chainPublicKeys !== undefined && !isRecord(value.chainPublicKeys)) {
    throw new InvalidInputError('identity.chainPublicKeys must be a JSON object when provided')
  }

  return value as VaultIdentity
}

const identityFromVault = (vault: VaultBase): VaultIdentity => ({
  ecdsaPublicKey: vault.publicKeys.ecdsa,
  eddsaPublicKey: vault.publicKeys.eddsa,
  hexChainCode: vault.hexChainCode,
  localPartyId: vault.localPartyId,
  libType: vault.libType as VaultIdentity['libType'],
  publicKeyMldsa: vault.publicKeyMldsa,
  chainPublicKeys: vault.data.chainPublicKeys,
})

const resolveIdentity = (vault: VaultBase | undefined, rawIdentity: string | undefined): VaultIdentity => {
  if (rawIdentity !== undefined) return parseIdentity(rawIdentity)
  if (vault !== undefined) return identityFromVault(vault)
  throw new InvalidInputError('An active vault or --identity JSON is required')
}

const stringify = (value: unknown): string =>
  JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item), 2)

const emitPrepResult = (helper: string, result: unknown): void => {
  const output = { helper, unsigned: true, result }
  if (isJsonOutput()) {
    outputJson(output)
  } else {
    printResult(stringify(output))
  }
}

export type PrepContractCallOptions = {
  abi: string
  args?: string
  value?: string
  sender: string
  gasLimit?: string
  maxPriorityFeePerGas?: string
  identity?: string
}

export async function executePrepContractCall(
  vault: VaultBase | undefined,
  chain: Chain,
  contractAddress: string,
  functionName: string,
  options: PrepContractCallOptions
): Promise<void> {
  const value = options.value === undefined ? undefined : parseDecimalBigInt(options.value, 'value')
  if (value !== undefined && value > 0n) {
    assertSafeDestination(chain, contractAddress)
  }

  const feeSettings =
    options.gasLimit !== undefined || options.maxPriorityFeePerGas !== undefined
      ? {
          gasLimit: parseDecimalBigInt(options.gasLimit ?? '', 'gas-limit'),
          maxPriorityFeePerGas: parseDecimalBigInt(options.maxPriorityFeePerGas ?? '', 'max-priority-fee-per-gas'),
        }
      : undefined

  const result = await prepareContractCallTxFromKeys(resolveIdentity(vault, options.identity), {
    chain,
    contractAddress,
    abi: parseJsonArray(options.abi, 'abi'),
    functionName,
    args: options.args === undefined ? undefined : parseLosslessJsonArray(options.args, 'args'),
    value,
    senderAddress: options.sender,
    feeSettings,
  })
  emitPrepResult('contract-call', result)
}

export type PrepIbcTransferOptions = {
  toChain?: string
  sourceChannel?: string
  timeoutHeight?: string
  timeoutTimestamp?: string
  accountNumber?: string
  sequence?: string
  memo?: string
  nowMs?: string
}

export function executePrepIbcTransfer(
  fromChain: string,
  fromAddress: string,
  toAddress: string,
  denom: string,
  amount: string,
  options: PrepIbcTransferOptions
): void {
  const result = prepareIbcTransfer({
    fromChain,
    fromAddress,
    toAddress,
    denom,
    amount,
    toChainId: options.toChain,
    sourceChannel: options.sourceChannel,
    timeoutHeight: options.timeoutHeight,
    timeoutTimestamp: options.timeoutTimestamp,
    accountNumber: options.accountNumber,
    sequence: options.sequence,
    memo: options.memo,
    nowMs: parseOptionalInteger(options.nowMs, 'now-ms'),
  })
  emitPrepResult('ibc-transfer', result)
}

export function executePrepSplTransfer(
  mint: string,
  from: string,
  to: string,
  amount: string,
  decimals: string,
  options: { token2022?: boolean }
): void {
  // Fund-safety: buildSplTransfer is a deliberate SDK escape hatch and does not
  // call assertSafeDestination itself (unlike prepareSendTxFromKeys). The CLI is
  // a user-facing entry point where a typo'd or pasted-from-Discord address
  // lands directly, so guard it here before building the instruction.
  assertSafeDestination('Solana', to)

  const result = buildSplTransfer({
    mint,
    from,
    to,
    amount: parseDecimalBigInt(amount, 'amount'),
    decimals: parseInteger(decimals, 'decimals'),
    isToken2022: options.token2022,
  })
  emitPrepResult('spl-transfer', result)
}

export function executePrepTrc20Transfer(
  contractAddress: string,
  from: string,
  to: string,
  amount: string,
  options: { memo?: string; feeLimitSun?: string }
): void {
  const result = prepareTrc20TransferFromKeys({
    contractAddress,
    from,
    to,
    amount,
    memo: options.memo,
    feeLimitSun: options.feeLimitSun,
  })
  emitPrepResult('trc20-transfer', result)
}

export type PrepJettonTransferOptions = {
  memo?: string
  validUntil?: string
  workchain?: string
  identity?: string
}

export function executePrepJettonTransfer(
  vault: VaultBase | undefined,
  receiver: string,
  jettonWalletAddress: string,
  amount: string,
  seqno: string,
  options: PrepJettonTransferOptions
): void {
  const built = prepareJettonTransferTxFromKeys(resolveIdentity(vault, options.identity), {
    receiver,
    jettonWalletAddress,
    amount: parseDecimalBigInt(amount, 'amount'),
    seqno: parseInteger(seqno, 'seqno'),
    memo: options.memo,
    validUntil: parseOptionalInteger(options.validUntil, 'valid-until'),
    workchain: parseOptionalInteger(options.workchain, 'workchain'),
  })
  const result = {
    signingHashHex: built.signingHashHex,
    unsignedBocHex: built.unsignedBocHex,
    fromAddress: built.fromAddress,
  }
  emitPrepResult('jetton-transfer', result)
}

export type PrepSuiTokenTransferOptions = {
  decimals?: string
  ticker?: string
  identity?: string
}

export async function executePrepSuiTokenTransfer(
  vault: VaultBase | undefined,
  coinType: string,
  from: string,
  to: string,
  amount: string,
  options: PrepSuiTokenTransferOptions
): Promise<void> {
  const result = await prepareSuiTokenTransferFromKeys(resolveIdentity(vault, options.identity), {
    coinType,
    from,
    to,
    amount: parseDecimalBigInt(amount, 'amount'),
    decimals: parseOptionalInteger(options.decimals, 'decimals'),
    ticker: options.ticker,
  })
  emitPrepResult('sui-token-transfer', result)
}

export function executePrepPolkadotAssetSend(
  assetId: string,
  from: string,
  to: string,
  amount: string,
  options: { decimals?: string; ticker?: string }
): void {
  const result = preparePolkadotAssetSend({
    assetId: parseInteger(assetId, 'asset-id'),
    from,
    to,
    amount: parseDecimalBigInt(amount, 'amount'),
    decimals: parseOptionalInteger(options.decimals, 'decimals'),
    ticker: options.ticker,
  })
  emitPrepResult('polkadot-asset-send', result)
}

export type PrepCosmosStakingOptions = {
  validatorDst?: string
  accountPrefix?: string
  validatorPrefix?: string
}

export function executePrepCosmosStaking(
  action: string,
  delegatorAddress: string,
  validatorAddress: string,
  amount: string | undefined,
  denom: string | undefined,
  options: PrepCosmosStakingOptions
): void {
  const prefixes = {
    accountPrefix: options.accountPrefix,
    validatorPrefix: options.validatorPrefix,
  }
  let result
  switch (action) {
    case 'delegate':
      if (amount === undefined || denom === undefined) {
        throw new InvalidInputError('delegate requires amount and denom')
      }
      result = buildDelegateMsg({
        delegatorAddress,
        validatorAddress,
        amount,
        denom,
        ...prefixes,
      })
      break
    case 'undelegate':
      if (amount === undefined || denom === undefined) {
        throw new InvalidInputError('undelegate requires amount and denom')
      }
      result = buildUndelegateMsg({
        delegatorAddress,
        validatorAddress,
        amount,
        denom,
        ...prefixes,
      })
      break
    case 'redelegate':
      if (amount === undefined || denom === undefined || options.validatorDst === undefined) {
        throw new InvalidInputError('redelegate requires amount, denom, and --validator-dst')
      }
      result = buildRedelegateMsg({
        delegatorAddress,
        validatorSrcAddress: validatorAddress,
        validatorDstAddress: options.validatorDst,
        amount,
        denom,
        ...prefixes,
      })
      break
    case 'withdraw':
      if (amount !== undefined || denom !== undefined) {
        throw new InvalidInputError('withdraw does not accept amount or denom')
      }
      result = buildWithdrawRewardsMsg({
        delegatorAddress,
        validatorAddress,
        ...prefixes,
      })
      break
    default:
      throw new InvalidInputError('staking action must be delegate, undelegate, redelegate, or withdraw')
  }
  emitPrepResult('cosmos-staking', result)
}

export function executePrepCw20Transfer(
  bech32Prefix: string,
  contract: string,
  recipient: string,
  amount: string,
  sender: string,
  options: { nativeDenoms?: string }
): void {
  const nativeDenoms = options.nativeDenoms
    ?.split(',')
    .map(value => value.trim())
    .filter(Boolean)
  const result = buildCw20TransferMsg({
    bech32Prefix,
    contract,
    recipient,
    amount,
    sender,
    nativeDenoms,
  })
  emitPrepResult('cw20-transfer', result)
}
