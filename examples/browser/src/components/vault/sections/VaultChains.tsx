import { Chain, type VaultBase } from '@vultisig/sdk'
import { useState } from 'react'

import Button from '@/components/common/Button'
import Modal from '@/components/common/Modal'
import Select from '@/components/common/Select'

type VaultChainsProps = {
  vault: VaultBase
}

// All available chains from the SDK
const ALL_CHAINS = Object.values(Chain) as Chain[]

export default function VaultChains({ vault }: VaultChainsProps) {
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [selectedChain, setSelectedChain] = useState<Chain | ''>('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Get chains not already in the vault
  const availableChains = ALL_CHAINS.filter(chain => !vault.chains.includes(chain))

  const handleAddChain = async () => {
    if (!selectedChain) {
      setError('Please select a chain')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      await vault.addChain(selectedChain)
      setIsAddOpen(false)
      setSelectedChain('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add chain')
    } finally {
      setIsLoading(false)
    }
  }

  const handleRemoveChain = async (chain: Chain) => {
    if (!confirm(`Remove ${chain} from this vault?`)) return

    setIsLoading(true)
    setError(null)

    try {
      await vault.removeChain(chain)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove chain')
    } finally {
      setIsLoading(false)
    }
  }

  const closeAddModal = () => {
    setIsAddOpen(false)
    setSelectedChain('')
    setError(null)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">Active Chains</h2>
        <Button variant="primary" size="small" onClick={() => setIsAddOpen(true)}>
          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Chain
        </Button>
      </div>

      {error && <div className="text-error text-sm bg-red-50 p-3 rounded">{error}</div>}

      {vault.chains.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center bg-gray-50 rounded-lg">
          <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
              />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No Chains Added</h3>
          <p className="text-gray-500 mb-4">Add blockchain networks to your vault.</p>
          <Button variant="primary" onClick={() => setIsAddOpen(true)}>
            Add Your First Chain
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {vault.chains.map(chain => (
            <ChainCard key={chain} chain={chain} onRemove={() => handleRemoveChain(chain)} isLoading={isLoading} />
          ))}
        </div>
      )}

      {/* Add Chain Modal */}
      <Modal isOpen={isAddOpen} onClose={closeAddModal} title="Add Chain">
        <div className="space-y-4">
          <Select
            label="Select Chain"
            options={availableChains.map(chain => ({ value: chain, label: chain }))}
            value={selectedChain}
            onChange={e => setSelectedChain(e.target.value as Chain)}
          />
          {availableChains.length === 0 && (
            <p className="text-sm text-gray-500">All available chains have been added to this vault.</p>
          )}
          {error && <div className="text-error text-sm bg-red-50 p-3 rounded">{error}</div>}
          <div className="flex gap-3 justify-end">
            <Button variant="secondary" onClick={closeAddModal}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleAddChain}
              isLoading={isLoading}
              disabled={!selectedChain || availableChains.length === 0}
            >
              Add Chain
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// Chain card component
function ChainCard({ chain, onRemove, isLoading }: { chain: Chain; onRemove: () => void; isLoading: boolean }) {
  const chainInfo = getChainInfo(chain)

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold"
            style={{ backgroundColor: chainInfo.color }}
          >
            {chain.charAt(0)}
          </div>
          <div>
            <h4 className="font-semibold">{chain}</h4>
            <p className="text-sm text-gray-500">{chainInfo.type}</p>
          </div>
        </div>
        <button
          className="p-1 text-gray-400 hover:text-red-500 transition-colors"
          onClick={onRemove}
          disabled={isLoading}
          title="Remove chain"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}

// Helper to get chain info (type and color)
function getChainInfo(chain: Chain): { type: string; color: string } {
  // EVM chains
  const evmChains = [
    'Ethereum',
    'Polygon',
    'Avalanche',
    'BSC',
    'Arbitrum',
    'Optimism',
    'Base',
    'Blast',
    'Zksync',
    'CronosChain',
    'Mantle',
    'Hyperliquid',
    'Sei',
  ]
  if (evmChains.includes(chain)) {
    return { type: 'EVM', color: '#627EEA' }
  }

  // UTXO chains
  const utxoChains = ['Bitcoin', 'Bitcoin-Cash', 'Litecoin', 'Dogecoin', 'Dash', 'Zcash']
  if (utxoChains.includes(chain)) {
    return { type: 'UTXO', color: '#F7931A' }
  }

  // Cosmos chains
  const cosmosChains = [
    'Cosmos',
    'Osmosis',
    'THORChain',
    'MayaChain',
    'Dydx',
    'Kujira',
    'Terra',
    'TerraClassic',
    'Noble',
    'Akash',
  ]
  if (cosmosChains.includes(chain)) {
    return { type: 'Cosmos', color: '#2E3148' }
  }

  // Other chains
  const chainColors: Record<string, { type: string; color: string }> = {
    Solana: { type: 'Solana', color: '#9945FF' },
    Sui: { type: 'Sui', color: '#6FBCF0' },
    Polkadot: { type: 'Polkadot', color: '#E6007A' },
    Ton: { type: 'TON', color: '#0098EA' },
    Ripple: { type: 'XRP', color: '#23292F' },
    Tron: { type: 'Tron', color: '#FF0013' },
    Cardano: { type: 'Cardano', color: '#0033AD' },
  }

  return chainColors[chain] || { type: 'Other', color: '#6B7280' }
}
