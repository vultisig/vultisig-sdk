import { useRef, useState } from 'react'

import { useSDKAdapter } from '../../../adapters'
import type { BalanceResult, VaultInfo } from '../../../types'
import Button from '../../common/Button'
import Spinner from '../../common/Spinner'

type VaultBalanceProps = {
  vault: VaultInfo
}

type BalanceEntry = {
  chain: string
  balance: BalanceResult
  tokenId?: string
}

export default function VaultBalance({ vault }: VaultBalanceProps) {
  const sdk = useSDKAdapter()

  const [balances, setBalances] = useState<BalanceEntry[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [includeTokens, setIncludeTokens] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const handleRefresh = async () => {
    // Cancel any in-progress fetch
    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()
    const signal = abortControllerRef.current.signal

    setIsLoading(true)
    setError(null)

    try {
      const entries: BalanceEntry[] = []

      for (const chain of vault.chains) {
        if (signal.aborted) break

        try {
          // Native balance
          const balance = await sdk.getBalance(vault.id, chain)
          if (signal.aborted) break
          entries.push({ chain, balance })

          // Token balances
          if (includeTokens) {
            const tokens = await sdk.getTokens(vault.id, chain)
            for (const token of tokens) {
              if (signal.aborted) break
              try {
                const tokenBalance = await sdk.getBalance(vault.id, chain, token.id)
                if (signal.aborted) break
                entries.push({ chain, balance: tokenBalance, tokenId: token.id })
              } catch (err) {
                console.error(`Failed to get balance for ${token.symbol}:`, err)
              }
            }
          }
        } catch (err) {
          console.error(`Failed to get balance for ${chain}:`, err)
        }
      }

      if (!signal.aborted) {
        setBalances(entries)
      }
    } catch (err) {
      if (!signal.aborted) {
        setError(err instanceof Error ? err.message : 'Failed to load balances')
      }
    } finally {
      setIsLoading(false)
    }
  }

  // Group balances by chain
  const balancesByChain = balances.reduce(
    (acc, entry) => {
      if (!acc[entry.chain]) {
        acc[entry.chain] = []
      }
      acc[entry.chain].push(entry)
      return acc
    },
    {} as Record<string, BalanceEntry[]>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Balances</h2>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={includeTokens}
              onChange={e => setIncludeTokens(e.target.checked)}
              className="rounded border-gray-300"
            />
            Include tokens
          </label>
          <Button variant="primary" size="small" onClick={handleRefresh} isLoading={isLoading}>
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            Refresh
          </Button>
        </div>
      </div>

      {error && <div className="text-error text-sm bg-red-50 p-3 rounded">{error}</div>}

      {isLoading && balances.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <Spinner size="large" />
        </div>
      ) : balances.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center bg-gray-50 rounded-lg">
          <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
              />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No Balances Loaded</h3>
          <p className="text-gray-500 mb-4">Click &quot;Refresh&quot; to load balances for all chains.</p>
          <Button variant="primary" onClick={handleRefresh}>
            Load Balances
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(balancesByChain).map(([chain, entries]) => (
            <div key={chain} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                <div className="flex items-center gap-2">
                  <ChainIcon chain={chain} />
                  <h3 className="font-semibold">{chain}</h3>
                </div>
              </div>
              <div className="divide-y divide-gray-100">
                {entries.map((entry, idx) => (
                  <BalanceRow key={`${entry.chain}-${entry.tokenId || 'native'}-${idx}`} entry={entry} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Balance row component
function BalanceRow({ entry }: { entry: BalanceEntry }) {
  const { balance, tokenId } = entry
  const isToken = !!tokenId

  return (
    <div className="flex items-center justify-between px-4 py-3 hover:bg-gray-50">
      <div className="flex items-center gap-3">
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${isToken ? 'bg-blue-100 text-blue-600' : 'bg-primary/10 text-primary'}`}
        >
          {balance.symbol?.charAt(0) || '?'}
        </div>
        <div>
          <div className="font-medium">{balance.symbol || 'Unknown'}</div>
          {isToken && <div className="text-xs text-gray-500">Token</div>}
        </div>
      </div>
      <div className="text-right">
        <div className="font-mono font-medium">{formatAmount(balance.amount, balance.decimals)}</div>
        {balance.value !== undefined && balance.value > 0 && (
          <div className="text-sm text-gray-500">${balance.value.toFixed(2)}</div>
        )}
      </div>
    </div>
  )
}

// Format balance amount with decimals
function formatAmount(amount: string | bigint | number, decimals: number = 18): string {
  const amountStr = typeof amount === 'bigint' ? amount.toString() : String(amount)

  if (amountStr === '0') return '0'

  // Handle decimal conversion
  const amountBig = BigInt(amountStr)
  const divisor = BigInt(10 ** decimals)
  const wholePart = amountBig / divisor
  const fractionalPart = amountBig % divisor

  if (fractionalPart === BigInt(0)) {
    return wholePart.toString()
  }

  // Format fractional part with leading zeros
  let fractionalStr = fractionalPart.toString().padStart(decimals, '0')
  // Trim trailing zeros but keep at least 2 decimals for readability
  fractionalStr = fractionalStr.replace(/0+$/, '')
  if (fractionalStr.length < 2) {
    fractionalStr = fractionalStr.padEnd(2, '0')
  }
  // Limit to 8 decimal places
  fractionalStr = fractionalStr.slice(0, 8)

  return `${wholePart}.${fractionalStr}`
}

// Chain icon placeholder
function ChainIcon({ chain }: { chain: string }) {
  return (
    <div className="w-6 h-6 bg-primary/10 text-primary rounded-full flex items-center justify-center text-xs font-bold">
      {chain.charAt(0)}
    </div>
  )
}
