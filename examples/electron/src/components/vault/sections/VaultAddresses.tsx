import { useEffect, useState } from 'react'

import { vault } from '@/api/sdk-bridge'
import Button from '@/components/common/Button'
import Spinner from '@/components/common/Spinner'
import type { VaultInfo } from '@/types'

type VaultAddressesProps = {
  vault: VaultInfo
}

type AddressEntry = {
  chain: string
  address: string
}

export default function VaultAddresses({ vault: vaultInfo }: VaultAddressesProps) {
  const [addresses, setAddresses] = useState<AddressEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null)

  // Load addresses for all chains
  useEffect(() => {
    const loadAddresses = async () => {
      setIsLoading(true)
      try {
        const addressMap = await vault.getAllAddresses(vaultInfo.id)
        const entries: AddressEntry[] = Object.entries(addressMap).map(([chain, address]) => ({
          chain,
          address,
        }))
        setAddresses(entries)
      } catch (err) {
        console.error('Failed to load addresses:', err)
      } finally {
        setIsLoading(false)
      }
    }

    loadAddresses()
  }, [vaultInfo.id, vaultInfo.chains])

  const handleCopy = async (address: string) => {
    try {
      await navigator.clipboard.writeText(address)
      setCopiedAddress(address)
      setTimeout(() => setCopiedAddress(null), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner size="large" />
      </div>
    )
  }

  if (addresses.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
          <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
            />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">No Addresses</h3>
        <p className="text-gray-500">Add chains to your vault to see addresses.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">Wallet Addresses</h2>
        <span className="text-sm text-gray-500">{addresses.length} chain(s)</span>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Chain</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Address</th>
              <th className="text-right px-4 py-3 text-sm font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {addresses.map(({ chain, address }) => (
              <tr key={chain} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <ChainIcon chain={chain} />
                    <span className="font-medium">{chain}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <code className="text-sm text-gray-700 bg-gray-100 px-2 py-1 rounded font-mono">
                    {truncateAddress(address)}
                  </code>
                </td>
                <td className="px-4 py-3 text-right">
                  <Button variant="secondary" size="small" onClick={() => handleCopy(address)}>
                    {copiedAddress === address ? (
                      <>
                        <svg
                          className="w-4 h-4 mr-1 text-green-600"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Copied
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                          />
                        </svg>
                        Copy
                      </>
                    )}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Helper to truncate address for display
function truncateAddress(address: string): string {
  if (address.length <= 20) return address
  return `${address.slice(0, 10)}...${address.slice(-8)}`
}

// Chain icon placeholder - shows first letter
function ChainIcon({ chain }: { chain: string }) {
  return (
    <div className="w-8 h-8 bg-primary/10 text-primary rounded-full flex items-center justify-center text-sm font-bold">
      {chain.charAt(0)}
    </div>
  )
}
