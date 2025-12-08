import { useEffect, useState } from 'react'

import Button from '@/components/common/Button'
import Modal from '@/components/common/Modal'
import Spinner from '@/components/common/Spinner'
import { getSDK } from '@/utils/sdk'

type ServerStatusProps = {
  isOpen: boolean
  onClose: () => void
}

type ServerInfo = {
  fastVault: {
    online: boolean
    latency?: number
  }
  messageRelay: {
    online: boolean
    latency?: number
  }
  timestamp: number
}

export default function ServerStatus({ isOpen, onClose }: ServerStatusProps) {
  const [status, setStatus] = useState<ServerInfo | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      loadStatus()
    }
  }, [isOpen])

  const loadStatus = async () => {
    setIsLoading(true)
    setError(null)

    try {
      const sdk = getSDK()
      const serverStatus = await sdk.getServerStatus()
      setStatus(serverStatus)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check server status')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Server Status">
      <div className="space-y-4">
        {isLoading && !status ? (
          <div className="flex items-center justify-center py-8">
            <Spinner size="large" />
          </div>
        ) : error ? (
          <div className="text-error text-sm bg-red-50 p-3 rounded">{error}</div>
        ) : status ? (
          <div className="space-y-4">
            {/* FastVault Server */}
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">FastVault Server</h3>
                <StatusBadge online={status.fastVault.online} />
              </div>
              {status.fastVault.latency !== undefined && (
                <div className="text-sm text-gray-500">
                  Latency: <span className="font-mono">{status.fastVault.latency}ms</span>
                </div>
              )}
            </div>

            {/* Relay Server */}
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">Message Relay Server</h3>
                <StatusBadge online={status.messageRelay.online} />
              </div>
              {status.messageRelay.latency !== undefined && (
                <div className="text-sm text-gray-500">
                  Latency: <span className="font-mono">{status.messageRelay.latency}ms</span>
                </div>
              )}
            </div>

            {/* Info */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-700">
              <p>
                <strong>FastVault Server</strong> handles vault creation and signing coordination for Fast Vaults.
              </p>
              <p className="mt-2">
                <strong>Message Relay Server</strong> facilitates communication between signing parties.
              </p>
            </div>
          </div>
        ) : null}

        <div className="flex justify-end">
          <Button variant="secondary" onClick={loadStatus} isLoading={isLoading}>
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            Refresh
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function StatusBadge({ online }: { online: boolean }) {
  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-sm font-medium ${
        online ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
      }`}
    >
      <div className={`w-2 h-2 rounded-full ${online ? 'bg-green-500' : 'bg-red-500'}`} />
      {online ? 'Online' : 'Offline'}
    </div>
  )
}
