import { useCallback, useEffect, useState } from 'react'
import type { Vultisig } from 'vultisig-sdk'

type SettingsPanelProps = {
  sdk: Vultisig
}

const AVAILABLE_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'CNY',
  'AUD',
  'CAD',
  'CHF',
  'KRW',
]

export const SettingsPanel = ({ sdk }: SettingsPanelProps) => {
  const [currency, setCurrency] = useState('USD')
  const [selectedChains, setSelectedChains] = useState<string[]>([])
  const [availableChains, setAvailableChains] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)

  const loadSettings = useCallback(async () => {
    setIsLoading(true)
    try {
      const settings = await sdk.getSettings()
      const allChains = sdk.getSupportedChains()

      setCurrency(settings.defaultCurrency || 'USD')
      setSelectedChains(
        settings.defaultChains || [
          'Bitcoin',
          'Ethereum',
          'Solana',
          'THORChain',
          'Ripple',
        ]
      )
      setAvailableChains(allChains)
    } catch (err) {
      console.error('Failed to load settings:', err)
    } finally {
      setIsLoading(false)
    }
  }, [sdk])

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  const handleSave = async () => {
    setIsSaving(true)
    setSaveMessage(null)

    try {
      await sdk.saveSettings({
        defaultCurrency: currency,
        defaultChains: selectedChains,
      })

      // Update SDK in-memory settings
      sdk.setDefaultCurrency(currency)
      sdk.setDefaultChains(selectedChains)

      setSaveMessage('Settings saved successfully!')
      setTimeout(() => setSaveMessage(null), 3000)
    } catch (err) {
      setSaveMessage(`Failed to save: ${(err as Error).message}`)
    } finally {
      setIsSaving(false)
    }
  }

  const toggleChain = (chain: string) => {
    setSelectedChains(prev =>
      prev.includes(chain) ? prev.filter(c => c !== chain) : [...prev, chain]
    )
  }

  const selectAll = () => {
    setSelectedChains([...availableChains])
  }

  const deselectAll = () => {
    setSelectedChains([])
  }

  if (isLoading) {
    return (
      <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
        Loading settings...
      </div>
    )
  }

  return (
    <div style={{ padding: '20px 0' }}>
      {/* Currency Section */}
      <div
        style={{
          marginBottom: '32px',
          padding: '20px',
          backgroundColor: '#f8f9fa',
          borderRadius: '8px',
          border: '1px solid #e9ecef',
        }}
      >
        <h3 style={{ margin: '0 0 16px 0', color: '#333', fontSize: '18px' }}>
          Default Currency
        </h3>
        <select
          value={currency}
          onChange={e => setCurrency(e.target.value)}
          style={{
            width: '200px',
            padding: '10px',
            fontSize: '14px',
            border: '1px solid #ced4da',
            borderRadius: '6px',
            backgroundColor: 'white',
            cursor: 'pointer',
          }}
        >
          {AVAILABLE_CURRENCIES.map(curr => (
            <option key={curr} value={curr}>
              {curr}
            </option>
          ))}
        </select>
      </div>

      {/* Chains Section */}
      <div
        style={{
          padding: '20px',
          backgroundColor: '#f8f9fa',
          borderRadius: '8px',
          border: '1px solid #e9ecef',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '16px',
          }}
        >
          <h3 style={{ margin: 0, color: '#333', fontSize: '18px' }}>
            Default Chains ({selectedChains.length} selected)
          </h3>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={selectAll}
              style={{
                padding: '6px 12px',
                fontSize: '12px',
                backgroundColor: '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              Select All
            </button>
            <button
              onClick={deselectAll}
              style={{
                padding: '6px 12px',
                fontSize: '12px',
                backgroundColor: '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              Deselect All
            </button>
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: '8px',
            maxHeight: '400px',
            overflowY: 'auto',
            padding: '8px',
            backgroundColor: 'white',
            borderRadius: '6px',
            border: '1px solid #dee2e6',
          }}
        >
          {availableChains.map(chain => (
            <label
              key={chain}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '8px',
                cursor: 'pointer',
                borderRadius: '4px',
                backgroundColor: selectedChains.includes(chain)
                  ? '#e7f3ff'
                  : 'transparent',
                border: `1px solid ${selectedChains.includes(chain) ? '#007bff' : 'transparent'}`,
                transition: 'all 0.2s',
              }}
            >
              <input
                type="checkbox"
                checked={selectedChains.includes(chain)}
                onChange={() => toggleChain(chain)}
                style={{
                  marginRight: '8px',
                  cursor: 'pointer',
                  width: '16px',
                  height: '16px',
                }}
              />
              <span style={{ fontSize: '14px', color: '#333' }}>{chain}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Save Button */}
      <div style={{ marginTop: '24px', textAlign: 'right' }}>
        {saveMessage && (
          <span
            style={{
              marginRight: '16px',
              fontSize: '14px',
              color: saveMessage.includes('success') ? '#28a745' : '#dc3545',
            }}
          >
            {saveMessage}
          </span>
        )}
        <button
          onClick={handleSave}
          disabled={isSaving}
          style={{
            padding: '12px 24px',
            fontSize: '16px',
            backgroundColor: isSaving ? '#6c757d' : '#28a745',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: isSaving ? 'not-allowed' : 'pointer',
            fontWeight: 500,
          }}
        >
          {isSaving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  )
}

