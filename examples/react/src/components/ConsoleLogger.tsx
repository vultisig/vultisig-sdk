import React, { useEffect, useRef } from 'react'

type LogEntry = {
  timestamp: string
  level: string
  message: string
}

type ConsoleLoggerProps = {
  logs: LogEntry[]
}

const ConsoleLogger: React.FC<ConsoleLoggerProps> = ({ logs }) => {
  const logContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Auto-scroll to bottom when new logs are added
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [logs])

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'error':
        return '#dc3545'
      case 'warn':
        return '#ffc107'
      case 'success':
        return '#28a745'
      case 'info':
      default:
        return '#6c757d'
    }
  }

  const getLevelIcon = (level: string) => {
    switch (level) {
      case 'error':
        return '[error]'
      case 'warn':
        return '[warn]'
      case 'success':
        return '[ok]'
      case 'info':
      default:
        return '[info]'
    }
  }

  return (
    <div
      style={{
        backgroundColor: 'white',
        borderRadius: '8px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '15px 20px',
          backgroundColor: '#f8f9fa',
          borderBottom: '1px solid #dee2e6',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: '16px',
            fontWeight: '600',
            color: '#333',
          }}
        >
          Console Output
        </h3>
        <span
          style={{
            fontSize: '12px',
            color: '#6c757d',
            backgroundColor: '#e9ecef',
            padding: '2px 8px',
            borderRadius: '12px',
          }}
        >
          {logs.length} logs
        </span>
      </div>

      <div
        ref={logContainerRef}
        style={{
          height: '200px',
          overflowY: 'auto',
          padding: '10px',
          backgroundColor: '#1e1e1e',
          fontFamily:
            'Monaco, "Cascadia Code", "Roboto Mono", Consolas, "Courier New", monospace',
          fontSize: '12px',
          lineHeight: '1.4',
        }}
      >
        {logs.length === 0 ? (
          <div
            style={{
              color: '#6c757d',
              textAlign: 'center',
              padding: '40px 20px',
              fontStyle: 'italic',
            }}
          >
            Console output will appear here...
          </div>
        ) : (
          logs.map((log, index) => (
            <div
              key={index}
              style={{
                marginBottom: '4px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
              }}
            >
              <span
                style={{
                  color: '#888',
                  fontSize: '11px',
                  minWidth: '65px',
                  flexShrink: 0,
                }}
              >
                {log.timestamp}
              </span>
              <span style={{ flexShrink: 0 }}>{getLevelIcon(log.level)}</span>
              <span
                style={{
                  color: getLevelColor(log.level),
                  wordBreak: 'break-word',
                  flex: 1,
                }}
              >
                {log.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default ConsoleLogger
