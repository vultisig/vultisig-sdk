import { encodeFunctionData, erc20Abi, getAddress, isAddress } from 'viem'

/**
 * 3Jane supplier-side mainnet addresses, pinned from the public docs:
 * https://docs.3jane.xyz/developers/addresses
 *
 * 3Jane is an ERC-4626-style credit money market on Ethereum. The supplier flow
 * deposits USDC through a Helper contract that mints the senior (USD3) or staked
 * junior (sUSD3) share back to the depositor.
 *
 * Hand-rolled viem (per the DeFi lib-vs-handroll deep-dive: no official RN-safe
 * SDK exists; ERC-4626 + a 1-fn helper ABI is trivial to encode directly).
 */
export const THREE_JANE_ADDRESSES = {
  /** Helper.deposit(assets, receiver, hop) — supplier entrypoint. */
  helper: '0x82736F81A56935c8429ADdbDa4aEBec737444505',
  /** Senior tranche, liquid ERC-4626 share. */
  usd3: '0x056B269Eb1f75477a8666ae8C7fE01b64dD55eCc',
  /** Staked junior tranche, cooldown-gated exits. */
  susd3: '0xf689555121e529ff0463e191f9bd9d1e496164a7',
  /** Canonical Ethereum mainnet USDC. */
  usdc: '0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
} as const

const ETHEREUM_CHAIN_ID = 1
const USDC_DECIMALS = 6
/** Documented minimum supplier deposit: 1,000 USDC. */
const MIN_DEPOSIT_RAW = 1_000n * 10n ** BigInt(USDC_DECIMALS)
const MAX_UINT256 = (1n << 256n) - 1n

const helperDepositAbi = [
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'assets', type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'hop', type: 'bool' },
    ],
    outputs: [{ type: 'uint256' }],
  },
] as const

/** Senior (liquid) or staked junior (cooldown-gated) 3Jane tranche. */
export type ThreeJaneTranche = 'usd3' | 'susd3'

export type BuildThreeJaneSupplyUsdcParams = {
  /** Depositor / msg.sender Ethereum address. */
  from: string
  /** USDC amount as a decimal string (e.g. "1000", "1500.5"). Max 6 decimals. */
  amount: string
  /**
   * Tranche to mint. `usd3` (default) = senior liquid share; `susd3` = staked
   * junior share (maps to Helper.deposit hop=true), exits are cooldown-gated.
   */
  tranche?: ThreeJaneTranche
  /**
   * Share recipient. Injectable so multi-consumer callers can route shares to a
   * vault / smart-account distinct from the funding address. Defaults to `from`
   * (the only behaviour the on-chain Helper currently honours — it mints to
   * msg.sender). No affiliate/fee is hardcoded; this is the sole steerable
   * recipient knob and it defaults to the depositor (neutral / self-only).
   */
  receiver?: string
}

/** One unsigned EVM transaction step in the supply sequence. */
export type ThreeJaneTxStep = {
  to: `0x${string}`
  value: '0'
  data: `0x${string}`
  action: 'approve' | 'deposit'
  description: string
}

export type BuildThreeJaneSupplyUsdcResult = {
  chain: 'Ethereum'
  chainId: number
  protocol: '3Jane'
  provider: '3jane'
  fromSymbol: 'USDC'
  toSymbol: 'USD3' | 'sUSD3'
  fromAddress: `0x${string}`
  receiver: `0x${string}`
  tranche: ThreeJaneTranche
  amountRaw: string
  amountUsdc: string
  minDepositUsdc: string
  /** Unsigned [approve, deposit] sequence. BUILD-ONLY — never signed/broadcast. */
  transactions: [ThreeJaneTxStep, ThreeJaneTxStep]
}

/** Parse a decimal USDC string into a raw 6-decimal bigint. */
export function parseUsdcAmount(s: string): bigint {
  const trimmed = s.trim()
  if (trimmed === '') throw new Error('empty amount')
  if (trimmed.startsWith('-')) throw new Error('negative amounts not allowed')

  const dotIdx = trimmed.indexOf('.')
  let wholePart = dotIdx === -1 ? trimmed : trimmed.slice(0, dotIdx)
  let fracPart = dotIdx === -1 ? '' : trimmed.slice(dotIdx + 1)

  if (fracPart.includes('.')) throw new Error(`invalid amount: multiple decimal points in ${s}`)
  if (wholePart === '') wholePart = '0'
  if (fracPart.length > USDC_DECIMALS) {
    throw new Error(`too many decimal places (max ${USDC_DECIMALS} for USDC): ${s}`)
  }
  if (!/^\d+$/.test(wholePart)) throw new Error(`invalid integer part: ${wholePart}`)
  if (fracPart !== '' && !/^\d+$/.test(fracPart)) throw new Error(`invalid fractional part: ${fracPart}`)

  while (fracPart.length < USDC_DECIMALS) fracPart += '0'
  const fracInt = fracPart === '' ? 0n : BigInt(fracPart)
  return BigInt(wholePart) * 10n ** BigInt(USDC_DECIMALS) + fracInt
}

