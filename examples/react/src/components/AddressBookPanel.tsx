import { useCallback, useEffect, useState } from 'react'
import type { AddressBook, Vultisig } from 'vultisig-sdk'

import { AddAddressForm } from './AddAddressForm'
import { EditAddressModal } from './EditAddressModal'

type AddressBookPanelProps = {
  sdk: Vultisig
  onAddressBookChange?: () => void
}

type EditingAddress = {
  chain: string
  address: string
  currentName: string
}

export const AddressBookPanel = ({
  sdk,
  onAddressBookChange,
}: AddressBookPanelProps) => {
  const [addressBook, setAddressBook] = useState<AddressBook>({
    saved: [],
    vaults: [],
  })
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingAddress, setEditingAddress] = useState<EditingAddress | null>(
    null
  )
  const [isLoading, setIsLoading] = useState(true)

  const loadAddressBook = useCallback(async () => {
    setIsLoading(true)
    try {
      const book = await sdk.getAddressBook()
      setAddressBook(book)
      onAddressBookChange?.()
    } catch (err) {
      console.error('Failed to load address book:', err)
    } finally {
      setIsLoading(false)
    }
  }, [sdk, onAddressBookChange])

  useEffect(() => {
    loadAddressBook()
  }, [loadAddressBook])

  const handleDelete = async (chain: string, address: string) => {
    if (!confirm('Are you sure you want to delete this address?')) {
      return
    }

    try {
      await sdk.removeAddressBookEntry([{ chain, address }])
      await loadAddressBook()
    } catch (err) {
      console.error('Failed to delete address:', err)
      alert('Failed to delete address: ' + (err as Error).message)
    }
  }

  const handleAddressAdded = async () => {
    setShowAddForm(false)
    await loadAddressBook()
  }

  const handleAddressUpdated = async () => {
    setEditingAddress(null)
    await loadAddressBook()
  }

  const allEntries = [...addressBook.saved, ...addressBook.vaults].sort(
    (a, b) => b.dateAdded - a.dateAdded
  )

  if (isLoading) {
    return (
      <div
        style={{
          border: '1px solid #e9ecef',
          borderRadius: 8,
          padding: 16,
        }}
      >
        <p style={{ color: '#666', margin: 0 }}>Loading address book...</p>
      </div>
    )
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        {!showAddForm ? (
          <button
            onClick={() => setShowAddForm(true)}
            style={{
              padding: '10px 16px',
              backgroundColor: '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            Add New Address
          </button>
        ) : (
          <AddAddressForm
            sdk={sdk}
            onAddressAdded={handleAddressAdded}
            onCancel={() => setShowAddForm(false)}
          />
        )}
      </div>

      <div
        style={{
          border: '1px solid #e9ecef',
          borderRadius: 8,
          padding: 16,
        }}
      >
        <h3 style={{ marginTop: 0, marginBottom: 16, color: '#333' }}>
          Saved Addresses ({allEntries.length})
        </h3>

        {allEntries.length === 0 ? (
          <p style={{ color: '#666', margin: 0 }}>
            No addresses saved yet. Add your first address above.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {allEntries.map(entry => (
              <div
                key={`${entry.chain}-${entry.address}`}
                style={{
                  border: '1px solid #e9ecef',
                  borderRadius: 6,
                  padding: 12,
                  backgroundColor: '#f8f9fa',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    marginBottom: 8,
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        marginBottom: 4,
                      }}
                    >
                      <span
                        style={{
                          fontWeight: 600,
                          color: '#333',
                          fontSize: 16,
                        }}
                      >
                        {entry.name}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          padding: '2px 6px',
                          borderRadius: 3,
                          backgroundColor:
                            entry.source === 'saved' ? '#007bff' : '#6c757d',
                          color: 'white',
                        }}
                      >
                        {entry.source}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: '#666',
                        marginBottom: 4,
                      }}
                    >
                      <strong>Chain:</strong>{' '}
                      {entry.chain.charAt(0).toUpperCase() +
                        entry.chain.slice(1)}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: '#666',
                        fontFamily: 'monospace',
                        wordBreak: 'break-all',
                        marginBottom: 4,
                      }}
                    >
                      <strong>Address:</strong> {entry.address}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: '#999',
                      }}
                    >
                      Added: {new Date(entry.dateAdded).toLocaleString()}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
                    <button
                      onClick={() =>
                        setEditingAddress({
                          chain: entry.chain,
                          address: entry.address,
                          currentName: entry.name,
                        })
                      }
                      style={{
                        padding: '4px 8px',
                        backgroundColor: '#007bff',
                        color: 'white',
                        border: 'none',
                        borderRadius: 4,
                        cursor: 'pointer',
                        fontSize: 12,
                      }}
                      title="Edit name"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(entry.chain, entry.address)}
                      style={{
                        padding: '4px 8px',
                        backgroundColor: '#dc3545',
                        color: 'white',
                        border: 'none',
                        borderRadius: 4,
                        cursor: 'pointer',
                        fontSize: 12,
                      }}
                      title="Delete address"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editingAddress && (
        <EditAddressModal
          sdk={sdk}
          chain={editingAddress.chain}
          address={editingAddress.address}
          currentName={editingAddress.currentName}
          isOpen={true}
          onClose={() => setEditingAddress(null)}
          onAddressUpdated={handleAddressUpdated}
        />
      )}
    </div>
  )
}
