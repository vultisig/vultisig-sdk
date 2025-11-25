import type { VaultBase } from '@vultisig/sdk'
import { useEffect, useState } from 'react'

import Button from '@/components/common/Button'
import Modal from '@/components/common/Modal'
import { shortenAddress } from '@/utils/formatting'

type VaultTabsProps = {
  sdk: any
  openVaults: VaultBase[]
  onTabSwitch: (vaultId: string) => void
  onTabClose: (vaultId: string) => void
  onTabOpen: (vaultId: string) => void
}

export default function VaultTabs({ sdk, openVaults, onTabSwitch, onTabClose, onTabOpen }: VaultTabsProps) {
  const [showVaultList, setShowVaultList] = useState(false)
  const [allVaults, setAllVaults] = useState<VaultBase[]>([])
  const [activeVaultId, setActiveVaultId] = useState<string | null>(null)

  // Load all vaults from SDK
  useEffect(() => {
    if (!sdk) return

    const loadVaults = async () => {
      const vaults = await sdk.listVaults()
      setAllVaults(vaults)
    }

    loadVaults()
  }, [sdk, openVaults]) // Reload when openVaults changes (new vault created/imported)

  // Track active vault from SDK
  useEffect(() => {
    if (!sdk) return

    const loadActiveVault = async () => {
      const activeVault = await sdk.getActiveVault()
      setActiveVaultId(activeVault?.id || null)
    }

    loadActiveVault()

    const handleVaultChanged = async () => {
      const activeVault = await sdk.getActiveVault()
      setActiveVaultId(activeVault?.id || null)
    }

    sdk.on('vaultChanged', handleVaultChanged)

    return () => {
      sdk.off('vaultChanged', handleVaultChanged)
    }
  }, [sdk])

  const handleCloseTab = (e: React.MouseEvent, vaultId: string) => {
    e.stopPropagation()
    onTabClose(vaultId)
  }

  const handleOpenVault = (vaultId: string) => {
    onTabOpen(vaultId)
    setShowVaultList(false)
  }

  // Get vaults not currently open
  const closedVaults = allVaults.filter(vault => !openVaults.some(open => open.id === vault.id))

  return (
    <>
      <div className="border-b border-gray-200 mb-6">
        <div className="flex items-center gap-2 overflow-x-auto">
          {openVaults.map(vault => (
            <div
              key={vault.id}
              className={`
                group relative flex items-center gap-2 px-4 py-3
                transition-all duration-200 cursor-pointer
                min-w-[140px] max-w-[240px]
                ${activeVaultId === vault.id ? 'text-gray-900' : 'text-gray-600 hover:text-gray-900'}
              `}
              onClick={() => onTabSwitch(vault.id)}
              onKeyDown={e => e.key === 'Enter' && onTabSwitch(vault.id)}
              role="button"
              tabIndex={0}
            >
              {/* Active indicator - bottom border */}
              <div
                className={`
                  absolute bottom-0 left-0 right-0 h-0.5 transition-all duration-200
                  ${activeVaultId === vault.id ? 'bg-primary' : 'bg-transparent group-hover:bg-gray-300'}
                `}
              />

              {/* Background highlight for active tab */}
              <div
                className={`
                  absolute inset-0 transition-all duration-200
                  ${activeVaultId === vault.id ? 'bg-gray-50' : 'bg-transparent group-hover:bg-gray-50'}
                `}
              />

              {/* Tab content */}
              <div className="relative flex items-center gap-2 flex-1 overflow-hidden">
                <span
                  className={`
                  font-medium truncate
                  ${activeVaultId === vault.id ? 'text-gray-900' : 'text-gray-700'}
                `}
                >
                  {vault.name}
                </span>
                <span className="text-xs text-gray-400 font-mono shrink-0">{shortenAddress(vault.id, 4)}</span>
              </div>

              {/* Close button */}
              <button
                className="
                  relative ml-1 p-1 rounded
                  text-gray-400 hover:text-gray-700 hover:bg-gray-200
                  transition-all duration-150
                "
                onClick={e => handleCloseTab(e, vault.id)}
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
              {closedVaults.map(vault => (
                <div
                  key={vault.id}
                  className="flex items-center justify-between p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() => handleOpenVault(vault.id)}
                  onKeyDown={e => e.key === 'Enter' && handleOpenVault(vault.id)}
                  role="button"
                  tabIndex={0}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium">{vault.name}</span>
                      {vault.isEncrypted && (
                        <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">Encrypted</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-sm text-gray-500">
                      <span className="font-mono">{shortenAddress(vault.id, 6)}</span>
                      <span>{vault.getChains().length} chains</span>
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
