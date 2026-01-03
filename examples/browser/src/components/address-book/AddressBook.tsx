import { Button, Input, Modal, Select } from '@vultisig/examples-shared'
import { Chain } from '@vultisig/sdk'
import { useEffect, useState } from 'react'

import { getSDK } from '@/utils/sdk'

type AddressBookEntry = {
  address: string
  name: string
  chain: Chain
  source: 'saved' | 'vault'
  dateAdded: number
}

type AddressBookProps = {
  isOpen: boolean
  onClose: () => void
  onSelectAddress?: (address: string, chain: Chain) => void
  filterChain?: Chain
}

const ALL_CHAINS = Object.values(Chain) as Chain[]

export default function AddressBook({ isOpen, onClose, onSelectAddress, filterChain }: AddressBookProps) {
  const [entries, setEntries] = useState<AddressBookEntry[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [formData, setFormData] = useState({
    address: '',
    name: '',
    chain: filterChain || (ALL_CHAINS[0] as Chain),
  })
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  // Load address book
  useEffect(() => {
    if (isOpen) {
      loadAddressBook()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, filterChain])

  const loadAddressBook = async () => {
    setIsLoading(true)
    try {
      const sdk = getSDK()
      const book = await sdk.getAddressBook(filterChain)
      // Combine saved and vault addresses
      const allEntries: AddressBookEntry[] = [
        ...book.saved.map((e: any) => ({ ...e, source: 'saved' })),
        ...book.vaults.map((e: any) => ({ ...e, source: 'vault' })),
      ]
      setEntries(allEntries)
    } catch (err) {
      console.error('Failed to load address book:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleAdd = async () => {
    if (!formData.address || !formData.name || !formData.chain) {
      setError('All fields are required')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const sdk = getSDK()
      await sdk.addAddressBookEntry([
        {
          address: formData.address,
          name: formData.name,
          chain: formData.chain,
          source: 'saved',
          dateAdded: Date.now(),
        },
      ])

      await loadAddressBook()
      closeAddModal()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add address')
    } finally {
      setIsLoading(false)
    }
  }

  const handleRemove = async (entry: AddressBookEntry) => {
    if (!confirm(`Remove "${entry.name}" from address book?`)) return

    setIsLoading(true)
    try {
      const sdk = getSDK()
      await sdk.removeAddressBookEntry([
        {
          address: entry.address,
          chain: entry.chain,
        },
      ])
      await loadAddressBook()
    } catch (err) {
      console.error('Failed to remove address:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSelect = (entry: AddressBookEntry) => {
    onSelectAddress?.(entry.address, entry.chain)
    onClose()
  }

  const closeAddModal = () => {
    setIsAddOpen(false)
    setFormData({
      address: '',
      name: '',
      chain: filterChain || (ALL_CHAINS[0] as Chain),
    })
    setError(null)
  }

  // Filter entries by search query
  const filteredEntries = entries.filter(
    entry =>
      entry.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      entry.address.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Address Book">
      <div className="space-y-4">
        {/* Search and Add */}
        <div className="flex gap-2">
          <Input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search addresses..."
            className="flex-1"
          />
          <Button variant="primary" onClick={() => setIsAddOpen(true)}>
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add
          </Button>
        </div>

        {/* Entries list */}
        {isLoading && entries.length === 0 ? (
          <div className="text-center py-8 text-gray-500">Loading...</div>
        ) : filteredEntries.length === 0 ? (
          <div className="text-center py-8">
            <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                />
              </svg>
            </div>
            <p className="text-gray-500 mb-3">
              {searchQuery ? 'No addresses match your search' : 'No addresses saved'}
            </p>
            {!searchQuery && (
              <Button variant="secondary" size="small" onClick={() => setIsAddOpen(true)}>
                Add Your First Address
              </Button>
            )}
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto divide-y divide-gray-100 border border-gray-200 rounded-lg">
            {filteredEntries.map((entry, idx) => (
              <div
                key={`${entry.address}-${idx}`}
                className="flex items-center justify-between p-3 hover:bg-gray-50 cursor-pointer"
                role="button"
                tabIndex={0}
                onClick={() => onSelectAddress && handleSelect(entry)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    if (onSelectAddress) handleSelect(entry)
                  }
                }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 bg-primary/10 text-primary rounded-full flex items-center justify-center font-bold shrink-0">
                    {entry.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium truncate">{entry.name}</div>
                    <div className="text-sm text-gray-500 flex items-center gap-2">
                      <span className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{entry.chain}</span>
                      <code className="truncate">{truncateAddress(entry.address)}</code>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {onSelectAddress && (
                    <Button variant="secondary" size="small" onClick={() => handleSelect(entry)}>
                      Select
                    </Button>
                  )}
                  <button
                    className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                    onClick={e => {
                      e.stopPropagation()
                      handleRemove(entry)
                    }}
                    title="Remove"
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
            ))}
          </div>
        )}

        {/* Add Address Modal */}
        <Modal isOpen={isAddOpen} onClose={closeAddModal} title="Add Address">
          <div className="space-y-4">
            <Input
              label="Name / Label"
              value={formData.name}
              onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
              placeholder="e.g., My Exchange Wallet"
              required
            />

            <Select
              label="Chain"
              options={ALL_CHAINS.map(chain => ({ value: chain, label: chain }))}
              value={formData.chain}
              onChange={e => setFormData(prev => ({ ...prev, chain: e.target.value as Chain }))}
            />

            <Input
              label="Address"
              value={formData.address}
              onChange={e => setFormData(prev => ({ ...prev, address: e.target.value }))}
              placeholder="Enter wallet address"
              required
            />

            {error && <div className="text-error text-sm bg-red-50 p-3 rounded">{error}</div>}

            <div className="flex gap-3 justify-end">
              <Button variant="secondary" onClick={closeAddModal}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleAdd} isLoading={isLoading}>
                Add Address
              </Button>
            </div>
          </div>
        </Modal>
      </div>
    </Modal>
  )
}

function truncateAddress(address: string): string {
  if (address.length <= 16) return address
  return `${address.slice(0, 8)}...${address.slice(-6)}`
}
