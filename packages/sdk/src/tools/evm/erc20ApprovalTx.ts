import { EvmChain } from '@vultisig/core-chain/Chain'
import { getEvmChainId } from '@vultisig/core-chain/chains/evm/chainInfo'
import { getEvmClient } from '@vultisig/core-chain/chains/evm/client'
import { erc20Abi, getAddress, isAddress } from 'viem'

import { encodeErc20Approve, MAX_UINT256 } from './encodeErc20Approve'

export const DEFAULT_MAX_APPROVAL_TO_BALANCE_RATIO = 100n

export type Erc20ApprovalAmountMode = 'max' | 'revoke' | 'specific'

export type Erc20ApprovalTxEnvelope = {
  chain: EvmChain
  chain_id: string
  to: `0x${string}`
  value: '0'
  data: `0x${string}`
  spender: `0x${string}`
  amount: string
  is_unlimited: boolean
}

export type NormalizedErc20Approval = {
  chain: EvmChain
  chainId: string
  tokenAddress: `0x${string}`
  spender: `0x${string}`
  amountBaseUnits: bigint
  amount: string
  amountMode: Erc20ApprovalAmountMode
  amountIsBaseUnits: boolean
  decimals?: number
  isUnlimited: boolean
  isRevoke: boolean
}

export type BuildErc20ApprovalTxResult = {
  tx: Erc20ApprovalTxEnvelope
  approval: NormalizedErc20Approval
}

export type ParseErc20ApprovalAmountParams = {
  amount: string
  decimals?: number
  amountIsBaseUnits?: boolean
}

export type ParseErc20ApprovalAmountResult = {
  amountBaseUnits: bigint
  amountMode: Erc20ApprovalAmountMode
  amountIsBaseUnits: boolean
  decimals?: number
}

export type Erc20ApprovalValidationHooks = {
  hasCode?: (input: { chain: EvmChain; address: `0x${string}`; role: 'token' | 'spender' }) => Promise<boolean>
  readDecimals?: (input: { chain: EvmChain; tokenAddress: `0x${string}` }) => Promise<number>
  readBalance?: (input: { chain: EvmChain; tokenAddress: `0x${string}`; owner: `0x${string}` }) => Promise<bigint>
}

export type Erc20ApprovalValidationOptions = {
  hooks?: Erc20ApprovalValidationHooks
  checkTokenCode?: boolean
  checkSpenderCode?: boolean
  checkBalanceBound?: boolean
  failOpenOnCodeCheckError?: boolean
  failOpenOnBalanceCheckError?: boolean
  maxApprovalToBalanceRatio?: bigint
}

export type BuildErc20ApprovalTxParams = {
  chain: EvmChain
  contractAddress: string
  spender: string
  amount: string
  amountIsBaseUnits?: boolean
  owner?: string
  from?: string
  validation?: Erc20ApprovalValidationOptions
}

const assertAddress = (label: string, value: string): `0x${string}` => {
  if (!isAddress(value, { strict: false })) {
    throw new Error(`invalid ${label}: ${value}`)
  }

  return getAddress(value)
}

const assertOptionalAddress = (label: string, value: string | undefined): `0x${string}` | undefined => {
  if (value === undefined) {
    return undefined
  }

  return assertAddress(label, value)
}

const assertDecimals = (decimals: number): number => {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error(`token decimals must be a non-negative integer: ${decimals}`)
  }

  return decimals
}

