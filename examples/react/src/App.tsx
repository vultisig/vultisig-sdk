import { useRef, useState } from 'react'
import { Vault, Vultisig } from 'vultisig-sdk'

import { AddressBookPanel } from './components/AddressBookPanel'
import { AddressDerivationTester } from './components/AddressDerivationTester'
import BalanceDisplay from './components/BalanceDisplay'
import { CreateVaultForm } from './components/CreateVaultForm'
import { CurrentVaultPanel } from './components/CurrentVaultPanel'
import { ExportModal } from './components/ExportModal'
import { KeysharesList } from './components/KeysharesList'
import { LoadVaultModal } from './components/LoadVaultModal'
import { ServerStatus } from './components/ServerStatus'
import { SettingsPanel } from './components/SettingsPanel'
import { SignTransaction } from './components/SignTransaction'
import { VaultDisplay } from './components/VaultDisplay'
import { useAddressBook } from './hooks/useAddressBook'
import { useServerStatus } from './hooks/useServerStatus'
import { useVaults } from './hooks/useVaults'
import type { LoadedKeyshare } from './types'
import { buildVultFile } from './utils/exportVault'

function App() {
  const [sdk] = useState(
    () =>
      new Vultisig({
        serverEndpoints: {
          fastVault: 'https://api.vultisig.com/vault',
          messageRelay: 'https://api.vultisig.com/router',
        },
        wasmConfig: {
          wasmPaths: {
            walletCore: '/wallet-core.wasm',
            dkls: '/dkls.wasm',
            schnorr: '/schnorr.wasm',
          },
        },
      })
  )
  const [initialized, setInitialized] = useState(false)
  const serverStatus = useServerStatus(sdk)
  const vaultsHook = useVaults(sdk)
  const addressBookHook = useAddressBook(sdk)
  const [vault, setVault] = useState<Vault | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [activeKeyshare, setActiveKeyshare] = useState<LoadedKeyshare | null>(
    null
  )
  const [serverVerified, setServerVerified] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [showExportModal, setShowExportModal] = useState(false)
  const [activeTab, setActiveTab] = useState<'vaults' | 'addressBook' | 'settings'>(
    'vaults'
  )

  const onInitialize = async () => {
    if (initialized) return
    await sdk.initialize()
    setInitialized(true)
  }

  const onPickVault = () => fileInputRef.current?.click()
  const onFilesChosen = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(ev.target.files || [])
    await onInitialize()

    for (const file of files) {
      try {
        const encrypted = await sdk.isVaultFileEncrypted(file)
        const loadedKeyshare: LoadedKeyshare = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: file.name,
          size: file.size,
          encrypted,
          data: null,
          file,
          containerBase64: undefined,
        }
        setActiveKeyshare(loadedKeyshare)
      } catch (error) {
        console.warn(`Failed to load ${file.name}:`, error)
      }
    }

    ev.target.value = ''
  }

  const handleVaultCreated = async (
    vault: Vault,
    options?: { serverVerified?: boolean }
  ) => {
    setVault(vault)
    setShowCreate(false)
    setServerVerified(Boolean(options?.serverVerified))
    await vaultsHook.refreshVaults()
  }

  const saveVaultImmediately = async () => {
    await vaultsHook.refreshVaults()
  }

  const handleLoadKeyshare = (keyshare: LoadedKeyshare) => {
    setActiveKeyshare(keyshare)
  }

  const handleVaultLoaded = async (
    vault: Vault,
    options?: { serverVerified?: boolean }
  ) => {
    setVault(vault)
    setServerVerified(Boolean(options?.serverVerified))
    await vaultsHook.refreshVaults()
  }

  const handleRemoveStoredKeyshare = async (vaultId: string) => {
    const vaultToDelete = vaultsHook.vaults.find(v => v.id === vaultId)
    if (vaultToDelete) {
      const vaultInstance = sdk.getActiveVault()
      if (vaultInstance && vaultInstance.data.publicKeys.ecdsa === vaultId) {
        await sdk.deleteVault(vaultInstance)
      }
      await vaultsHook.refreshVaults()
    }
  }

  const doExport = async (password?: string) => {
    if (!vault) return
    try {
      setExportError(null)
      setExporting(true)
      const { blob, filename } = await buildVultFile(vault, password)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setShowExportModal(false)
    } catch (e) {
      setExportError((e as Error).message)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#f8f9fa',
        padding: '20px',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>
        <div
          style={{
            backgroundColor: 'white',
            borderRadius: '8px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            padding: '20px',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '12px',
              flexWrap: 'wrap',
              marginBottom: '16px',
            }}
          >
            <h1 style={{ color: '#333', margin: 0 }}>
              VultiSig SDK - App Home
            </h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {vaultsHook.getStorageInfo().vaultCount > 0 && (
                <div
                  style={{
                    fontSize: '12px',
                    color: '#666',
                    padding: '4px 8px',
                    backgroundColor: '#f8f9fa',
                    borderRadius: '4px',
                    border: '1px solid #e9ecef',
                  }}
                >
                  {vaultsHook.getStorageInfo().vaultCount} stored -{' '}
                  {vaultsHook.getStorageInfo().estimatedSize}
                </div>
              )}
              <ServerStatus status={serverStatus} />
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button
              onClick={() => setActiveTab('vaults')}
              style={{
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid #e9ecef',
                backgroundColor: activeTab === 'vaults' ? '#e9ecef' : 'white',
                cursor: 'pointer',
              }}
            >
              Vaults ({vaultsHook.vaults.length})
            </button>
            <button
              onClick={() => setActiveTab('addressBook')}
              style={{
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid #e9ecef',
                backgroundColor:
                  activeTab === 'addressBook' ? '#e9ecef' : 'white',
                cursor: 'pointer',
              }}
            >
              Address Book ({addressBookHook.getTotalCount()})
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              style={{
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid #e9ecef',
                backgroundColor: activeTab === 'settings' ? '#e9ecef' : 'white',
                cursor: 'pointer',
              }}
            >
              Settings
            </button>
          </div>

          {/* Actions */}
          <div
            style={{
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              marginBottom: 16,
            }}
          >
            <button
              onClick={onPickVault}
              style={{
                padding: '10px 16px',
                backgroundColor: '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              Add Vault (.vult)
            </button>
            <button
              onClick={() => setShowCreate(v => !v)}
              style={{
                padding: '10px 16px',
                backgroundColor: '#6610f2',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              {showCreate ? 'Close Create' : 'Create Vault'}
            </button>
            {vaultsHook.vaults.length > 0 && (
              <button
                onClick={() => vaultsHook.clearAllVaults()}
                style={{
                  padding: '10px 16px',
                  backgroundColor: '#dc3545',
                  color: 'white',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                Clear Storage
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".vult"
              multiple
              onChange={onFilesChosen}
              style={{ display: 'none' }}
            />
          </div>

          {showCreate && (
            <CreateVaultForm
              sdk={sdk}
              onVaultCreated={handleVaultCreated}
              onInitialize={onInitialize}
              saveVaultImmediately={saveVaultImmediately}
            />
          )}

          {activeTab === 'vaults' && (
            <KeysharesList
              keyshares={[]}
              storedKeyshares={vaultsHook.vaults.map(v => ({
                id: v.id,
                name: v.name,
                size: v.size,
                encrypted: v.isEncrypted,
                dateAdded: v.createdAt,
                containerBase64: undefined,
              }))}
              onLoadKeyshare={handleLoadKeyshare}
              onRemoveStoredKeyshare={handleRemoveStoredKeyshare}
              onLoadStoredKeyshare={async storedVault => {
                const vaultData = await vaultsHook.getVaultData(storedVault.id)
                const loadedKeyshare: LoadedKeyshare = {
                  id: storedVault.id,
                  name: storedVault.name,
                  size: vaultData?.size || storedVault.size || 0,
                  encrypted: storedVault.encrypted || false,
                  data: null,
                  file: null,
                  containerBase64: vaultData?.containerBase64,
                }
                handleLoadKeyshare(loadedKeyshare)
              }}
            />
          )}

          {activeTab === 'addressBook' && (
            <AddressBookPanel
              sdk={sdk}
              onAddressBookChange={addressBookHook.refreshAddressBook}
            />
          )}

          {activeTab === 'settings' && <SettingsPanel sdk={sdk} />}

          {activeTab === 'vaults' && vault && (
            <>
              <CurrentVaultPanel
                vault={vault}
                sdk={sdk}
                serverVerified={serverVerified}
                onDisconnect={() => {
                  setVault(null)
                  setServerVerified(false)
                }}
                onOpenExport={() => setShowExportModal(true)}
              />
              <VaultDisplay
                vault={vault}
                sdk={sdk}
                fastVault={serverVerified}
              />
              <AddressDerivationTester vault={vault} />
              <BalanceDisplay vault={vault} />
              <SignTransaction vault={vault} sdk={sdk} />
            </>
          )}
        </div>
      </div>
      {activeKeyshare && (
        <LoadVaultModal
          keyshare={activeKeyshare}
          sdk={sdk}
          onClose={() => setActiveKeyshare(null)}
          onVaultLoaded={handleVaultLoaded}
          onInitialize={onInitialize}
        />
      )}
      <ExportModal
        isOpen={showExportModal && !!vault}
        onClose={() => setShowExportModal(false)}
        onExport={doExport}
        exporting={exporting}
        error={exportError}
      />
    </div>
  )
}

export default App
