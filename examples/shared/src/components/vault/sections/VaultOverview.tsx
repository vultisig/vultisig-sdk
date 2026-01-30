import { useEffect, useState } from 'react'

import { useFileAdapter, useSDKAdapter } from '../../../adapters'
import type { DiscountTier, VaultInfo } from '../../../types'
import { shortenAddress } from '../../../utils/formatting'
import Button from '../../common/Button'
import Input from '../../common/Input'
import Modal from '../../common/Modal'

type VaultOverviewProps = {
  vault: VaultInfo
  onVaultDeleted?: (vaultId: string) => void
  onVaultRenamed?: (vaultId: string, newName: string) => void
}

export default function VaultOverview({ vault, onVaultDeleted, onVaultRenamed }: VaultOverviewProps) {
  const sdk = useSDKAdapter()
  const fileAdapter = useFileAdapter()

  const [isRenameOpen, setIsRenameOpen] = useState(false)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [isExportOpen, setIsExportOpen] = useState(false)
  const [newName, setNewName] = useState(vault.name)
  const [exportPassword, setExportPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Discount tier state
  const [discountTier, setDiscountTier] = useState<DiscountTier>(null)
  const [isTierLoading, setIsTierLoading] = useState(false)
  const [tierError, setTierError] = useState<string | null>(null)

  // Fetch discount tier on mount
  useEffect(() => {
    const fetchTier = async () => {
      setIsTierLoading(true)
      setTierError(null)
      try {
        const tier = await sdk.getDiscountTier(vault.id)
        setDiscountTier(tier)
      } catch (err) {
        setTierError(err instanceof Error ? err.message : 'Failed to fetch tier')
      } finally {
        setIsTierLoading(false)
      }
    }
    fetchTier()
  }, [vault.id, sdk])

  // Refresh discount tier
  const handleRefreshTier = async () => {
    setIsTierLoading(true)
    setTierError(null)
    try {
      const tier = await sdk.updateDiscountTier(vault.id)
      setDiscountTier(tier)
    } catch (err) {
      setTierError(err instanceof Error ? err.message : 'Failed to refresh tier')
    } finally {
      setIsTierLoading(false)
    }
  }

  // Rename vault
  const handleRename = async () => {
    if (!newName.trim()) {
      setError('Vault name cannot be empty')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      await sdk.renameVault(vault.id, newName.trim())
      onVaultRenamed?.(vault.id, newName.trim())
      setIsRenameOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename vault')
    } finally {
      setIsLoading(false)
    }
  }

  // Export vault
  const handleExport = async () => {
    setIsLoading(true)
    setError(null)

    try {
      const data = await sdk.exportVault(vault.id, {
        password: exportPassword || undefined,
      })

      // Save via file adapter
      const saved = await fileAdapter.saveFile(data, {
        title: 'Export Vault',
        defaultName: `${vault.name}.vult`,
        filters: [{ name: 'Vault Files', extensions: ['vult'] }],
      })

      if (saved) {
        setIsExportOpen(false)
        setExportPassword('')
      }
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
      await sdk.deleteVault(vault.id)
      onVaultDeleted?.(vault.id)
      setIsDeleteOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete vault')
    } finally {
      setIsLoading(false)
    }
  }

  const closeRenameModal = () => {
    setIsRenameOpen(false)
    setNewName(vault.name)
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
          <InfoItem label="Name" value={vault.name} />
          <InfoItem label="ID" value={shortenAddress(vault.id, 8)} mono />
          <InfoItem label="Type" value={vault.type === 'fast' ? 'Fast Vault' : 'Secure Vault'} />
          <InfoItem label="Chains" value={vault.chains.length.toString()} />
          {vault.threshold && (
            <InfoItem label="Threshold" value={`${vault.threshold} of ${vault.signerCount ?? vault.threshold}`} />
          )}
        </div>
      </div>

      {/* Discount Tier Card */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">VULT Discount Tier</h3>
          <Button variant="secondary" size="small" onClick={handleRefreshTier} isLoading={isTierLoading}>
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

        {tierError && <div className="text-error text-sm bg-red-50 p-3 rounded mb-4">{tierError}</div>}

        <DiscountTierBadge tier={discountTier} isLoading={isTierLoading} />

        <p className="text-sm text-gray-500 mt-3">
          Your tier is based on VULT token and Thorguard NFT holdings on Ethereum. Higher tiers get lower swap fees.
        </p>
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
            Export your vault as a backup file. Optionally encrypt it with a password.
          </p>
          <Input
            label="Encryption Password (Optional)"
            type="password"
            value={exportPassword}
            onChange={e => setExportPassword(e.target.value)}
            placeholder="Leave empty for no encryption"
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
            Are you sure you want to delete <strong>{vault.name}</strong>?
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
function InfoItem({
  label,
  value,
  mono = false,
  warning = false,
}: {
  label: string
  value: string
  mono?: boolean
  warning?: boolean
}) {
  return (
    <div>
      <div className="text-sm font-medium text-gray-500 mb-1">{label}</div>
      <p className={`text-lg ${mono ? 'font-mono' : ''} ${warning ? 'text-amber-600' : ''}`}>
        {value}
        {warning && <span className="ml-2 text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded">Not backed up</span>}
      </p>
    </div>
  )
}

// Helper component for displaying discount tier badge
function DiscountTierBadge({ tier, isLoading }: { tier: DiscountTier; isLoading: boolean }) {
  if (isLoading) {
    return <div className="animate-pulse h-8 w-24 bg-gray-200 rounded" />
  }

  if (!tier) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-gray-500">No tier</span>
        <span className="text-xs text-gray-400">(Hold VULT to unlock discounts)</span>
      </div>
    )
  }

  const tierColors: Record<string, string> = {
    bronze: 'bg-amber-700 text-white',
    silver: 'bg-gray-400 text-white',
    gold: 'bg-yellow-500 text-black',
    platinum: 'bg-slate-300 text-black',
    diamond: 'bg-cyan-400 text-black',
    ultimate: 'bg-gradient-to-r from-purple-500 to-pink-500 text-white',
  }

  return (
    <span
      className={`inline-flex items-center px-3 py-1.5 rounded-full text-sm font-semibold capitalize ${tierColors[tier]}`}
    >
      {tier}
    </span>
  )
}
