import { EvmChain } from '@vultisig/core-chain/Chain'
import { getEvmClient } from '@vultisig/core-chain/chains/evm/client'
import { usdc } from '@vultisig/core-chain/coin/knownTokens'
import { type Abi, encodeFunctionData, erc20Abi, getAddress, type Hex, parseAbi, type PublicClient } from 'viem'

export const noonUsdcVaultConfig = {
  name: 'sUSN Delta Neutral Yield Vault',
  provider: 'Noon',
  chain: EvmChain.Ethereum,
  assetAddress: usdc.id,
  assetSymbol: 'USDC',
  assetDecimals: 6,
  shareSymbol: 'naccUSDC',
  shareDecimals: 6,
  // Accountable/Noon loan address used by off-chain APY and TVL APIs.
  loanAddress: '0xc3Edd8B28C41749Eed38c2A33a78e3E046DFB876',
  // ERC-7540/ERC-4626 vault and share-token contract used for user transactions.
  vaultAddress: '0xA73424f1Ac94b3ef0D0c9af4F2967c87D4AF25D9',
  minDepositAssets: 100_000_000n,
  minRedeemShares: 95_000_000n,
  maxCapacityAssets: 10_000_000_000_000n,
  redemptionWindow: {
    closesDayOfWeek: 3,
    closesTimeUtc: '23:00',
    settlementDays: 7,
  },
} as const

export const noonVaultAbi = parseAbi([
  'function asset() view returns (address)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function deposit(uint256 assets, address receiver) returns (uint256 shares)',
  'function previewDeposit(uint256 assets) view returns (uint256 shares)',
  'function previewRedeem(uint256 shares) view returns (uint256 assets)',
  'function previewWithdraw(uint256 assets) view returns (uint256 shares)',
  'function requestRedeem(uint256 shares, address receiver, address owner) returns (uint256 requestId)',
  'function withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)',
  'function sharePrice() view returns (uint256)',
  'function convertToAssets(uint256 shares) view returns (uint256 assets)',
  'function totalAssets() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function totalQueuedShares() view returns (uint256)',
  'function queue() view returns (uint256 lastRequestId, uint256 nextRequestId)',
  'function MIN_AMOUNT_WEI() view returns (uint256)',
  'function claimableRedeemRequest(uint256 requestId, address controller) view returns (uint256 shares)',
  'function pendingRedeemRequest(uint256 requestId, address controller) view returns (uint256 shares)',
  'function getState(address user) view returns ((uint256 maxMint,uint256 maxWithdraw,uint256 depositAssets,uint256 redeemShares,uint256 depositPrice,uint256 mintPrice,uint256 redeemPrice,uint256 withdrawPrice,uint256 pendingDepositRequest,uint256 pendingRedeemRequest))',
])

const withdrawalRequestAbi = parseAbi(['function withdrawalRequest(uint256 requestId, address controller) view'])
const withdrawalRequestsAbi = parseAbi(['function withdrawalRequests(uint256 from, uint256 to) view'])

export type NoonContractCall = {
  chain: typeof noonUsdcVaultConfig.chain
  contractAddress: string
  abi: Abi
  functionName: string
  args: readonly unknown[]
  value: bigint
}

export type NoonDepositTxPlan = {
  approval?: NoonContractCall
  deposit: NoonContractCall
  currentAllowance: bigint
}

export type NoonVaultState = {
  maxMint: bigint
  maxWithdraw: bigint
  depositAssets: bigint
  redeemShares: bigint
  depositPrice: bigint
  mintPrice: bigint
  redeemPrice: bigint
  withdrawPrice: bigint
  pendingDepositRequest: bigint
  pendingRedeemRequest: bigint
}

export type NoonVaultPosition = NoonVaultState & {
  shareBalance: bigint
  currentAssets: bigint
  claimableAssets: bigint
  claimableRedeemShares: bigint
  pendingRedeemShares: bigint
  redemptionState: 'none' | 'pending' | 'claimable'
  queue: NoonVaultQueue
}

export type NoonVaultQueue = {
  lastRequestId: bigint
  nextRequestId: bigint
  totalQueuedShares: bigint
}

