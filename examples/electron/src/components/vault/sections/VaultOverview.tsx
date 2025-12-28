import { useState } from 'react'

import { dialog, vault } from '@/api/sdk-bridge'
import Button from '@/components/common/Button'
import Input from '@/components/common/Input'
import Modal from '@/components/common/Modal'
import type { VaultInfo } from '@/types'
import { shortenAddress } from '@/utils/formatting'

type VaultOverviewProps = {
  vault: VaultInfo
  onVaultDeleted?: (vaultId: string) => void
  onVaultRenamed?: (vaultId: string, newName: string) => void
}

export default function VaultOverview({ vault: vaultInfo, onVaultDeleted, onVaultRenamed }: VaultOverviewProps) {
  const [isRenameOpen, setIsRenameOpen] = useState(false)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [isExportOpen, setIsExportOpen] = useState(false)
  const [newName, setNewName] = useState(vaultInfo.name)
  const [exportPassword, setExportPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Rename vault
  const handleRename = async () => {
    if (!newName.trim()) {
      setError('Vault name cannot be empty')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      await vault.rename(vaultInfo.id, newName.trim())
      onVaultRenamed?.(vaultInfo.id, newName.trim())
      setIsRenameOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename vault')
    } finally {
      setIsLoading(false)
    }
  }

  // Export vault using native file dialog
  const handleExport = async () => {
    if (!exportPassword) {
      setError('Password is required to export')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const exportedData = await vault.export(vaultInfo.id, { password: exportPassword })

      // Show save dialog
      const result = await dialog.saveFile({
        title: 'Save Vault Export',
        defaultPath: `${vaultInfo.name}.vult`,
        filters: [{ name: 'Vault Files', extensions: ['vult'] }],
      })

      if (!result.canceled && result.filePath) {
        await dialog.writeFile(result.filePath, exportedData)
      }

      setIsExportOpen(false)
      setExportPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export vault')
    } finally {
      setIsLoading(false)
    }
  }

  // Delete vault
  const handleDelete = async () => {
    setIsLoading(true)
    setError(null)

    try {
      await vault.delete(vaultInfo.id)
      onVaultDeleted?.(vaultInfo.id)
      setIsDeleteOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete vault')
    } finally {
      setIsLoading(false)
    }
  }

  const closeRenameModal = () => {
    setIsRenameOpen(false)
    setNewName(vaultInfo.name)
    setError(null)
  }

  const closeExportModal = () => {
    setIsExportOpen(false)
    setExportPassword('')
    setError(null)
  }

  const closeDeleteModal = () => {
    setIsDeleteOpen(false)
    setError(null)
  }

  return (
    <div className="space-y-6">
      {/* Vault Information Card */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-6">Vault Information</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <InfoItem label="Name" value={vaultInfo.name} />
          <InfoItem label="ID" value={shortenAddress(vaultInfo.id, 8)} mono />
          <InfoItem label="Type" value={vaultInfo.type === 'fast' ? 'Fast Vault' : 'Secure Vault'} />
          <InfoItem label="Chains" value={vaultInfo.chains.length.toString()} />
          {vaultInfo.threshold && (
            <InfoItem label="Threshold" value={`${vaultInfo.threshold} of ${vaultInfo.chains.length}`} />
          )}
        </div>
      </div>

      {/* Actions Card */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-4">Vault Actions</h3>

        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => setIsRenameOpen(true)}>
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
            Rename
          </Button>

          <Button variant="secondary" onClick={() => setIsExportOpen(true)}>
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
            Export
          </Button>

          <Button variant="danger" onClick={() => setIsDeleteOpen(true)}>
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
            Delete
          </Button>
        </div>
      </div>

      {/* Rename Modal */}
      <Modal isOpen={isRenameOpen} onClose={closeRenameModal} title="Rename Vault">
        <div className="space-y-4">
          <Input
            label="New Vault Name"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Enter new name"
          />
          {error && <div className="text-error text-sm bg-red-50 p-3 rounded">{error}</div>}
          <div className="flex gap-3 justify-end">
            <Button variant="secondary" onClick={closeRenameModal}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleRename} isLoading={isLoading}>
              Rename
            </Button>
          </div>
        </div>
      </Modal>

      {/* Export Modal */}
      <Modal isOpen={isExportOpen} onClose={closeExportModal} title="Export Vault">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Export your vault as an encrypted backup file. You will need this password to import the vault later.
          </p>
          <Input
            label="Encryption Password"
            type="password"
            value={exportPassword}
            onChange={e => setExportPassword(e.target.value)}
            placeholder="Enter password"
          />
          {error && <div className="text-error text-sm bg-red-50 p-3 rounded">{error}</div>}
          <div className="flex gap-3 justify-end">
            <Button variant="secondary" onClick={closeExportModal}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleExport} isLoading={isLoading}>
              Export
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal isOpen={isDeleteOpen} onClose={closeDeleteModal} title="Delete Vault">
        <div className="space-y-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <svg className="w-6 h-6 text-red-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <div>
                <h4 className="font-semibold text-red-800">Warning: This action cannot be undone</h4>
                <p className="text-sm text-red-700 mt-1">
                  Deleting this vault will permanently remove it. Make sure you have exported a backup if you want to
                  recover it later.
                </p>
              </div>
            </div>
          </div>
          <p className="text-sm text-gray-600">
            Are you sure you want to delete <strong>{vaultInfo.name}</strong>?
          </p>
          {error && <div className="text-error text-sm bg-red-50 p-3 rounded">{error}</div>}
          <div className="flex gap-3 justify-end">
            <Button variant="secondary" onClick={closeDeleteModal}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete} isLoading={isLoading}>
              Delete Vault
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// Helper component for displaying info items
function InfoItem({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-sm font-medium text-gray-500 mb-1">{label}</div>
      <p className={`text-lg ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  )
}
