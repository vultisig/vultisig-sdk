import { useEffect, useState } from 'react'

import { vault } from '@/api/sdk-bridge'
import Button from '@/components/common/Button'
import Modal from '@/components/common/Modal'
import type { VaultInfo } from '@/types'
import { shortenAddress } from '@/utils/formatting'

type VaultTabsProps = {
  openVaults: VaultInfo[]
  activeVaultId: string | null
  onTabSwitch: (vaultId: string) => void
  onTabClose: (vaultId: string) => void
  onTabOpen: (vaultId: string) => void
}

export default function VaultTabs({ openVaults, activeVaultId, onTabSwitch, onTabClose, onTabOpen }: VaultTabsProps) {
  const [showVaultList, setShowVaultList] = useState(false)
  const [allVaults, setAllVaults] = useState<VaultInfo[]>([])

  // Load all vaults from SDK
  useEffect(() => {
    const loadVaults = async () => {
      try {
        const vaults = await vault.list()
        setAllVaults(vaults)
      } catch (err) {
        console.error('Failed to load vaults:', err)
      }
    }

    loadVaults()
  }, [openVaults]) // Reload when openVaults changes (new vault created/imported)

  const handleCloseTab = (e: React.MouseEvent, vaultId: string) => {
    e.stopPropagation()
    onTabClose(vaultId)
  }

  const handleOpenVault = (vaultId: string) => {
    onTabOpen(vaultId)
    setShowVaultList(false)
  }

  // Get vaults not currently open
  const closedVaults = allVaults.filter(v => !openVaults.some(open => open.id === v.id))

  return (
    <>
      <div className="border-b border-gray-200 mb-6">
        <div className="flex items-center gap-2 overflow-x-auto">
          {openVaults.map(v => (
            <div
              key={v.id}
              className={`
                group relative flex items-center gap-2 px-4 py-3
                transition-all duration-200 cursor-pointer rounded-t-lg
                min-w-[140px] max-w-[240px]
                ${
                  activeVaultId === v.id
                    ? 'bg-primary text-white'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }
              `}
              onClick={() => onTabSwitch(v.id)}
              onKeyDown={e => e.key === 'Enter' && onTabSwitch(v.id)}
              role="button"
              tabIndex={0}
            >
              {/* Tab content */}
              <div className="flex items-center gap-2 flex-1 overflow-hidden">
                <span className="font-medium truncate">{v.name}</span>
                <span
                  className={`text-xs font-mono shrink-0 ${activeVaultId === v.id ? 'text-blue-200' : 'text-gray-400'}`}
                >
                  {shortenAddress(v.id, 4)}
                </span>
              </div>

              {/* Close button */}
              <button
                className={`
                  ml-1 p-1 rounded transition-all duration-150
                  ${
                    activeVaultId === v.id
                      ? 'text-blue-200 hover:text-white hover:bg-blue-600'
                      : 'text-gray-400 hover:text-gray-700 hover:bg-gray-200'
                  }
                `}
                onClick={e => handleCloseTab(e, v.id)}
                aria-label="Close tab"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}

          {closedVaults.length > 0 && (
            <button
              className="
                flex items-center gap-1.5 px-4 py-3
                text-sm text-gray-500 hover:text-gray-700
                hover:bg-gray-50
                transition-all duration-200
                whitespace-nowrap
              "
              onClick={() => setShowVaultList(true)}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Open Vault
            </button>
          )}
        </div>

        {openVaults.length === 0 && (
          <div className="p-6 text-center text-gray-500 text-sm">
            No vaults open. Create or import a vault to get started.
          </div>
        )}
      </div>

      <Modal isOpen={showVaultList} onClose={() => setShowVaultList(false)} title="Open Vault">
        <div className="vault-list-modal">
          {closedVaults.length === 0 ? (
            <p className="text-gray-500 text-center py-4">All vaults are already open.</p>
          ) : (
            <div className="space-y-2">
              {closedVaults.map(v => (
                <div
                  key={v.id}
                  className="flex items-center justify-between p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() => handleOpenVault(v.id)}
                  onKeyDown={e => e.key === 'Enter' && handleOpenVault(v.id)}
                  role="button"
                  tabIndex={0}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium">{v.name}</span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded ${
                          v.type === 'secure' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
                        }`}
                      >
                        {v.type === 'secure' ? 'Secure' : 'Fast'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-gray-500">
                      <span className="font-mono">{shortenAddress(v.id, 6)}</span>
                      <span>{v.chains.length} chains</span>
                    </div>
                  </div>
                  <Button variant="secondary" size="small">
                    Open
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </>
  )
}