export type NoonVaultMetrics = {
  apy7dNetPercent: number
  tvl: number
  tvlInUsd: number
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

const noonVaultsApiUrl = 'https://back.noon.capital/api/v1/vaults'
const accountableLoanApiUrl = `https://yield.accountable.capital/api/loan/address/${noonUsdcVaultConfig.loanAddress}`

const normalizeAddress = (address: string) => getAddress(address).toLowerCase()

const getClient = (client?: PublicClient) => client ?? getEvmClient(EvmChain.Ethereum)

const getFetch = (fetchImpl?: FetchLike): FetchLike => {
  const resolved = fetchImpl ?? globalThis.fetch
  if (!resolved) {
    throw new Error('No fetch implementation available')
  }

  return resolved.bind(globalThis) as FetchLike
}

const readJson = async (fetchImpl: FetchLike, url: string): Promise<unknown> => {
  const response = await fetchImpl(url)
  if (!response.ok) {
    throw new Error(`Noon API request failed: ${response.status} ${response.statusText}`)
  }

  return response.json()
}

const getObject = (value: unknown, name: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Noon API ${name} must be an object`)
  }

  return value as Record<string, unknown>
}

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const getNumber = (value: unknown, path: string): number => {
  const result = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isFinite(result)) {
    throw new Error(`Noon API ${path} must be a finite number`)
  }

  return result
}

const getNoonVaultSevenDayNetApy = (vault: Record<string, unknown>) => {
  if (isObjectRecord(vault.ir) && vault.ir['7d'] !== undefined) {
    const sevenDay = getObject(vault.ir['7d'], 'ir.7d')
    const net = getObject(sevenDay.net, 'ir.7d.net')

    return getNumber(net.apy_pct, 'ir.7d.net.apy_pct')
  }

  const sevenDay = getObject(vault['7d'], '7d')
  const net = getObject(sevenDay.net, '7d.net')

  return getNumber(net.apy_pct, '7d.net.apy_pct')
}

const assertAtLeast = (value: bigint, minimum: bigint, label: string) => {
  if (value < minimum) {
    throw new Error(`${label} must be at least ${minimum.toString()}`)
  }
}

export const encodeNoonDeposit = (assets: bigint, receiver: string): Hex =>
  encodeFunctionData({
    abi: noonVaultAbi,
    functionName: 'deposit',
    args: [assets, receiver as Hex],
  })

export const encodeNoonRequestRedeem = (shares: bigint, receiver: string, owner = receiver): Hex =>
  encodeFunctionData({
    abi: noonVaultAbi,
    functionName: 'requestRedeem',
    args: [shares, receiver as Hex, owner as Hex],
  })

export const encodeNoonWithdraw = (assets: bigint, receiver: string, owner = receiver): Hex =>
  encodeFunctionData({
    abi: noonVaultAbi,
    functionName: 'withdraw',
    args: [assets, receiver as Hex, owner as Hex],
  })

export const encodeNoonUsdcApprove = (amount: bigint): Hex =>
  encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [noonUsdcVaultConfig.vaultAddress, amount],
  })

export const getNoonDepositContractCall = (assets: bigint, receiver: string): NoonContractCall => {
  assertAtLeast(assets, noonUsdcVaultConfig.minDepositAssets, 'Noon deposit assets')

  return {
    chain: EvmChain.Ethereum,
    contractAddress: noonUsdcVaultConfig.vaultAddress,
    abi: noonVaultAbi,
    functionName: 'deposit',
    args: [assets, receiver],
    value: 0n,
  }
}

export const getNoonRequestRedeemContractCall = (
  shares: bigint,
  receiver: string,
  owner = receiver
): NoonContractCall => {
  assertAtLeast(shares, noonUsdcVaultConfig.minRedeemShares, 'Noon redeem shares')

  return {
    chain: EvmChain.Ethereum,
    contractAddress: noonUsdcVaultConfig.vaultAddress,
    abi: noonVaultAbi,
    functionName: 'requestRedeem',
    args: [shares, receiver, owner],
    value: 0n,
  }
}

export const getNoonWithdrawContractCall = (assets: bigint, receiver: string, owner = receiver): NoonContractCall => ({
  chain: EvmChain.Ethereum,
  contractAddress: noonUsdcVaultConfig.vaultAddress,
  abi: noonVaultAbi,
  functionName: 'withdraw',
  args: [assets, receiver, owner],
  value: 0n,
})

export const getNoonUsdcApproveContractCall = (amount: bigint): NoonContractCall => ({
  chain: EvmChain.Ethereum,
  contractAddress: noonUsdcVaultConfig.assetAddress,
  abi: erc20Abi,
  functionName: 'approve',
  args: [noonUsdcVaultConfig.vaultAddress, amount],
  value: 0n,
})

export const getNoonUsdcAllowance = (owner: string, client?: PublicClient): Promise<bigint> =>
  getClient(client).readContract({
    address: noonUsdcVaultConfig.assetAddress as Hex,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [owner as Hex, noonUsdcVaultConfig.vaultAddress as Hex],
  })

export const getNoonDepositTxPlan = async ({
  owner,
  assets,
  client,
}: {
  owner: string
  assets: bigint
  client?: PublicClient
}): Promise<NoonDepositTxPlan> => {
  const currentAllowance = await getNoonUsdcAllowance(owner, client)

  return {
    currentAllowance,
    ...(currentAllowance < assets ? { approval: getNoonUsdcApproveContractCall(assets) } : {}),
    deposit: getNoonDepositContractCall(assets, owner),
  }
}

export const readNoonVaultPreviewDeposit = (assets: bigint, client?: PublicClient): Promise<bigint> =>
  getClient(client).readContract({
    address: noonUsdcVaultConfig.vaultAddress,
    abi: noonVaultAbi,
    functionName: 'previewDeposit',
    args: [assets],
  })

export const readNoonVaultPreviewRedeem = (shares: bigint, client?: PublicClient): Promise<bigint> =>
  getClient(client).readContract({
    address: noonUsdcVaultConfig.vaultAddress,
    abi: noonVaultAbi,
    functionName: 'previewRedeem',
    args: [shares],
  })

export const readNoonVaultPreviewWithdraw = (assets: bigint, client?: PublicClient): Promise<bigint> =>
  getClient(client).readContract({
    address: noonUsdcVaultConfig.vaultAddress,
    abi: noonVaultAbi,
    functionName: 'previewWithdraw',
    args: [assets],
  })

export const readNoonVaultSharePrice = (client?: PublicClient): Promise<bigint> =>
  getClient(client).readContract({
    address: noonUsdcVaultConfig.vaultAddress,
    abi: noonVaultAbi,
    functionName: 'sharePrice',
  })

export const readNoonVaultConvertToAssets = (shares: bigint, client?: PublicClient): Promise<bigint> =>
  getClient(client).readContract({
    address: noonUsdcVaultConfig.vaultAddress,
    abi: noonVaultAbi,
    functionName: 'convertToAssets',
    args: [shares],
  })

export const readNoonVaultMinAmountWei = (client?: PublicClient): Promise<bigint> =>
  getClient(client).readContract({
    address: noonUsdcVaultConfig.vaultAddress,
    abi: noonVaultAbi,
    functionName: 'MIN_AMOUNT_WEI',
  })

export const readNoonVaultQueue = async (client?: PublicClient): Promise<NoonVaultQueue> => {
  const publicClient = getClient(client)
  const [queue, totalQueuedShares] = await Promise.all([
    publicClient.readContract({
      address: noonUsdcVaultConfig.vaultAddress,
      abi: noonVaultAbi,
      functionName: 'queue',
    }),
    publicClient.readContract({
      address: noonUsdcVaultConfig.vaultAddress,
      abi: noonVaultAbi,
      functionName: 'totalQueuedShares',
    }),
  ])

  return {
    lastRequestId: queue[0],
    nextRequestId: queue[1],
    totalQueuedShares,
  }
}

export const readNoonVaultState = (user: string, client?: PublicClient): Promise<NoonVaultState> =>
  getClient(client).readContract({
    address: noonUsdcVaultConfig.vaultAddress,
    abi: noonVaultAbi,
    functionName: 'getState',
    args: [user as Hex],
  })

export const readNoonClaimableRedeemRequest = (
  requestId: bigint,
  controller: string,
  client?: PublicClient
): Promise<bigint> =>
  getClient(client).readContract({
    address: noonUsdcVaultConfig.vaultAddress,
    abi: noonVaultAbi,
    functionName: 'claimableRedeemRequest',
    args: [requestId, controller as Hex],
  })

export const readNoonPendingRedeemRequest = (
  requestId: bigint,
  controller: string,
  client?: PublicClient
): Promise<bigint> =>
  getClient(client).readContract({
    address: noonUsdcVaultConfig.vaultAddress,
    abi: noonVaultAbi,
    functionName: 'pendingRedeemRequest',
    args: [requestId, controller as Hex],
  })

export const readNoonWithdrawalRequestRaw = async (
  requestId: bigint,
  controller: string,
  client?: PublicClient
): Promise<Hex> => {
  const { data } = await getClient(client).call({
    to: noonUsdcVaultConfig.vaultAddress,
    data: encodeFunctionData({
      abi: withdrawalRequestAbi,
      functionName: 'withdrawalRequest',
      args: [requestId, controller as Hex],
    }),
  })

  return data ?? '0x'
}

export const readNoonWithdrawalRequestsRaw = async (
  fromRequestId: bigint,
  toRequestId: bigint,
  client?: PublicClient
): Promise<Hex> => {
  const { data } = await getClient(client).call({
    to: noonUsdcVaultConfig.vaultAddress,
    data: encodeFunctionData({
      abi: withdrawalRequestsAbi,
      functionName: 'withdrawalRequests',
      args: [fromRequestId, toRequestId],
    }),
  })

  return data ?? '0x'
}

export const readNoonVaultPosition = async (user: string, client?: PublicClient): Promise<NoonVaultPosition> => {
  const publicClient = getClient(client)
  const [state, shareBalance, queue] = await Promise.all([
    readNoonVaultState(user, publicClient),
    publicClient.readContract({
      address: noonUsdcVaultConfig.vaultAddress,
      abi: noonVaultAbi,
      functionName: 'balanceOf',
      args: [user as Hex],
    }),
    readNoonVaultQueue(publicClient),
  ])
  const currentAssets = await readNoonVaultConvertToAssets(shareBalance, publicClient)

  const claimableAssets = state.maxWithdraw
  const claimableRedeemShares = state.redeemShares
  const pendingRedeemShares = state.pendingRedeemRequest
  const redemptionState =
    claimableAssets > 0n || claimableRedeemShares > 0n ? 'claimable' : pendingRedeemShares > 0n ? 'pending' : 'none'

  return {
    ...state,
    shareBalance,
    currentAssets,
    claimableAssets,
    claimableRedeemShares,
    pendingRedeemShares,
    redemptionState,
    queue,
  }
}

export const fetchNoonUsdcVaultApy = async (fetchImpl?: FetchLike): Promise<number> => {
  const data = getObject(await readJson(getFetch(fetchImpl), noonVaultsApiUrl), 'vaults response')
  const vaults = data.vaults
  if (!Array.isArray(vaults)) {
    throw new Error('Noon API vaults response must contain a vaults array')
  }

  const target = vaults.find(vault => {
    const record = getObject(vault, 'vault')
    return normalizeAddress(String(record.loan_address)) === normalizeAddress(noonUsdcVaultConfig.loanAddress)
  })

  if (!target) {
    throw new Error(`Noon API did not include loan ${noonUsdcVaultConfig.loanAddress}`)
  }

  return getNoonVaultSevenDayNetApy(getObject(target, 'vault'))
}

export const fetchNoonUsdcVaultTvl = async (fetchImpl?: FetchLike): Promise<{ tvl: number; tvlInUsd: number }> => {
  const data = getObject(await readJson(getFetch(fetchImpl), accountableLoanApiUrl), 'loan response')
  const computed = getObject(data.loan_computed, 'loan_computed')

  return {
    tvl: getNumber(computed.tvl, 'loan_computed.tvl'),
    tvlInUsd: getNumber(computed.tvl_in_usd, 'loan_computed.tvl_in_usd'),
  }
}

export const fetchNoonUsdcVaultMetrics = async (fetchImpl?: FetchLike): Promise<NoonVaultMetrics> => {
  const [apy7dNetPercent, tvl] = await Promise.all([fetchNoonUsdcVaultApy(fetchImpl), fetchNoonUsdcVaultTvl(fetchImpl)])

  return {
    apy7dNetPercent,
    ...tvl,
  }
}