const parseHumanTokenAmount = (amount: string, decimals: number): bigint => {
  const trimmed = amount.trim()
  if (trimmed === '') {
    throw new Error('empty amount')
  }
  if (trimmed.startsWith('-')) {
    throw new Error('negative amounts not allowed')
  }

  const dotIdx = trimmed.indexOf('.')
  let wholePart: string
  let fracPart: string
  if (dotIdx === -1) {
    wholePart = trimmed
    fracPart = ''
  } else {
    wholePart = trimmed.slice(0, dotIdx)
    fracPart = trimmed.slice(dotIdx + 1)
    if (fracPart.includes('.')) {
      throw new Error(`invalid amount: multiple decimal points in ${amount}`)
    }
  }

  if (wholePart === '') {
    wholePart = '0'
  }
  if (!/^[0-9]+$/.test(wholePart)) {
    throw new Error(`invalid integer part: ${wholePart}`)
  }
  if (fracPart.length > 0 && !/^[0-9]+$/.test(fracPart)) {
    throw new Error(`invalid fractional part: ${fracPart}`)
  }
  if (fracPart.length > decimals && /[1-9]/.test(fracPart.slice(decimals))) {
    throw new Error(`amount has more precision than token decimals (${decimals}): ${amount}`)
  }

  const normalizedFrac = fracPart.slice(0, decimals).padEnd(decimals, '0')
  const wholeInt = BigInt(wholePart)
  const fracInt = normalizedFrac === '' ? 0n : BigInt(normalizedFrac)

  return wholeInt * 10n ** BigInt(decimals) + fracInt
}

export const parseErc20ApprovalAmount = ({
  amount,
  decimals,
  amountIsBaseUnits = false,
}: ParseErc20ApprovalAmountParams): ParseErc20ApprovalAmountResult => {
  const amountStr = amount.trim()
  const lower = amountStr.toLowerCase()

  if (lower === 'max') {
    return {
      amountBaseUnits: MAX_UINT256,
      amountMode: 'max',
      amountIsBaseUnits: false,
    }
  }

  if (lower === '0') {
    return {
      amountBaseUnits: 0n,
      amountMode: 'revoke',
      amountIsBaseUnits: false,
    }
  }

  if (amountIsBaseUnits) {
    if (!/^[0-9]+$/.test(amountStr)) {
      throw new Error(
        `amount_is_base_units=true requires a plain non-negative integer string (e.g. "5000000"): ${JSON.stringify(amount)}`
      )
    }

    return {
      amountBaseUnits: BigInt(amountStr),
      amountMode: 'specific',
      amountIsBaseUnits: true,
    }
  }

  if (decimals === undefined) {
    throw new Error('token decimals are required for human-readable approval amounts')
  }

  const checkedDecimals = assertDecimals(decimals)

  return {
    amountBaseUnits: parseHumanTokenAmount(amountStr, checkedDecimals),
    amountMode: 'specific',
    amountIsBaseUnits: false,
    decimals: checkedDecimals,
  }
}

const readDefaultHasCode = async (chain: EvmChain, address: `0x${string}`): Promise<boolean> => {
  const bytecode = await getEvmClient(chain).getBytecode({ address })
  return bytecode !== undefined && bytecode !== '0x'
}

const readDefaultDecimals = async (chain: EvmChain, tokenAddress: `0x${string}`): Promise<number> => {
  const decimals = await getEvmClient(chain).readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'decimals',
  })

  return assertDecimals(Number(decimals))
}

const readDefaultBalance = async (
  chain: EvmChain,
  tokenAddress: `0x${string}`,
  owner: `0x${string}`
): Promise<bigint> => {
  return getEvmClient(chain).readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [owner],
  })
}

const runCodeCheck = async (
  chain: EvmChain,
  address: `0x${string}`,
  role: 'token' | 'spender',
  validation: Erc20ApprovalValidationOptions
): Promise<void> => {
  const hasCode =
    validation.hooks?.hasCode ??
    ((input: { chain: EvmChain; address: `0x${string}` }) => readDefaultHasCode(input.chain, input.address))

  let hasBytecode: boolean
  try {
    hasBytecode = await hasCode({ chain, address, role })
  } catch (err) {
    if (validation.failOpenOnCodeCheckError) {
      return
    }

    throw err
  }

  if (!hasBytecode) {
    throw new Error(`${role} ${address} has no code on ${chain}`)
  }
}