function formatUsdc(raw: bigint): string {
  const whole = raw / 10n ** BigInt(USDC_DECIMALS)
  const frac = raw % 10n ** BigInt(USDC_DECIMALS)
  if (frac === 0n) return whole.toString()
  const fracStr = frac.toString().padStart(USDC_DECIMALS, '0').replace(/0+$/, '')
  return `${whole.toString()}.${fracStr}`
}

/**
 * Build the unsigned 2-step Ethereum transaction sequence to supply USDC into
 * 3Jane: (1) ERC-20 approve USDC to the 3Jane Helper, (2) Helper.deposit(...) to
 * mint USD3 (senior) or sUSD3 (staked junior) back to `receiver`.
 *
 * PURE / BUILD-ONLY: returns unsigned calldata. It never signs, never broadcasts,
 * and performs no network IO. Supplier-side only (no borrow / no sUSD3 exit).
 */
export function buildThreeJaneSupplyUsdc(params: BuildThreeJaneSupplyUsdcParams): BuildThreeJaneSupplyUsdcResult {
  const senderRaw = String(params.from ?? '').trim()
  if (senderRaw === '') throw new Error('from address is required')
  if (!isAddress(senderRaw, { strict: false })) throw new Error(`invalid "from" address: ${senderRaw}`)
  const sender = getAddress(senderRaw)

  const receiverRaw = String(params.receiver ?? senderRaw).trim()
  if (!isAddress(receiverRaw, { strict: false })) throw new Error(`invalid "receiver" address: ${receiverRaw}`)
  const receiver = getAddress(receiverRaw)

  const rawAmount = parseUsdcAmount(String(params.amount))
  if (rawAmount <= 0n) throw new Error('amount must be positive')
  if (rawAmount < MIN_DEPOSIT_RAW) {
    throw new Error(`3Jane supplier deposits must be at least ${formatUsdc(MIN_DEPOSIT_RAW)} USDC.`)
  }
  if (rawAmount > MAX_UINT256) throw new Error('amount overflows uint256')

  const tranche: ThreeJaneTranche = params.tranche === 'susd3' ? 'susd3' : 'usd3'
  const hop = tranche === 'susd3'

  const approveData = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [getAddress(THREE_JANE_ADDRESSES.helper), rawAmount],
  })

  const depositData = encodeFunctionData({
    abi: helperDepositAbi,
    functionName: 'deposit',
    args: [rawAmount, receiver, hop],
  })

  return {
    chain: 'Ethereum',
    chainId: ETHEREUM_CHAIN_ID,
    protocol: '3Jane',
    provider: '3jane',
    fromSymbol: 'USDC',
    toSymbol: hop ? 'sUSD3' : 'USD3',
    fromAddress: sender,
    receiver,
    tranche,
    amountRaw: rawAmount.toString(),
    amountUsdc: formatUsdc(rawAmount),
    minDepositUsdc: formatUsdc(MIN_DEPOSIT_RAW),
    transactions: [
      {
        to: getAddress(THREE_JANE_ADDRESSES.usdc),
        value: '0',
        data: approveData,
        action: 'approve',
        description: `Approve ${formatUsdc(rawAmount)} USDC to the 3Jane Helper on Ethereum (step 1 of 2).`,
      },
      {
        to: getAddress(THREE_JANE_ADDRESSES.helper),
        value: '0',
        data: depositData,
        action: 'deposit',
        description: hop
          ? `Supply ${formatUsdc(rawAmount)} USDC via 3Jane Helper.deposit(..., hop=true) to mint sUSD3 to ${receiver} (step 2 of 2). sUSD3 exits are cooldown-gated.`
          : `Supply ${formatUsdc(rawAmount)} USDC via 3Jane Helper.deposit(..., hop=false) to mint USD3 to ${receiver} (step 2 of 2).`,
      },
    ],
  }
}
