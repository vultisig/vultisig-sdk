import type { ServerStatus as ServerStatusType } from '../hooks/useServerStatus'

type ServerStatusProps = {
  status: ServerStatusType
}

export function ServerStatus({ status }: ServerStatusProps) {
  const getStatusColor = () => {
    switch (status) {
      case 'online':
        return '#28a745'
      case 'offline':
        return '#dc3545'
      default:
        return '#ffc107'
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <div
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: getStatusColor(),
          }}
        ></div>
        <span
          style={{
            fontSize: '13px',
            fontWeight: '600',
            color: getStatusColor(),
            textTransform: 'capitalize',
          }}
        >
          Server {status}
        </span>
      </div>
      <button
        onClick={() => location.reload()}
        title="Refresh page"
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '4px',
          borderRadius: '4px',
          display: 'flex',
          alignItems: 'center',
          color: '#666',
        }}
      >
        refresh
      </button>
    </div>
  )
}
