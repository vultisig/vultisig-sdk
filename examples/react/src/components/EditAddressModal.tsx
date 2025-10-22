import { useState } from 'react'
import type { Vultisig } from 'vultisig-sdk'

type EditAddressModalProps = {
  sdk: Vultisig
  chain: string
  address: string
  currentName: string
  isOpen: boolean
  onClose: () => void
  onAddressUpdated: () => void
}

export const EditAddressModal = ({
  sdk,
  chain,
  address,
  currentName,
  isOpen,
  onClose,
  onAddressUpdated,
}: EditAddressModalProps) => {
  const [name, setName] = useState(currentName)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!name.trim()) {
      setError('Name is required')
      return
    }

    try {
      setIsSubmitting(true)
      await sdk.updateAddressBookEntry(chain, address, name.trim())
      onAddressUpdated()
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div
      role="presentation"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
      onKeyDown={e => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <div
        style={{
          backgroundColor: 'white',
          borderRadius: 8,
          padding: 24,
          maxWidth: 500,
          width: '90%',
          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
        }}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => e.stopPropagation()}
        role="button"
        tabIndex={0}
      >
        <h2 style={{ marginTop: 0, marginBottom: 16, color: '#333' }}>
          Edit Address
        </h2>

        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              display: 'block',
              marginBottom: 4,
              fontSize: 14,
              color: '#666',
              fontWeight: 600,
            }}
          >
            Chain
          </div>
          <div
            style={{
              padding: '8px 12px',
              backgroundColor: '#f8f9fa',
              borderRadius: 4,
              fontSize: 14,
              color: '#333',
            }}
          >
            {chain.charAt(0).toUpperCase() + chain.slice(1)}
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              display: 'block',
              marginBottom: 4,
              fontSize: 14,
              color: '#666',
              fontWeight: 600,
            }}
          >
            Address
          </div>
          <div
            style={{
              padding: '8px 12px',
              backgroundColor: '#f8f9fa',
              borderRadius: 4,
              fontSize: 12,
              color: '#333',
              fontFamily: 'monospace',
              wordBreak: 'break-all',
            }}
          >
            {address}
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 12 }}>
            <label
              htmlFor="edit-address-name"
              style={{
                display: 'block',
                marginBottom: 4,
                fontSize: 14,
                color: '#333',
              }}
            >
              Name
            </label>
            <input
              id="edit-address-name"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Enter a friendly name"
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 4,
                border: '1px solid #ced4da',
                fontSize: 14,
                boxSizing: 'border-box',
              }}
              disabled={isSubmitting}
              autoFocus
            />
          </div>

          {error && (
            <div
              style={{
                padding: 8,
                marginBottom: 12,
                backgroundColor: '#f8d7da',
                color: '#721c24',
                borderRadius: 4,
                fontSize: 14,
              }}
            >
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              style={{
                padding: '8px 16px',
                backgroundColor: 'transparent',
                color: '#6c757d',
                border: '1px solid #6c757d',
                borderRadius: 4,
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                fontSize: 14,
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                padding: '8px 16px',
                backgroundColor: isSubmitting ? '#6c757d' : '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: 4,
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                fontSize: 14,
              }}
            >
              {isSubmitting ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
