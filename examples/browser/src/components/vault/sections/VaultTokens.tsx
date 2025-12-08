import type { Chain, Token, VaultBase } from '@vultisig/sdk'
import { useState } from 'react'

import Button from '@/components/common/Button'
import Input from '@/components/common/Input'
import Modal from '@/components/common/Modal'
import Select from '@/components/common/Select'

type VaultTokensProps = {
  vault: VaultBase
}

export default function VaultTokens({ vault }: VaultTokensProps) {
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [selectedChain, setSelectedChain] = useState<Chain | ''>(vault.chains[0] || '')
  const [formData, setFormData] = useState({
    contractAddress: '',
    symbol: '',
    name: '',
    decimals: '18',
  })
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Get all tokens grouped by chain
  const tokensByChain = vault.chains.reduce(
    (acc, chain) => {
      const tokens = vault.getTokens(chain)
      if (tokens.length > 0) {
        acc[chain] = tokens
      }
      return acc
    },
    {} as Record<Chain, Token[]>
  )

  const totalTokens = Object.values(tokensByChain).reduce((sum, tokens) => sum + tokens.length, 0)

  const handleAddToken = async () => {
    if (!selectedChain) {
      setError('Please select a chain')
      return
    }

    if (!formData.contractAddress) {
      setError('Contract address is required')
      return
    }

    if (!formData.symbol) {
      setError('Token symbol is required')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const token: Token = {
        id: formData.contractAddress,
        symbol: formData.symbol.toUpperCase(),
        name: formData.name || formData.symbol,
        decimals: parseInt(formData.decimals, 10) || 18,
        contractAddress: formData.contractAddress,
        chainId: selectedChain,
      }

      await vault.addToken(selectedChain, token)
      closeAddModal()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add token')
    } finally {
      setIsLoading(false)
    }
  }

  const handleRemoveToken = async (chain: Chain, tokenId: string) => {
    if (!confirm('Remove this token from your vault?')) return

    setIsLoading(true)
    setError(null)

    try {
      await vault.removeToken(chain, tokenId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove token')
    } finally {
      setIsLoading(false)
    }
  }

  const closeAddModal = () => {
    setIsAddOpen(false)
    setFormData({ contractAddress: '', symbol: '', name: '', decimals: '18' })
    setError(null)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Custom Tokens</h2>
        <Button variant="primary" size="small" onClick={() => setIsAddOpen(true)}>
          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Token
        </Button>
      </div>

      {error && <div className="text-error text-sm bg-red-50 p-3 rounded">{error}</div>}

      {totalTokens === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center bg-gray-50 rounded-lg">
          <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No Custom Tokens</h3>
          <p className="text-gray-500 mb-4">Add custom ERC-20 or other tokens to track.</p>
          <Button variant="primary" onClick={() => setIsAddOpen(true)}>
            Add Your First Token
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(tokensByChain).map(([chain, tokens]) => (
            <div key={chain} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                <div className="flex items-center gap-2">
                  <ChainIcon chain={chain as Chain} />
                  <h3 className="font-semibold">{chain}</h3>
                  <span className="text-sm text-gray-500">
                    ({tokens.length} token{tokens.length !== 1 ? 's' : ''})
                  </span>
                </div>
              </div>
              <div className="divide-y divide-gray-100">
                {tokens.map(token => (
                  <TokenRow
                    key={token.id}
                    token={token}
                    onRemove={() => handleRemoveToken(chain as Chain, token.id)}
                    isLoading={isLoading}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Token Modal */}
      <Modal isOpen={isAddOpen} onClose={closeAddModal} title="Add Custom Token">
        <div className="space-y-4">
          <Select
            label="Chain"
            options={vault.chains.map(chain => ({ value: chain, label: chain }))}
            value={selectedChain}
            onChange={e => setSelectedChain(e.target.value as Chain)}
          />

          <Input
            label="Contract Address"
            value={formData.contractAddress}
            onChange={e => setFormData(prev => ({ ...prev, contractAddress: e.target.value }))}
            placeholder="0x..."
            required
          />

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Symbol"
              value={formData.symbol}
              onChange={e => setFormData(prev => ({ ...prev, symbol: e.target.value }))}
              placeholder="USDC"
              required
            />

            <Input
              label="Decimals"
              type="number"
              value={formData.decimals}
              onChange={e => setFormData(prev => ({ ...prev, decimals: e.target.value }))}
              placeholder="18"
            />
          </div>

          <Input
            label="Name (Optional)"
            value={formData.name}
            onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
            placeholder="USD Coin"
          />

          {error && <div className="text-error text-sm bg-red-50 p-3 rounded">{error}</div>}

          <div className="flex gap-3 justify-end">
            <Button variant="secondary" onClick={closeAddModal}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleAddToken} isLoading={isLoading} disabled={!selectedChain}>
              Add Token
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// Token row component
function TokenRow({ token, onRemove, isLoading }: { token: Token; onRemove: () => void; isLoading: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 hover:bg-gray-50">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center text-sm font-bold text-gray-600">
          {token.symbol.charAt(0)}
        </div>
        <div>
          <div className="font-medium">{token.symbol}</div>
          <div className="text-sm text-gray-500">{token.name}</div>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-right">
          <code className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">{truncateAddress(token.id)}</code>
          <div className="text-xs text-gray-400 mt-1">{token.decimals} decimals</div>
        </div>
        <button
          className="p-1 text-gray-400 hover:text-red-500 transition-colors"
          onClick={onRemove}
          disabled={isLoading}
          title="Remove token"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
        </button>
      </div>
    </div>
  )
}

// Helper to truncate address
function truncateAddress(address: string): string {
  if (address.length <= 14) return address
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

// Chain icon placeholder
function ChainIcon({ chain }: { chain: Chain }) {
  return (
    <div className="w-6 h-6 bg-primary/10 text-primary rounded-full flex items-center justify-center text-xs font-bold">
      {chain.charAt(0)}
    </div>
  )
}
