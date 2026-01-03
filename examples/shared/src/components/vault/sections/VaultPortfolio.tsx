import { useEffect, useRef, useState } from 'react'

import { useSDKAdapter } from '../../../adapters'
import type { FiatCurrency, VaultInfo } from '../../../types'
import Button from '../../common/Button'
import Select from '../../common/Select'
import Spinner from '../../common/Spinner'

type VaultPortfolioProps = {
  vault: VaultInfo
}

type PortfolioData = {
  total: number
  byChain: Record<string, number>
}

const CURRENCIES = [
  { value: 'usd', label: 'USD - US Dollar' },
  { value: 'eur', label: 'EUR - Euro' },
  { value: 'gbp', label: 'GBP - British Pound' },
  { value: 'jpy', label: 'JPY - Japanese Yen' },
  { value: 'cny', label: 'CNY - Chinese Yuan' },
  { value: 'aud', label: 'AUD - Australian Dollar' },
  { value: 'cad', label: 'CAD - Canadian Dollar' },
  { value: 'chf', label: 'CHF - Swiss Franc' },
  { value: 'sgd', label: 'SGD - Singapore Dollar' },
  { value: 'sek', label: 'SEK - Swedish Krona' },
]

const CURRENCY_SYMBOLS: Record<string, string> = {
  usd: '$',
  eur: '\u20AC',
  gbp: '\u00A3',
  jpy: '\u00A5',
  cny: '\u00A5',
  aud: 'A$',
  cad: 'C$',
  chf: 'Fr',
  sgd: 'S$',
  sek: 'kr',
}

export default function VaultPortfolio({ vault }: VaultPortfolioProps) {
  const sdk = useSDKAdapter()

  const [portfolio, setPortfolio] = useState<PortfolioData | null>(null)
  const [currency, setCurrency] = useState<FiatCurrency>('usd')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Load portfolio on mount and currency change
  useEffect(() => {
    loadPortfolio()
    return () => {
      abortControllerRef.current?.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency])

  const loadPortfolio = async () => {
    // Cancel any in-progress fetch
    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()
    const signal = abortControllerRef.current.signal

    setIsLoading(true)
    setError(null)

    try {
      // Set currency preference
      await sdk.setCurrency(vault.id, currency)
      if (signal.aborted) return

      // Get total portfolio value (returns Value object with amount string)
      const totalValue = await sdk.getTotalValue(vault.id, currency)
      if (signal.aborted) return
      const total = parseFloat(totalValue.amount)

      // Get value by chain
      const byChain: Record<string, number> = {}
      for (const chain of vault.chains) {
        if (signal.aborted) break
        try {
          const value = await sdk.getValue(vault.id, chain, undefined, currency)
          if (signal.aborted) break
          const numValue = parseFloat(value.amount)
          if (numValue > 0) {
            byChain[chain] = numValue
          }
        } catch (err) {
          console.error(`Failed to get value for ${chain}:`, err)
        }
      }

      if (!signal.aborted) {
        setPortfolio({ total, byChain })
      }
    } catch (err) {
      if (!signal.aborted) {
        setError(err instanceof Error ? err.message : 'Failed to load portfolio')
      }
    } finally {
      if (!signal.aborted) {
        setIsLoading(false)
      }
    }
  }

  const handleCurrencyChange = async (newCurrency: string) => {
    setCurrency(newCurrency as FiatCurrency)
  }

  const currencySymbol = CURRENCY_SYMBOLS[currency] || currency

  // Calculate percentages for chart
  const chartData = portfolio
    ? Object.entries(portfolio.byChain)
        .sort(([, a], [, b]) => b - a)
        .map(([chain, value]) => ({
          chain,
          value,
          percentage: portfolio.total > 0 ? (value / portfolio.total) * 100 : 0,
        }))
    : []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Portfolio</h2>
        <div className="flex items-center gap-4">
          <Select options={CURRENCIES} value={currency} onChange={e => handleCurrencyChange(e.target.value)} />
          <Button variant="secondary" size="small" onClick={loadPortfolio} isLoading={isLoading}>
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

      {isLoading && !portfolio ? (
        <div className="flex items-center justify-center py-16">
          <Spinner size="large" />
        </div>
      ) : !portfolio ? (
        <div className="flex flex-col items-center justify-center py-16 text-center bg-gray-50 rounded-lg">
          <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No Portfolio Data</h3>
          <p className="text-gray-500 mb-4">Load your portfolio to see total value.</p>
          <Button variant="primary" onClick={loadPortfolio}>
            Load Portfolio
          </Button>
        </div>
      ) : (
        <>
          {/* Total Value Card */}
          <div className="bg-gradient-to-br from-primary to-primary/80 text-white rounded-xl p-6">
            <div className="text-sm opacity-80 mb-1">Total Portfolio Value</div>
            <div className="text-4xl font-bold mb-2">
              {currencySymbol}
              {formatValue(portfolio.total)}
            </div>
            <div className="text-sm opacity-80">
              {vault.chains.length} chain{vault.chains.length !== 1 ? 's' : ''} · {currency.toUpperCase()}
            </div>
          </div>

          {/* Chain Breakdown */}
          {chartData.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <h3 className="text-lg font-semibold mb-4">Breakdown by Chain</h3>

              {/* Simple bar chart */}
              <div className="space-y-4">
                {chartData.map(({ chain, value, percentage }) => (
                  <div key={chain}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <ChainIcon chain={chain} />
                        <span className="font-medium">{chain}</span>
                      </div>
                      <div className="text-right">
                        <span className="font-mono">
                          {currencySymbol}
                          {formatValue(value)}
                        </span>
                        <span className="text-gray-500 text-sm ml-2">({percentage.toFixed(1)}%)</span>
                      </div>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-500"
                        style={{ width: `${Math.max(percentage, 1)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {chartData.length === 0 && <p className="text-center text-gray-500 py-4">No value found on any chain.</p>}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// Format value with appropriate precision
function formatValue(value: number): string {
  if (value >= 1000000) {
    return (value / 1000000).toFixed(2) + 'M'
  }
  if (value >= 1000) {
    return (value / 1000).toFixed(2) + 'K'
  }
  if (value >= 1) {
    return value.toFixed(2)
  }
  if (value > 0) {
    return value.toFixed(4)
  }
  return '0.00'
}

// Chain icon placeholder
function ChainIcon({ chain }: { chain: string }) {
  return (
    <div className="w-6 h-6 bg-primary/10 text-primary rounded-full flex items-center justify-center text-xs font-bold">
      {chain.charAt(0)}
    </div>
  )
}
