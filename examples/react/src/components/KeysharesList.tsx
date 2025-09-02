import type { StoredKeyshare } from '../hooks/useKeysharesStorage'
import type { LoadedKeyshare } from '../types'

type KeysharesListProps = {
  keyshares: LoadedKeyshare[]
  storedKeyshares?: StoredKeyshare[]
  onLoadKeyshare: (keyshare: LoadedKeyshare) => void
  onRemoveStoredKeyshare?: (keyshareId: string) => void
}

export const KeysharesList = ({
  keyshares,
  storedKeyshares = [],
  onLoadKeyshare,
  onRemoveStoredKeyshare,
}: KeysharesListProps) => (
  <div style={{ border: '1px solid #e9ecef', borderRadius: 8, padding: 12 }}>
    <h3 style={{ marginTop: 0, color: '#333' }}>Vault Files</h3>

    {/* Current Session Keyshares */}
    {keyshares.length > 0 && (
      <div style={{ marginBottom: 16 }}>
        <h4 style={{ margin: '0 0 8px 0', fontSize: 14, color: '#666' }}>
          Current Session
        </h4>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          {keyshares.map(k => (
            <li
              key={k.name}
              style={{
                color: '#333',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 4,
              }}
            >
              <span>
                {k.encrypted ? '[encrypted] ' : '[file] '}
                {k.name}
              </span>
              <span style={{ color: '#999', fontSize: 12 }}>
                ({Math.round(k.size / 1024)} KB)
              </span>
              <button
                onClick={() => onLoadKeyshare(k)}
                style={{
                  marginLeft: 8,
                  padding: '4px 8px',
                  borderRadius: 4,
                  border: '1px solid #007bff',
                  background: '#007bff',
                  color: 'white',
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                Load
              </button>
            </li>
          ))}
        </ul>
      </div>
    )}

    {/* Stored Keyshares */}
    {storedKeyshares.length > 0 && (
      <div>
        <h4 style={{ margin: '0 0 8px 0', fontSize: 14, color: '#666' }}>
          Previously Added ({storedKeyshares.length})
        </h4>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          {storedKeyshares.map(k => (
            <li
              key={k.id}
              style={{
                color: '#666',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 4,
              }}
            >
              <span>
                {k.encrypted ? '[encrypted] ' : '[file] '}
                {k.name}
              </span>
              <span style={{ color: '#999', fontSize: 12 }}>
                ({Math.round((k.size ?? 0) / 1024)} KB)
              </span>
              <span style={{ color: '#999', fontSize: 10 }}>
                {new Date(k.dateAdded).toLocaleDateString()}
              </span>
              {onRemoveStoredKeyshare && (
                <button
                  onClick={() => onRemoveStoredKeyshare(k.id)}
                  style={{
                    marginLeft: 8,
                    padding: '2px 6px',
                    borderRadius: 3,
                    border: '1px solid #dc3545',
                    background: 'transparent',
                    color: '#dc3545',
                    cursor: 'pointer',
                    fontSize: 10,
                  }}
                >
                  x
                </button>
              )}
            </li>
          ))}
        </ul>
        <p
          style={{
            margin: '8px 0 0 0',
            fontSize: 12,
            color: '#666',
            fontStyle: 'italic',
          }}
        >
          To load these files, please re-upload them using &quot;Add Vault&quot;
          button.
        </p>
      </div>
    )}

    {keyshares.length === 0 && storedKeyshares.length === 0 && (
      <p style={{ color: '#666', margin: 0 }}>
        No vault files found. Use &quot;Add Vault&quot; to select .vult files.
      </p>
    )}
  </div>
)
