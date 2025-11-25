import type { VaultBase } from '@vultisig/sdk'
import { useState } from 'react'

import Button from '@/components/common/Button'

type BalanceDisplayProps = {
  vault: VaultBase
}

export default function BalanceDisplay({ vault }: BalanceDisplayProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [balances, setBalances] = useState<any[]>([])

  const handleCheckBalances = async () => {
    setIsLoading(true)
    try {
      // Check balances for all chains
      const allBalances: any[] = []
      for (const chain of vault.getChains()) {
        const balance = await vault.balance(chain)
        allBalances.push({ chain, balance })
      }
      setBalances(allBalances)
    } catch (error) {
      console.error('Failed to check balances:', error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Balances</h3>
        <Button variant="primary" size="small" onClick={handleCheckBalances} isLoading={isLoading}>
          Check Balances
        </Button>
      </div>

      {balances.length === 0 ? (
        <p className="text-gray-500 text-center py-4">No balances loaded. Click &quot;Check Balances&quot; to load.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-2 font-medium">Chain</th>
                <th className="text-right p-2 font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              {balances.map(({ chain, balance }) => (
                <tr key={chain} className="border-t border-gray-100">
                  <td className="p-2">{chain}</td>
                  <td className="p-2 text-right font-mono">
                    {balance.amount} {balance.symbol}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