export const buildErc20ApprovalTx = async ({
  chain,
  contractAddress,
  spender,
  amount,
  amountIsBaseUnits,
  owner,
  from,
  validation = {},
}: BuildErc20ApprovalTxParams): Promise<BuildErc20ApprovalTxResult> => {
  const tokenAddress = assertAddress('contract_address', contractAddress)
  const spenderAddress = assertAddress('spender', spender)
  const ownerAddress = assertOptionalAddress('owner', owner)
  const fromAddress = assertOptionalAddress('from', from)

  if (validation.checkTokenCode !== false) {
    await runCodeCheck(chain, tokenAddress, 'token', validation)
  }

  const amountStr = amount.trim()
  const lower = amountStr.toLowerCase()

  if (validation.checkSpenderCode !== false && lower !== '0') {
    await runCodeCheck(chain, spenderAddress, 'spender', validation)
  }

  let decimals: number | undefined
  if (lower !== 'max' && lower !== '0' && amountIsBaseUnits !== true) {
    const readDecimals =
      validation.hooks?.readDecimals ??
      ((input: { chain: EvmChain; tokenAddress: `0x${string}` }) =>
        readDefaultDecimals(input.chain, input.tokenAddress))
    decimals = await readDecimals({ chain, tokenAddress })
  }

  const parsed = parseErc20ApprovalAmount({ amount: amountStr, decimals, amountIsBaseUnits })
  if (parsed.amountBaseUnits > MAX_UINT256) {
    throw new Error(`amount out of uint256 range: ${parsed.amountBaseUnits.toString()} exceeds MAX_UINT256`)
  }

  const effectiveOwner = ownerAddress ?? fromAddress
  const maxApprovalToBalanceRatio = validation.maxApprovalToBalanceRatio ?? DEFAULT_MAX_APPROVAL_TO_BALANCE_RATIO
  if (
    validation.checkBalanceBound !== false &&
    parsed.amountMode === 'specific' &&
    parsed.amountBaseUnits > 0n &&
    effectiveOwner
  ) {
    const readBalance =
      validation.hooks?.readBalance ??
      ((input: { chain: EvmChain; tokenAddress: `0x${string}`; owner: `0x${string}` }) =>
        readDefaultBalance(input.chain, input.tokenAddress, input.owner))

    let balance: bigint
    try {
      balance = await readBalance({ chain, tokenAddress, owner: effectiveOwner })
    } catch (err) {
      if (validation.failOpenOnBalanceCheckError) {
        balance = -1n
      } else {
        throw err
      }
    }

    if (balance > 0n && parsed.amountBaseUnits > balance * maxApprovalToBalanceRatio) {
      throw new Error(
        `refusing to build approval: requested amount (${parsed.amountBaseUnits.toString()} base units) exceeds ` +
          `${maxApprovalToBalanceRatio.toString()}x the owner's current balance (${balance.toString()} base units)`
      )
    }
  }

  const data = encodeErc20Approve(spenderAddress, parsed.amountBaseUnits)
  const chainId = BigInt(getEvmChainId(chain)).toString()

  const approval: NormalizedErc20Approval = {
    chain,
    chainId,
    tokenAddress,
    spender: spenderAddress,
    amountBaseUnits: parsed.amountBaseUnits,
    amount: parsed.amountBaseUnits.toString(),
    amountMode: parsed.amountMode,
    amountIsBaseUnits: parsed.amountIsBaseUnits,
    decimals: parsed.decimals,
    isUnlimited: parsed.amountBaseUnits === MAX_UINT256,
    isRevoke: parsed.amountBaseUnits === 0n,
  }

  return {
    tx: {
      chain,
      chain_id: chainId,
      to: tokenAddress,
      value: '0',
      data,
      spender: spenderAddress,
      amount: approval.amount,
      is_unlimited: approval.isUnlimited,
    },
    approval,
  }
}
