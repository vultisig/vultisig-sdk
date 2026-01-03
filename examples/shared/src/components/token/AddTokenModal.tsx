import { useEffect, useState } from 'react'

import { useSDKAdapter } from '../../adapters'
import { type CommonToken, getCommonTokens, isEvmChain } from '../../constants/tokens'
import type { TokenInfo, VaultInfo } from '../../types'
import Button from '../common/Button'
import Input from '../common/Input'
import Modal from '../common/Modal'

type AddTokenModalProps = {
  isOpen: boolean
  onClose: () => void
  chain: string
  vault: VaultInfo
  onTokenAdded?: (tokenId: string) => void
}

export default function AddTokenModal({ isOpen, onClose, chain, vault, onTokenAdded }: AddTokenModalProps) {
  const sdk = useSDKAdapter()

  const [existingTokenIds, setExistingTokenIds] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [formData, setFormData] = useState({
    contractAddress: '',
    symbol: '',
    name: '',
    decimals: '18',
  })
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showManualForm, setShowManualForm] = useState(false)

  // Load existing tokens to filter suggestions
  useEffect(() => {
    if (!isOpen || !chain) return

    const loadExistingTokens = async () => {
      try {
        const tokens = await sdk.getTokens(vault.id, chain)
        setExistingTokenIds(tokens.map(t => t.id.toLowerCase()))
      } catch (err) {
        console.error('Failed to load existing tokens:', err)
        setExistingTokenIds([])
      }
    }

    loadExistingTokens()
  }, [sdk, vault.id, chain, isOpen])

  const commonTokens = getCommonTokens(chain)

  // Filter common tokens by search and exclude already added
  const filteredTokens = commonTokens.filter(token => {
    const isAlreadyAdded = existingTokenIds.includes(token.contractAddress.toLowerCase())
    if (isAlreadyAdded) return false

    if (!searchQuery) return true
    const query = searchQuery.toLowerCase()
    return (
      token.symbol.toLowerCase().includes(query) ||
      token.name.toLowerCase().includes(query) ||
      token.contractAddress.toLowerCase().includes(query)
    )
  })

  const handleAddCommonToken = async (token: CommonToken) => {
    setIsLoading(true)
    setError(null)

    try {
      const newToken: TokenInfo = {
        id: token.contractAddress,
        symbol: token.symbol,
        name: token.name,
        decimals: token.decimals,
        contractAddress: token.contractAddress,
        chainId: chain,
      }

      await sdk.addToken(vault.id, chain, newToken)
      onTokenAdded?.(newToken.id)
      handleClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add token')
    } finally {
      setIsLoading(false)
    }
  }

  const handleAddCustomToken = async () => {
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
      const token: TokenInfo = {
        id: formData.contractAddress,
        symbol: formData.symbol.toUpperCase(),
        name: formData.name || formData.symbol,
        decimals: parseInt(formData.decimals, 10) || 18,
        contractAddress: formData.contractAddress,
        chainId: chain,
      }

      await sdk.addToken(vault.id, chain, token)
      onTokenAdded?.(token.id)
      handleClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add token')
    } finally {
      setIsLoading(false)
    }
  }

  const handleClose = () => {
    setSearchQuery('')
    setFormData({ contractAddress: '', symbol: '', name: '', decimals: '18' })
    setError(null)
    setShowManualForm(false)
    onClose()
  }

  const isEvm = isEvmChain(chain)

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={`Add Token (${chain})`}>
      <div className="space-y-4">
        {/* Search input */}
        {isEvm && commonTokens.length > 0 && !showManualForm && (
          <Input
            placeholder="Search tokens or paste address..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        )}

        {/* Common token suggestions */}
        {isEvm && !showManualForm && filteredTokens.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm text-gray-500">Popular tokens</div>
            <div className="flex flex-wrap gap-2">
              {filteredTokens.map(token => (
                <button
                  key={token.contractAddress}
                  type="button"
                  onClick={() => handleAddCommonToken(token)}
                  disabled={isLoading}
                  className="inline-flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                >
                  <span className="w-6 h-6 bg-primary/10 text-primary rounded-full flex items-center justify-center text-xs font-bold">
                    {token.symbol.charAt(0)}
                  </span>
                  {token.symbol}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Show manual form toggle */}
        {isEvm && !showManualForm && (
          <button
            type="button"
            onClick={() => setShowManualForm(true)}
            className="text-sm text-primary hover:underline"
          >
            Add custom token by contract address
          </button>
        )}

        {/* Manual entry form */}
        {(showManualForm || !isEvm) && (
          <div className="space-y-4">
            {isEvm && (
              <button
                type="button"
                onClick={() => setShowManualForm(false)}
                className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back to suggestions
              </button>
            )}

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

            <Button
              variant="primary"
              fullWidth
              onClick={handleAddCustomToken}
              isLoading={isLoading}
              disabled={!formData.contractAddress || !formData.symbol}
            >
              Add Token
            </Button>
          </div>
        )}

        {/* Error message */}
        {error && <div className="text-error text-sm bg-red-50 p-3 rounded">{error}</div>}

        {/* No suggestions available message */}
        {isEvm && !showManualForm && filteredTokens.length === 0 && searchQuery && (
          <div className="text-center py-4 text-gray-500 text-sm">No tokens found. Try adding a custom token.</div>
        )}

        {/* Cancel button */}
        <div className="flex justify-end">
          <Button variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  )
}
