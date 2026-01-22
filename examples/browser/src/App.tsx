import type { EventLogEntry, VaultInfo } from '@vultisig/examples-shared'
// Import from shared package
import {
  AdapterProvider,
  Button,
  createEvent,
  EventLog,
  Layout,
  SecureVaultCreator,
  SecureVaultJoiner,
  SeedphraseImporter,
  Toast,
  useToast,
  Vault,
  VaultCreator,
  VaultImporter,
  VaultTabs,
} from '@vultisig/examples-shared'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// Platform-specific imports
import { BrowserFileAdapter, BrowserSDKAdapter } from '@/adapters'
import AddressBook from '@/components/address-book/AddressBook'
import ServerStatus from '@/components/settings/ServerStatus'
import { getSDK } from '@/utils/sdk'

type AppState = {
  sdkAdapter: BrowserSDKAdapter | null
  fileAdapter: BrowserFileAdapter | null
  openVaults: Map<string, VaultInfo>
  events: EventLogEntry[]
  isLoading: boolean
  error: string | null
}

function App() {
  const [appState, setAppState] = useState<AppState>({
    sdkAdapter: null,
    fileAdapter: null,
    openVaults: new Map(),
    events: [],
    isLoading: true,
    error: null,
  })

  const { toast, showToast } = useToast()
  const showToastRef = useRef(showToast)
  showToastRef.current = showToast

  const [isAddressBookOpen, setIsAddressBookOpen] = useState(false)
  const [isServerStatusOpen, setIsServerStatusOpen] = useState(false)

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

  // Initialize app and load vaults from SDK
  useEffect(() => {
    const init = async () => {
      try {
        const sdk = getSDK()
        const sdkAdapter = new BrowserSDKAdapter(sdk)
        const fileAdapter = new BrowserFileAdapter()

        // Load all existing vaults
        const existingVaults = await sdkAdapter.listVaults()
        const openVaultsMap = new Map<string, VaultInfo>()
        existingVaults.forEach((vault: VaultInfo) => {
          openVaultsMap.set(vault.id, vault)
        })

        // Set first vault as active if any exist
        if (existingVaults.length > 0) {
          await sdkAdapter.setActiveVault(existingVaults[0].id)
        }

        setAppState(prev => ({
          ...prev,
          sdkAdapter,
          fileAdapter,
          openVaults: openVaultsMap,
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

  // Subscribe to SDK adapter events
  useEffect(() => {
    if (!appState.sdkAdapter) return

    const adapter = appState.sdkAdapter

    const unsubProgress = adapter.onProgress(step => {
      addEvent('info', 'sdk', `${step.message} (${step.progress}%)`)
    })

    const unsubSigning = adapter.onSigningProgress(step => {
      addEvent('signing', 'vault', `${step.message} (${step.progress}%)`)
    })

    const unsubVaultChanged = adapter.onVaultChanged(vault => {
      if (vault) {
        addEvent('info', 'sdk', `Vault changed: ${vault.name}`)
      }
    })

    const unsubBalance = adapter.onBalanceUpdated(({ chain, tokenId }) => {
      addEvent('balance', 'vault', `Balance updated: ${chain}${tokenId ? `:${tokenId}` : ''}`)
    })

    const unsubChain = adapter.onChainChanged(({ chain, action }) => {
      addEvent('chain', 'vault', `Chain ${action}: ${chain}`)
    })

    const unsubTx = adapter.onTransactionBroadcast(({ chain, txHash }) => {
      addEvent('transaction', 'vault', `Transaction broadcast on ${chain}: ${txHash.slice(0, 10)}...`)
    })

    const unsubError = adapter.onError(error => {
      addEvent('error', 'sdk', `Error: ${error.message}`)
    })

    return () => {
      unsubProgress()
      unsubSigning()
      unsubVaultChanged()
      unsubBalance()
      unsubChain()
      unsubTx()
      unsubError()
    }
  }, [appState.sdkAdapter, addEvent])

  const handleVaultCreated = async (vault: VaultInfo) => {
    setAppState(prev => {
      const newOpenVaults = new Map(prev.openVaults)
      newOpenVaults.set(vault.id, vault)

      return {
        ...prev,
        openVaults: newOpenVaults,
      }
    })

    // Set as active vault
    await appState.sdkAdapter?.setActiveVault(vault.id)

    addEvent('vault', 'sdk', `Vault created: ${vault.name}`)
    showToast(`Vault "${vault.name}" created!`, 'success')
  }

  const handleVaultImported = async (vaults: VaultInfo[]) => {
    setAppState(prev => {
      const newOpenVaults = new Map(prev.openVaults)
      vaults.forEach(vault => newOpenVaults.set(vault.id, vault))

      return {
        ...prev,
        openVaults: newOpenVaults,
      }
    })

    // Set first vault as active
    if (vaults.length > 0) {
      await appState.sdkAdapter?.setActiveVault(vaults[0].id)
    }

    addEvent('vault', 'sdk', `Imported ${vaults.length} vault(s)`)
    showToast(`Imported ${vaults.length} vault(s)!`, 'success')
  }

  const handleTabOpen = async (vaultId: string) => {
    // Check if vault is already open
    if (appState.openVaults.has(vaultId)) {
      await appState.sdkAdapter?.setActiveVault(vaultId)
      return
    }

    // Load vault from SDK adapter
    try {
      const vaults = await appState.sdkAdapter?.listVaults()
      const vault = vaults?.find(v => v.id === vaultId)

      if (!vault) {
        throw new Error('Vault not found')
      }

      setAppState(prev => {
        const newOpenVaults = new Map(prev.openVaults)
        newOpenVaults.set(vaultId, vault)

        return {
          ...prev,
          openVaults: newOpenVaults,
        }
      })

      await appState.sdkAdapter?.setActiveVault(vaultId)
      addEvent('info', 'sdk', `Vault opened: ${vault.name}`)
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

      return {
        ...prev,
        openVaults: newOpenVaults,
      }
    })

    // If this was the active vault, switch to another
    const activeVault = await appState.sdkAdapter?.getActiveVault()
    if (activeVault?.id === vaultId) {
      const remainingVaults = Array.from(appState.openVaults.values()).filter(v => v.id !== vaultId)
      if (remainingVaults.length > 0) {
        await appState.sdkAdapter?.setActiveVault(remainingVaults[remainingVaults.length - 1].id)
      }
    }

    if (closedVault) {
      addEvent('info', 'sdk', `Vault closed: ${closedVault.name}`)
    }
  }

  const handleTabSwitch = async (vaultId: string) => {
    const vault = appState.openVaults.get(vaultId)
    if (vault) {
      await appState.sdkAdapter?.setActiveVault(vaultId)
      addEvent('info', 'sdk', `Switched to vault: ${vault.name}`)
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
      return { ...prev, openVaults: newOpenVaults }
    })

    // Switch to another vault if available
    const remainingVaults = Array.from(appState.openVaults.values()).filter(v => v.id !== vaultId)
    if (remainingVaults.length > 0) {
      await appState.sdkAdapter?.setActiveVault(remainingVaults[remainingVaults.length - 1].id)
    }

    addEvent('vault', 'sdk', `Vault deleted: ${deletedVault?.name || vaultId}`)
    showToast('Vault deleted', 'success')
  }

  const handleVaultRenamed = (vaultId: string, newName: string) => {
    setAppState(prev => {
      const newOpenVaults = new Map(prev.openVaults)
      const vault = newOpenVaults.get(vaultId)
      if (vault) {
        newOpenVaults.set(vaultId, { ...vault, name: newName })
      }
      return { ...prev, openVaults: newOpenVaults }
    })

    addEvent('vault', 'sdk', `Vault renamed to: ${newName}`)
    showToast(`Vault renamed to "${newName}"`, 'success')
  }

  const handleVaultUpdated = (updatedVault: VaultInfo) => {
    setAppState(prev => {
      const newOpenVaults = new Map(prev.openVaults)
      newOpenVaults.set(updatedVault.id, updatedVault)
      return { ...prev, openVaults: newOpenVaults }
    })
  }

  // Memoize open vaults array for VaultTabs
  const openVaultsArray = useMemo(() => Array.from(appState.openVaults.values()), [appState.openVaults])

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

  if (!appState.sdkAdapter || !appState.fileAdapter) {
    return null
  }

  return (
    <AdapterProvider sdk={appState.sdkAdapter} file={appState.fileAdapter}>
      <Layout
        sidebar={
          <div className="space-y-3">
            <VaultCreator onVaultCreated={handleVaultCreated} />
            <SecureVaultCreator onVaultCreated={handleVaultCreated} />
            <SecureVaultJoiner onVaultCreated={handleVaultCreated} />
            <VaultImporter onVaultImported={handleVaultImported} />
            <SeedphraseImporter onVaultCreated={handleVaultCreated} />
            <hr className="border-gray-200" />
            <Button variant="secondary" fullWidth onClick={() => setIsAddressBookOpen(true)}>
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
              Address Book
            </Button>
            <Button variant="secondary" fullWidth onClick={() => setIsServerStatusOpen(true)}>
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01"
                />
              </svg>
              Server Status
            </Button>
          </div>
        }
        main={
          <>
            <VaultTabs
              openVaults={openVaultsArray}
              onTabSwitch={handleTabSwitch}
              onTabClose={handleTabClose}
              onTabOpen={handleTabOpen}
            />
            <VaultContent
              openVaults={appState.openVaults}
              sdkAdapter={appState.sdkAdapter}
              onVaultDeleted={handleVaultDeleted}
              onVaultRenamed={handleVaultRenamed}
              onVaultUpdated={handleVaultUpdated}
            />
          </>
        }
        eventLog={<EventLog events={appState.events} onClear={handleClearEvents} />}
      />
      {toast && <Toast {...toast} />}
      <AddressBook isOpen={isAddressBookOpen} onClose={() => setIsAddressBookOpen(false)} />
      <ServerStatus isOpen={isServerStatusOpen} onClose={() => setIsServerStatusOpen(false)} />
    </AdapterProvider>
  )
}

// Separate component to handle active vault rendering
function VaultContent({
  openVaults,
  sdkAdapter,
  onVaultDeleted,
  onVaultRenamed,
  onVaultUpdated,
}: {
  openVaults: Map<string, VaultInfo>
  sdkAdapter: BrowserSDKAdapter
  onVaultDeleted: (vaultId: string) => void
  onVaultRenamed: (vaultId: string, newName: string) => void
  onVaultUpdated: (vault: VaultInfo) => void
}) {
  const [activeVaultId, setActiveVaultId] = useState<string | null>(null)

  useEffect(() => {
    const loadActiveVault = async () => {
      const vault = await sdkAdapter.getActiveVault()
      setActiveVaultId(vault?.id || null)
    }

    loadActiveVault()

    // Listen for vault changes
    const unsubscribe = sdkAdapter.onVaultChanged(vault => {
      setActiveVaultId(vault?.id || null)
    })

    return () => {
      unsubscribe()
    }
  }, [sdkAdapter])

  const activeVault = activeVaultId ? openVaults.get(activeVaultId) : null

  if (!activeVault) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center text-gray-500">
          <h2 className="text-xl font-semibold mb-2">No Vault Open</h2>
          <p>Create a new vault, import one, or open an existing vault from the list.</p>
        </div>
      </div>
    )
  }

  return (
    <Vault
      key={activeVault.id}
      vault={activeVault}
      onVaultDeleted={onVaultDeleted}
      onVaultRenamed={onVaultRenamed}
      onVaultUpdated={onVaultUpdated}
    />
  )
}

export default App
