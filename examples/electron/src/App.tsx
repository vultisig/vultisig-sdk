import { useCallback, useEffect, useRef, useState } from 'react'

import { events, sdk, vault } from '@/api/sdk-bridge'
import Button from '@/components/common/Button'
import Modal from '@/components/common/Modal'
import { Toast, useToast } from '@/components/common/Toast'
import EventLog from '@/components/events/EventLog'
import Layout from '@/components/layout/Layout'
import SecureVaultCreator from '@/components/vault/SecureVaultCreator'
import Vault from '@/components/vault/Vault'
import VaultCreator from '@/components/vault/VaultCreator'
import VaultImporter from '@/components/vault/VaultImporter'
import VaultTabs from '@/components/vault/VaultTabs'
import type { AppState, EventLogEntry, PasswordRequest, VaultInfo } from '@/types'
import { createEvent } from '@/utils/events'

function App() {
  const [appState, setAppState] = useState<AppState>({
    openVaults: new Map(),
    activeVaultId: null,
    events: [],
    isLoading: true,
    error: null,
    availableChains: [],
  })

  const { toast, showToast } = useToast()
  const showToastRef = useRef(showToast)
  showToastRef.current = showToast

  // Password modal state
  const [passwordRequest, setPasswordRequest] = useState<PasswordRequest | null>(null)
  const [passwordInput, setPasswordInput] = useState('')

  // Stable addEvent function
  const addEvent = useCallback(
    (type: EventLogEntry['type'], source: EventLogEntry['source'], message: string, data?: any) => {
      setAppState(prev => ({
        ...prev,
        events: [...prev.events, createEvent(type, source, message, data)].slice(-1000),
      }))
    },
    []
  )

  // Track if initialization has already run (prevents double execution in React Strict Mode)
  const initRef = useRef(false)

  // Initialize app and load vaults
  useEffect(() => {
    if (initRef.current) return
    initRef.current = true

    const init = async () => {
      try {
        // Load available chains
        const chains = await sdk.getChainList()

        // Load all existing vaults
        const existingVaults = await vault.list()
        const openVaultsMap = new Map<string, VaultInfo>()
        existingVaults.forEach(v => {
          openVaultsMap.set(v.id, v)
        })

        // Set first vault as active if any exist
        let activeVaultId: string | null = null
        if (existingVaults.length > 0) {
          await vault.setActive(existingVaults[0].id)
          activeVaultId = existingVaults[0].id
        }

        setAppState(prev => ({
          ...prev,
          openVaults: openVaultsMap,
          activeVaultId,
          availableChains: chains,
          isLoading: false,
        }))

        addEvent('success', 'sdk', `SDK initialized, ${existingVaults.length} vault(s) loaded`)
      } catch (error) {
        setAppState(prev => ({
          ...prev,
          isLoading: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        }))
        addEvent('error', 'sdk', `Failed to initialize: ${error}`)
      }
    }

    init()
  }, [addEvent])

  // Subscribe to IPC events
  useEffect(() => {
    // Password required event
    const cleanupPassword = events.onPasswordRequired(data => {
      setPasswordRequest(data)
      setPasswordInput('')
    })

    // Vault creation progress
    const cleanupProgress = events.onVaultCreationProgress(({ step }) => {
      addEvent('info', 'sdk', `Vault creation: ${step.message} (${step.progress}%)`)
    })

    // QR code ready
    const cleanupQr = events.onQrCodeReady(() => {
      addEvent('info', 'sdk', 'QR code ready for device pairing')
    })

    // Device joined
    const cleanupDevice = events.onDeviceJoined(({ totalJoined, required }) => {
      addEvent('info', 'sdk', `Device joined: ${totalJoined}/${required}`)
    })

    // Signing progress
    const cleanupSigning = events.onSigningProgress(({ step }) => {
      addEvent('signing', 'vault', `${step.message} (${step.progress}%)`)
    })

    return () => {
      cleanupPassword()
      cleanupProgress()
      cleanupQr()
      cleanupDevice()
      cleanupSigning()
    }
  }, [addEvent])

  const handlePasswordSubmit = async () => {
    if (!passwordRequest) return
    try {
      await window.electronAPI.resolvePassword(passwordRequest.requestId, passwordInput)
      setPasswordRequest(null)
      setPasswordInput('')
    } catch {
      showToast('Failed to submit password', 'error')
    }
  }

  const handlePasswordCancel = async () => {
    if (!passwordRequest) return
    try {
      await window.electronAPI.rejectPassword(passwordRequest.requestId)
    } catch {
      // Ignore
    }
    setPasswordRequest(null)
    setPasswordInput('')
  }

  const handleVaultCreated = async (vaultInfo: VaultInfo) => {
    setAppState(prev => {
      const newOpenVaults = new Map(prev.openVaults)
      newOpenVaults.set(vaultInfo.id, vaultInfo)

      return {
        ...prev,
        openVaults: newOpenVaults,
        activeVaultId: vaultInfo.id,
      }
    })

    await vault.setActive(vaultInfo.id)

    addEvent('vault', 'sdk', `Vault created: ${vaultInfo.name}`)
    showToast(`Vault "${vaultInfo.name}" created!`, 'success')
  }

  const handleVaultImported = async (vaults: VaultInfo[]) => {
    setAppState(prev => {
      const newOpenVaults = new Map(prev.openVaults)
      vaults.forEach(v => newOpenVaults.set(v.id, v))

      return {
        ...prev,
        openVaults: newOpenVaults,
        activeVaultId: vaults.length > 0 ? vaults[0].id : prev.activeVaultId,
      }
    })

    if (vaults.length > 0) {
      await vault.setActive(vaults[0].id)
    }

    addEvent('vault', 'sdk', `Imported ${vaults.length} vault(s)`)
    showToast(`Imported ${vaults.length} vault(s)!`, 'success')
  }

  const handleTabOpen = async (vaultId: string) => {
    if (appState.openVaults.has(vaultId)) {
      await vault.setActive(vaultId)
      setAppState(prev => ({ ...prev, activeVaultId: vaultId }))
      return
    }

    try {
      const vaults = await vault.list()
      const vaultInfo = vaults.find(v => v.id === vaultId)

      if (!vaultInfo) {
        throw new Error('Vault not found')
      }

      setAppState(prev => {
        const newOpenVaults = new Map(prev.openVaults)
        newOpenVaults.set(vaultId, vaultInfo)

        return {
          ...prev,
          openVaults: newOpenVaults,
          activeVaultId: vaultId,
        }
      })

      await vault.setActive(vaultId)

      addEvent('info', 'sdk', `Vault opened: ${vaultInfo.name}`)
    } catch (error) {
      addEvent('error', 'sdk', `Failed to load vault: ${error}`)
      showToast('Failed to load vault', 'error')
    }
  }

  const handleTabClose = async (vaultId: string) => {
    const closedVault = appState.openVaults.get(vaultId)

    setAppState(prev => {
      const newOpenVaults = new Map(prev.openVaults)
      newOpenVaults.delete(vaultId)

      // If closing active vault, switch to another
      let newActiveId = prev.activeVaultId
      if (prev.activeVaultId === vaultId) {
        const remaining = Array.from(newOpenVaults.keys())
        newActiveId = remaining.length > 0 ? remaining[remaining.length - 1] : null
      }

      return {
        ...prev,
        openVaults: newOpenVaults,
        activeVaultId: newActiveId,
      }
    })

    if (appState.activeVaultId === vaultId) {
      const remaining = Array.from(appState.openVaults.values()).filter(v => v.id !== vaultId)
      if (remaining.length > 0) {
        await vault.setActive(remaining[remaining.length - 1].id)
      } else {
        await vault.setActive(null)
      }
    }

    if (closedVault) {
      addEvent('info', 'sdk', `Vault closed: ${closedVault.name}`)
    }
  }

  const handleTabSwitch = async (vaultId: string) => {
    const vaultInfo = appState.openVaults.get(vaultId)
    if (vaultInfo) {
      await vault.setActive(vaultId)
      setAppState(prev => ({ ...prev, activeVaultId: vaultId }))
      addEvent('info', 'sdk', `Switched to vault: ${vaultInfo.name}`)
    }
  }

  const handleClearEvents = () => {
    setAppState(prev => ({ ...prev, events: [] }))
  }

  const handleVaultDeleted = async (vaultId: string) => {
    const deletedVault = appState.openVaults.get(vaultId)

    setAppState(prev => {
      const newOpenVaults = new Map(prev.openVaults)
      newOpenVaults.delete(vaultId)

      let newActiveId = prev.activeVaultId
      if (prev.activeVaultId === vaultId) {
        const remaining = Array.from(newOpenVaults.keys())
        newActiveId = remaining.length > 0 ? remaining[remaining.length - 1] : null
      }

      return { ...prev, openVaults: newOpenVaults, activeVaultId: newActiveId }
    })

    const remaining = Array.from(appState.openVaults.values()).filter(v => v.id !== vaultId)
    if (remaining.length > 0) {
      await vault.setActive(remaining[remaining.length - 1].id)
    } else {
      await vault.setActive(null)
    }

    addEvent('vault', 'sdk', `Vault deleted: ${deletedVault?.name || vaultId}`)
    showToast('Vault deleted', 'success')
  }

  const handleVaultRenamed = (vaultId: string, newName: string) => {
    setAppState(prev => {
      const newOpenVaults = new Map(prev.openVaults)
      const vaultInfo = newOpenVaults.get(vaultId)
      if (vaultInfo) {
        newOpenVaults.set(vaultId, { ...vaultInfo, name: newName })
      }
      return { ...prev, openVaults: newOpenVaults }
    })

    addEvent('vault', 'sdk', `Vault renamed to: ${newName}`)
    showToast(`Vault renamed to "${newName}"`, 'success')
  }

  if (appState.isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin h-12 w-12 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-gray-600">Initializing Vultisig SDK...</p>
        </div>
      </div>
    )
  }

  if (appState.error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center max-w-md">
          <h1 className="text-2xl font-bold text-error mb-2">Error</h1>
          <p className="text-gray-600">{appState.error}</p>
        </div>
      </div>
    )
  }

  const activeVault = appState.activeVaultId ? appState.openVaults.get(appState.activeVaultId) : null

  return (
    <>
      <Layout
        sidebar={
          <div className="space-y-3">
            <VaultCreator onVaultCreated={handleVaultCreated} />
            <SecureVaultCreator onVaultCreated={handleVaultCreated} />
            <VaultImporter onVaultImported={handleVaultImported} />
          </div>
        }
        main={
          <>
            <VaultTabs
              openVaults={Array.from(appState.openVaults.values())}
              activeVaultId={appState.activeVaultId}
              onTabSwitch={handleTabSwitch}
              onTabClose={handleTabClose}
              onTabOpen={handleTabOpen}
            />
            {activeVault ? (
              <Vault vault={activeVault} onVaultDeleted={handleVaultDeleted} onVaultRenamed={handleVaultRenamed} />
            ) : (
              <div className="flex items-center justify-center py-20">
                <div className="text-center text-gray-500">
                  <h2 className="text-xl font-semibold mb-2">No Vault Open</h2>
                  <p>Create a new vault, import one, or open an existing vault from the list.</p>
                </div>
              </div>
            )}
          </>
        }
        eventLog={<EventLog events={appState.events} onClear={handleClearEvents} />}
      />

      {/* Password Modal */}
      <Modal isOpen={!!passwordRequest} onClose={handlePasswordCancel} title="Password Required">
        <div className="space-y-4">
          <p className="text-gray-600">
            Please enter the password for vault:{' '}
            <strong>{passwordRequest?.vaultName || passwordRequest?.vaultId?.slice(0, 8)}</strong>
          </p>
          <input
            type="password"
            value={passwordInput}
            onChange={e => setPasswordInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handlePasswordSubmit()}
            placeholder="Enter password"
            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            autoFocus
          />
          <div className="flex justify-end space-x-2">
            <Button variant="secondary" onClick={handlePasswordCancel}>
              Cancel
            </Button>
            <Button onClick={handlePasswordSubmit} disabled={!passwordInput}>
              Submit
            </Button>
          </div>
        </div>
      </Modal>

      {toast && <Toast {...toast} />}
    </>
  )
}

export default App
