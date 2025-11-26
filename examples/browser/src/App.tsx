import type { VaultBase } from '@vultisig/sdk'
import { useEffect, useState } from 'react'

import { Toast, useToast } from '@/components/common/Toast'
import EventLog from '@/components/events/EventLog'
// Components
import Layout from '@/components/layout/Layout'
import TransactionForm from '@/components/transaction/TransactionForm'
import VaultCreator from '@/components/vault/VaultCreator'
import VaultImporter from '@/components/vault/VaultImporter'
import VaultInfo from '@/components/vault/VaultInfo'
import VaultTabs from '@/components/vault/VaultTabs'
import BalanceDisplay from '@/components/wallet/BalanceDisplay'
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

  // Initialize app and load vaults from SDK
  useEffect(() => {
    const init = async () => {
      try {
        const sdk = getSDK()

        setAppState(prev => ({
          ...prev,
          sdk,
          isLoading: false,
        }))

        addEvent('success', 'sdk', 'SDK initialized successfully')
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
  }, [])

  // Subscribe to SDK events
  useEffect(() => {
    if (!appState.sdk) return

    const sdk = appState.sdk

    const handleVaultChanged = ({ vaultId }: { vaultId: string }) => {
      addEvent('info', 'sdk', `Vault changed: ${vaultId}`)
    }

    const handleError = (error: Error) => {
      addEvent('error', 'sdk', `SDK error: ${error.message}`)
      showToast(error.message, 'error')
    }

    sdk.on('vaultChanged', handleVaultChanged)
    sdk.on('error', handleError)

    return () => {
      sdk.off('vaultChanged', handleVaultChanged)
      sdk.off('error', handleError)
    }
  }, [appState.sdk, showToast])

  // Subscribe to all open vault events
  useEffect(() => {
    const cleanupFunctions: (() => void)[] = []

    appState.openVaults.forEach(vault => {
      // Create handlers with vault context
      const vaultPrefix = `[${vault.name}]`

      const handleBalanceUpdated = ({ chain }: any) => {
        addEvent('balance', 'vault', `${vaultPrefix} Balance updated for ${chain}`)
      }

      const handleTransactionSigned = () => {
        addEvent('success', 'vault', `${vaultPrefix} Transaction signed successfully`)
        showToast('Transaction signed!', 'success')
      }

      const handleTransactionBroadcast = ({ chain, txHash }: any) => {
        addEvent('transaction', 'vault', `${vaultPrefix} Transaction broadcast on ${chain}: ${txHash}`)
        showToast('Transaction broadcast!', 'success')
      }

      const handleSigningProgress = ({ step }: any) => {
        addEvent('signing', 'vault', `${vaultPrefix} ${step.message} (${step.progress}%)`)
      }

      const handleChainAdded = ({ chain }: any) => {
        addEvent('chain', 'vault', `${vaultPrefix} Chain added: ${chain}`)
        showToast(`Added ${chain}`, 'success')
      }

      const handleChainRemoved = ({ chain }: any) => {
        addEvent('chain', 'vault', `${vaultPrefix} Chain removed: ${chain}`)
      }

      const handleVaultError = (error: Error) => {
        addEvent('error', 'vault', `${vaultPrefix} Vault error: ${error.message}`)
        showToast(error.message, 'error')
      }

      // Subscribe to events
      vault.on('balanceUpdated', handleBalanceUpdated)
      vault.on('transactionSigned', handleTransactionSigned)
      vault.on('transactionBroadcast', handleTransactionBroadcast)
      vault.on('signingProgress', handleSigningProgress)
      vault.on('chainAdded', handleChainAdded)
      vault.on('chainRemoved', handleChainRemoved)
      vault.on('error', handleVaultError)

      // Store cleanup function
      cleanupFunctions.push(() => {
        vault.off('balanceUpdated', handleBalanceUpdated)
        vault.off('transactionSigned', handleTransactionSigned)
        vault.off('transactionBroadcast', handleTransactionBroadcast)
        vault.off('signingProgress', handleSigningProgress)
        vault.off('chainAdded', handleChainAdded)
        vault.off('chainRemoved', handleChainRemoved)
        vault.off('error', handleVaultError)
      })
    })

    // Cleanup all subscriptions
    return () => {
      cleanupFunctions.forEach(cleanup => cleanup())
    }
  }, [appState.openVaults, showToast])

  const addEvent = (type: EventLogEntry['type'], source: EventLogEntry['source'], message: string, data?: any) => {
    setAppState(prev => ({
      ...prev,
      events: [...prev.events, createEvent(type, source, message, data)].slice(-1000), // Keep last 1000
    }))
  }

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
            <VaultContent sdk={appState.sdk} openVaults={appState.openVaults} />
          </>
        }
        eventLog={<EventLog events={appState.events} onClear={handleClearEvents} />}
      />
      {toast && <Toast {...toast} />}
    </>
  )
}

// Separate component to handle active vault rendering
function VaultContent({ sdk, openVaults }: { sdk: any; openVaults: Map<string, VaultBase> }) {
  const [activeVault, setActiveVault] = useState<VaultBase | null>(null)

  useEffect(() => {
    if (!sdk) return

    const loadActiveVault = async () => {
      const vault = await sdk.getActiveVault()
      setActiveVault(vault)
    }

    loadActiveVault()

    // Listen for vault changes
    const handleVaultChanged = async () => {
      const vault = await sdk.getActiveVault()
      setActiveVault(vault)
    }

    sdk.on('vaultChanged', handleVaultChanged)

    return () => {
      sdk.off('vaultChanged', handleVaultChanged)
    }
  }, [sdk, openVaults])

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
    <>
      <VaultInfo vault={activeVault} />
      <BalanceDisplay vault={activeVault} />
      <TransactionForm vault={activeVault} />
    </>
  )
}

export default App
