import type { VaultBase } from '@vultisig/sdk'
import { useCallback, useEffect, useRef, useState } from 'react'

import AddressBook from '@/components/address-book/AddressBook'
import Button from '@/components/common/Button'
import { Toast, useToast } from '@/components/common/Toast'
import EventLog from '@/components/events/EventLog'
// Components
import Layout from '@/components/layout/Layout'
import ServerStatus from '@/components/settings/ServerStatus'
import Vault from '@/components/vault/Vault'
import VaultCreator from '@/components/vault/VaultCreator'
import VaultImporter from '@/components/vault/VaultImporter'
import VaultTabs from '@/components/vault/VaultTabs'
import type { AppState, EventLogEntry } from '@/types'
import { createEvent } from '@/utils/events'
import { getSDK } from '@/utils/sdk'

function App() {
  const [appState, setAppState] = useState<AppState>({
    sdk: null,
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

        // Load all existing vaults and open them automatically
        const existingVaults = await sdk.listVaults()
        const openVaultsMap = new Map<string, VaultBase>()
        existingVaults.forEach((vault: VaultBase) => {
          openVaultsMap.set(vault.id, vault)
        })

        // Set first vault as active if any exist
        if (existingVaults.length > 0) {
          await sdk.setActiveVault(existingVaults[0])
        }

        setAppState(prev => ({
          ...prev,
          sdk,
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

  // Subscribe to SDK events
  useEffect(() => {
    if (!appState.sdk) return

    const sdk = appState.sdk

    const handleVaultChanged = ({ vaultId }: { vaultId: string }) => {
      addEvent('info', 'sdk', `Vault changed: ${vaultId}`)
    }

    const handleError = (error: Error) => {
      addEvent('error', 'sdk', `SDK error: ${error.message}`)
      showToastRef.current(error.message, 'error')
    }

    const handleVaultCreationProgress = ({ step }: any) => {
      addEvent('info', 'sdk', `Vault creation: ${step.message} (${step.progress}%)`)
    }

    const handleVaultCreationComplete = ({ vault }: any) => {
      addEvent('success', 'sdk', `Vault creation complete: ${vault.name}`)
    }

    const handleDisposed = () => {
      addEvent('info', 'sdk', 'SDK disposed')
    }

    sdk.on('vaultChanged', handleVaultChanged)
    sdk.on('error', handleError)
    sdk.on('vaultCreationProgress', handleVaultCreationProgress)
    sdk.on('vaultCreationComplete', handleVaultCreationComplete)
    sdk.on('disposed', handleDisposed)

    return () => {
      sdk.off('vaultChanged', handleVaultChanged)
      sdk.off('error', handleError)
      sdk.off('vaultCreationProgress', handleVaultCreationProgress)
      sdk.off('vaultCreationComplete', handleVaultCreationComplete)
      sdk.off('disposed', handleDisposed)
    }
  }, [appState.sdk, addEvent])

  // Subscribe to all open vault events
  useEffect(() => {
    const cleanupFunctions: (() => void)[] = []

    appState.openVaults.forEach(vault => {
      // Create handlers with vault context
      const vaultPrefix = `[${vault.name}]`

      // Balance & Value events
      const handleBalanceUpdated = ({ chain }: any) => {
        addEvent('balance', 'vault', `${vaultPrefix} Balance updated for ${chain}`)
      }

      const handleValuesUpdated = ({ chain }: any) => {
        addEvent('info', 'vault', `${vaultPrefix} Fiat values updated for ${chain}`)
      }

      const handleTotalValueUpdated = ({ value }: any) => {
        addEvent('info', 'vault', `${vaultPrefix} Total portfolio value: ${value.amount} ${value.currency}`)
      }

      // Transaction events
      const handleTransactionSigned = () => {
        addEvent('success', 'vault', `${vaultPrefix} Transaction signed successfully`)
        showToastRef.current('Transaction signed!', 'success')
      }

      const handleTransactionBroadcast = ({ chain, txHash }: any) => {
        addEvent('transaction', 'vault', `${vaultPrefix} Transaction broadcast on ${chain}: ${txHash}`)
        showToastRef.current('Transaction broadcast!', 'success')
      }

      const handleSigningProgress = ({ step }: any) => {
        addEvent('signing', 'vault', `${vaultPrefix} ${step.message} (${step.progress}%)`)
      }

      // Chain events
      const handleChainAdded = ({ chain }: any) => {
        addEvent('chain', 'vault', `${vaultPrefix} Chain added: ${chain}`)
        showToastRef.current(`Added ${chain}`, 'success')
      }

      const handleChainRemoved = ({ chain }: any) => {
        addEvent('chain', 'vault', `${vaultPrefix} Chain removed: ${chain}`)
      }

      // Token events
      const handleTokenAdded = ({ chain, token }: any) => {
        addEvent('info', 'vault', `${vaultPrefix} Token added on ${chain}: ${token.symbol}`)
        showToastRef.current(`Added ${token.symbol}`, 'success')
      }

      const handleTokenRemoved = ({ chain, tokenId }: any) => {
        addEvent('info', 'vault', `${vaultPrefix} Token removed on ${chain}: ${tokenId}`)
      }

      // Vault lifecycle events
      const handleRenamed = ({ oldName, newName }: any) => {
        addEvent('info', 'vault', `${vaultPrefix} Renamed from "${oldName}" to "${newName}"`)
      }

      const handleSaved = () => {
        addEvent('info', 'vault', `${vaultPrefix} Vault saved`)
      }

      const handleDeleted = () => {
        addEvent('info', 'vault', `${vaultPrefix} Vault deleted`)
      }

      const handleLoaded = () => {
        addEvent('info', 'vault', `${vaultPrefix} Vault loaded`)
      }

      const handleUnlocked = () => {
        addEvent('success', 'vault', `${vaultPrefix} Vault unlocked`)
      }

      const handleLocked = () => {
        addEvent('info', 'vault', `${vaultPrefix} Vault locked`)
      }

      // Swap events
      const handleSwapQuoteReceived = ({ quote }: any) => {
        addEvent('info', 'vault', `${vaultPrefix} Swap quote received from ${quote.provider}`)
      }

      const handleSwapApprovalRequired = ({ token, amount }: any) => {
        addEvent('info', 'vault', `${vaultPrefix} Approval required for ${amount} ${token}`)
      }

      const handleSwapApprovalGranted = ({ token, txHash }: any) => {
        addEvent('success', 'vault', `${vaultPrefix} Approval granted for ${token}: ${txHash}`)
      }

      const handleSwapPrepared = ({ provider, fromAmount, toAmountExpected }: any) => {
        addEvent('info', 'vault', `${vaultPrefix} Swap prepared via ${provider}: ${fromAmount} → ${toAmountExpected}`)
      }

      // Error event
      const handleVaultError = (error: Error) => {
        addEvent('error', 'vault', `${vaultPrefix} Vault error: ${error.message}`)
        showToastRef.current(error.message, 'error')
      }

      // Subscribe to all events
      vault.on('balanceUpdated', handleBalanceUpdated)
      vault.on('valuesUpdated', handleValuesUpdated)
      vault.on('totalValueUpdated', handleTotalValueUpdated)
      vault.on('transactionSigned', handleTransactionSigned)
      vault.on('transactionBroadcast', handleTransactionBroadcast)
      vault.on('signingProgress', handleSigningProgress)
      vault.on('chainAdded', handleChainAdded)
      vault.on('chainRemoved', handleChainRemoved)
      vault.on('tokenAdded', handleTokenAdded)
      vault.on('tokenRemoved', handleTokenRemoved)
      vault.on('renamed', handleRenamed)
      vault.on('saved', handleSaved)
      vault.on('deleted', handleDeleted)
      vault.on('loaded', handleLoaded)
      vault.on('unlocked', handleUnlocked)
      vault.on('locked', handleLocked)
      vault.on('swapQuoteReceived', handleSwapQuoteReceived)
      vault.on('swapApprovalRequired', handleSwapApprovalRequired)
      vault.on('swapApprovalGranted', handleSwapApprovalGranted)
      vault.on('swapPrepared', handleSwapPrepared)
      vault.on('error', handleVaultError)

      // Store cleanup function
      cleanupFunctions.push(() => {
        vault.off('balanceUpdated', handleBalanceUpdated)
        vault.off('valuesUpdated', handleValuesUpdated)
        vault.off('totalValueUpdated', handleTotalValueUpdated)
        vault.off('transactionSigned', handleTransactionSigned)
        vault.off('transactionBroadcast', handleTransactionBroadcast)
        vault.off('signingProgress', handleSigningProgress)
        vault.off('chainAdded', handleChainAdded)
        vault.off('chainRemoved', handleChainRemoved)
        vault.off('tokenAdded', handleTokenAdded)
        vault.off('tokenRemoved', handleTokenRemoved)
        vault.off('renamed', handleRenamed)
        vault.off('saved', handleSaved)
        vault.off('deleted', handleDeleted)
        vault.off('loaded', handleLoaded)
        vault.off('unlocked', handleUnlocked)
        vault.off('locked', handleLocked)
        vault.off('swapQuoteReceived', handleSwapQuoteReceived)
        vault.off('swapApprovalRequired', handleSwapApprovalRequired)
        vault.off('swapApprovalGranted', handleSwapApprovalGranted)
        vault.off('swapPrepared', handleSwapPrepared)
        vault.off('error', handleVaultError)
      })
    })

    // Cleanup all subscriptions
    return () => {
      cleanupFunctions.forEach(cleanup => cleanup())
    }
  }, [appState.openVaults, addEvent])

  const handleVaultCreated = async (vault: VaultBase) => {
    // Vault is already saved by SDK, just add to open vaults
    setAppState(prev => {
      const newOpenVaults = new Map(prev.openVaults)
      newOpenVaults.set(vault.id, vault)

      return {
        ...prev,
        openVaults: newOpenVaults,
      }
    })

    // Set as active vault in SDK
    await appState.sdk.setActiveVault(vault)

    addEvent('vault', 'sdk', `Vault created: ${vault.name}`)
    showToast(`Vault "${vault.name}" created!`, 'success')
  }

  const handleVaultImported = async (vaults: VaultBase[]) => {
    // Vaults are already saved by SDK, just add to open vaults
    setAppState(prev => {
      const newOpenVaults = new Map(prev.openVaults)
      vaults.forEach(vault => newOpenVaults.set(vault.id, vault))

      return {
        ...prev,
        openVaults: newOpenVaults,
      }
    })

    // Set first vault as active in SDK
    if (vaults.length > 0) {
      await appState.sdk.setActiveVault(vaults[0])
    }

    addEvent('vault', 'sdk', `Imported ${vaults.length} vault(s)`)
    showToast(`Imported ${vaults.length} vault(s)!`, 'success')
  }

  const handleTabOpen = async (vaultId: string) => {
    // Check if vault is already open
    if (appState.openVaults.has(vaultId)) {
      const vault = appState.openVaults.get(vaultId)!
      await appState.sdk.setActiveVault(vault)
      return
    }

    // Load vault from SDK
    try {
      const vault = await appState.sdk.getVaultById(vaultId)

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

      // Set as active vault in SDK
      await appState.sdk.setActiveVault(vault)

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

    // If this was the active vault, clear it or switch to another
    const activeVault = await appState.sdk.getActiveVault()
    if (activeVault?.id === vaultId) {
      const remainingVaults = Array.from(appState.openVaults.values()).filter(v => v.id !== vaultId)
      if (remainingVaults.length > 0) {
        await appState.sdk.setActiveVault(remainingVaults[remainingVaults.length - 1])
      } else {
        await appState.sdk.setActiveVault(null)
      }
    }

    if (closedVault) {
      addEvent('info', 'sdk', `Vault closed: ${closedVault.name}`)
    }
  }

  const handleTabSwitch = async (vaultId: string) => {
    const vault = appState.openVaults.get(vaultId)
    if (vault) {
      await appState.sdk.setActiveVault(vault)
      addEvent('info', 'sdk', `Switched to vault: ${vault.name}`)
    }
  }

  const handleClearEvents = () => {
    setAppState(prev => ({ ...prev, events: [] }))
  }

  const handleVaultDeleted = async (vaultId: string) => {
    const deletedVault = appState.openVaults.get(vaultId)

    // Remove from open vaults
    setAppState(prev => {
      const newOpenVaults = new Map(prev.openVaults)
      newOpenVaults.delete(vaultId)
      return { ...prev, openVaults: newOpenVaults }
    })

    // Switch to another vault if available
    const remainingVaults = Array.from(appState.openVaults.values()).filter(v => v.id !== vaultId)
    if (remainingVaults.length > 0) {
      await appState.sdk.setActiveVault(remainingVaults[remainingVaults.length - 1])
    } else {
      await appState.sdk.setActiveVault(null)
    }

    addEvent('vault', 'sdk', `Vault deleted: ${deletedVault?.name || vaultId}`)
    showToast('Vault deleted', 'success')
  }

  const handleVaultRenamed = (vaultId: string, newName: string) => {
    // Update the vault in openVaults map (the vault object is already updated)
    setAppState(prev => {
      const newOpenVaults = new Map(prev.openVaults)
      const vault = newOpenVaults.get(vaultId)
      if (vault) {
        // Force re-render by creating new map
        newOpenVaults.set(vaultId, vault)
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

  return (
    <>
      <Layout
        sidebar={
          <div className="space-y-3">
            <VaultCreator onVaultCreated={handleVaultCreated} />
            <VaultImporter onVaultImported={handleVaultImported} />
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
              sdk={appState.sdk}
              openVaults={Array.from(appState.openVaults.values())}
              onTabSwitch={handleTabSwitch}
              onTabClose={handleTabClose}
              onTabOpen={handleTabOpen}
            />
            <VaultContent
              sdk={appState.sdk}
              openVaults={appState.openVaults}
              onVaultDeleted={handleVaultDeleted}
              onVaultRenamed={handleVaultRenamed}
            />
          </>
        }
        eventLog={<EventLog events={appState.events} onClear={handleClearEvents} />}
      />
      {toast && <Toast {...toast} />}
      <AddressBook isOpen={isAddressBookOpen} onClose={() => setIsAddressBookOpen(false)} />
      <ServerStatus isOpen={isServerStatusOpen} onClose={() => setIsServerStatusOpen(false)} />
    </>
  )
}

// Separate component to handle active vault rendering
function VaultContent({
  sdk,
  openVaults,
  onVaultDeleted,
  onVaultRenamed,
}: {
  sdk: any
  openVaults: Map<string, VaultBase>
  onVaultDeleted: (vaultId: string) => void
  onVaultRenamed: (vaultId: string, newName: string) => void
}) {
  const [activeVaultId, setActiveVaultId] = useState<string | null>(null)

  useEffect(() => {
    if (!sdk) return

    const loadActiveVault = async () => {
      const vault = await sdk.getActiveVault()
      setActiveVaultId(vault?.id || null)
    }

    loadActiveVault()

    // Listen for vault changes
    const handleVaultChanged = async () => {
      const vault = await sdk.getActiveVault()
      setActiveVaultId(vault?.id || null)
    }

    sdk.on('vaultChanged', handleVaultChanged)

    return () => {
      sdk.off('vaultChanged', handleVaultChanged)
    }
  }, [sdk])

  // Get the vault instance from openVaults (same instance we subscribe to)
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

  return <Vault vault={activeVault} sdk={sdk} onVaultDeleted={onVaultDeleted} onVaultRenamed={onVaultRenamed} />
}

export default App
