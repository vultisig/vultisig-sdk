import { useState } from 'react'

export const ExportModal = ({
  isOpen,
  onClose,
  onExport,
  exporting,
  error,
}: {
  isOpen: boolean
  onClose: () => void
  onExport: (password?: string) => Promise<void>
  exporting: boolean
  error?: string | null
}) => {
  const [password, setPassword] = useState('')

  if (!isOpen) return null

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          backgroundColor: '#fff',
          padding: 20,
          borderRadius: 8,
          width: '90vw',
          maxWidth: 420,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <h3 style={{ margin: 0, color: '#333' }}>Export Vault</h3>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: 18,
              cursor: 'pointer',
            }}
          >
            x
          </button>
        </div>
        <div style={{ marginBottom: 12, color: '#666' }}>Optionally protect the exported .vult with a password.</div>
        <input
          type="password"
          placeholder="Password (optional)"
          value={password}
          onChange={e => setPassword(e.target.value)}
          style={{
            width: '100%',
            padding: 10,
            borderRadius: 6,
            border: '1px solid #e9ecef',
            boxSizing: 'border-box',
            marginBottom: 12,
          }}
        />
        {error && <div style={{ color: '#dc3545', fontSize: 12, marginBottom: 8 }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 12px',
              backgroundColor: '#6c757d',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => onExport(password || undefined)}
            disabled={exporting}
            style={{
              padding: '8px 12px',
              backgroundColor: exporting ? '#6c757d' : '#198754',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            {exporting ? 'Exporting…' : 'Export .vult'}
          </button>
        </div>
      </div>
    </div>
  )
}
