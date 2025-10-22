import { useState } from 'react'
import type { Vultisig } from 'vultisig-sdk'

type AddAddressFormProps = {
  sdk: Vultisig
  onAddressAdded: () => void
  onCancel: () => void
}

const SUPPORTED_CHAINS = [
  'bitcoin',
  'ethereum',
  'solana',
  'cosmos',
  'sui',
  'polkadot',
  'avalanche',
  'bsc',
  'polygon',
  'arbitrum',
  'optimism',
  'base',
]

export const AddAddressForm = ({
  sdk,
  onAddressAdded,
  onCancel,
}: AddAddressFormProps) => {
  const [chain, setChain] = useState('bitcoin')
  const [address, setAddress] = useState('')
  const [name, setName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!chain || !address || !name) {
      setError('All fields are required')
      return
    }

    try {
      setIsSubmitting(true)
      await sdk.addAddressBookEntry([
        {
          chain,
          address: address.trim(),
          name: name.trim(),
          source: 'saved',
          dateAdded: Date.now(),
        },
      ])
      setChain('bitcoin')
      setAddress('')
      setName('')
      onAddressAdded()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div
      style={{
        border: '1px solid #e9ecef',
        borderRadius: 8,
        padding: 16,
        marginBottom: 16,
        backgroundColor: '#f8f9fa',
      }}
    >
      <h3 style={{ marginTop: 0, marginBottom: 16, color: '#333' }}>
        Add New Address
      </h3>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 12 }}>
          <label
            htmlFor="add-address-chain"
            style={{
              display: 'block',
              marginBottom: 4,
              fontSize: 14,
              color: '#333',
            }}
          >
            Chain
          </label>
          <select
            id="add-address-chain"
            value={chain}
            onChange={e => setChain(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: 4,
              border: '1px solid #ced4da',
              fontSize: 14,
            }}
            disabled={isSubmitting}
          >
            {SUPPORTED_CHAINS.map(c => (
              <option key={c} value={c}>
                {c.charAt(0).toUpperCase() + c.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label
            htmlFor="add-address-address"
            style={{
              display: 'block',
              marginBottom: 4,
              fontSize: 14,
              color: '#333',
            }}
          >
            Address
          </label>
          <input
            id="add-address-address"
            type="text"
            value={address}
            onChange={e => setAddress(e.target.value)}
            placeholder="Enter wallet address"
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: 4,
              border: '1px solid #ced4da',
              fontSize: 14,
              boxSizing: 'border-box',
            }}
            disabled={isSubmitting}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label
            htmlFor="add-address-name"
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
            id="add-address-name"
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

        <div style={{ display: 'flex', gap: 8 }}>
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
            {isSubmitting ? 'Adding...' : 'Add Address'}
          </button>
          <button
            type="button"
            onClick={onCancel}
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
        </div>
      </form>
    </div>
  )
}
