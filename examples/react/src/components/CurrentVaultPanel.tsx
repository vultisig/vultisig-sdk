import type { VultisigSDK } from 'vultisig-sdk'

export const CurrentVaultPanel = ({
  onDisconnect,
  onOpenExport,
}: {
  vault: any
  sdk: VultisigSDK
  serverVerified: boolean
  onDisconnect: () => void
  onOpenExport: () => void
}) => {
  return (
    <>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <h3 style={{ margin: 0, color: '#333' }}>Current Vault</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onOpenExport}
            style={{
              padding: '8px 12px',
              backgroundColor: '#198754',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Export
          </button>
          <button
            onClick={onDisconnect}
            style={{
              padding: '8px 12px',
              backgroundColor: '#6c757d',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Disconnect
          </button>
        </div>
      </div>
    </>
  )
}
