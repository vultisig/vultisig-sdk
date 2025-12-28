import { useState } from 'react'

import { dialog, vault } from '@/api/sdk-bridge'
import Button from '@/components/common/Button'
import Input from '@/components/common/Input'
import Modal from '@/components/common/Modal'
import type { VaultInfo } from '@/types'

type VaultImporterProps = {
  onVaultImported: (vaults: VaultInfo[]) => void
}

export default function VaultImporter({ onVaultImported }: VaultImporterProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedFiles, setSelectedFiles] = useState<string[]>([])
  const [passwordPrompt, setPasswordPrompt] = useState<{
    fileName: string
    resolve: (password: string | null) => void
  } | null>(null)
  const [passwordInput, setPasswordInput] = useState('')

  const handleSelectFiles = async () => {
    try {
      const result = await dialog.openFile({
        title: 'Select Vault Files',
        filters: [{ name: 'Vault Files', extensions: ['vult', 'json'] }],
        multiSelections: true,
      })

      if (!result.canceled && result.filePaths.length > 0) {
        setSelectedFiles(result.filePaths)
        setError(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to select files')
    }
  }

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (selectedFiles.length === 0) {
      setError('Please select at least one vault file')
      return
    }

    setIsLoading(true)

    try {
      const importedVaults: VaultInfo[] = []

      // Import each file
      for (const filePath of selectedFiles) {
        try {
          // Read file content via IPC
          const content = await dialog.readFile(filePath)

          let password: string | undefined = undefined

          // Check if vault is encrypted
          const isEncrypted = await vault.isEncrypted(content)
          if (isEncrypted) {
            // Ask for password using a promise
            const passwordResult = await new Promise<string | null>(resolve => {
              const fileName = filePath.split('/').pop() || filePath
              setPasswordPrompt({ fileName, resolve })
            })

            if (!passwordResult) {
              throw new Error('Password required for encrypted vault')
            }
            password = passwordResult
          }

          // Import vault through IPC
          const importedVault = await vault.import(content, password)
          importedVaults.push(importedVault)
        } catch (fileError) {
          console.error(`Failed to import ${filePath}:`, fileError)
          // Continue with other files instead of failing completely
        }
      }

      if (importedVaults.length === 0) {
        throw new Error('Failed to import any vaults. Check file format.')
      }

      onVaultImported(importedVaults)
      handleClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import vaults')
    } finally {
      setIsLoading(false)
    }
  }

  const handlePasswordSubmit = () => {
    if (passwordPrompt) {
      passwordPrompt.resolve(passwordInput)
      setPasswordPrompt(null)
      setPasswordInput('')
    }
  }

  const handlePasswordCancel = () => {
    if (passwordPrompt) {
      passwordPrompt.resolve(null)
      setPasswordPrompt(null)
      setPasswordInput('')
    }
  }

  const handleClose = () => {
    setIsOpen(false)
    setSelectedFiles([])
    setError(null)
    setPasswordPrompt(null)
    setPasswordInput('')
  }

  return (
    <>
      <Button onClick={() => setIsOpen(true)} variant="secondary" fullWidth>
        Import Vault(s)
      </Button>

      <Modal isOpen={isOpen} onClose={handleClose} title="Import Vault Files">
        <form onSubmit={handleImport} className="space-y-4">
          <div>
            <span className="block text-sm font-medium text-gray-700 mb-2">Select Vault File(s)</span>
            <Button type="button" variant="secondary" onClick={handleSelectFiles}>
              Choose Files...
            </Button>
            <p className="mt-2 text-sm text-gray-500">
              Select one or more .vult files to import. Multiple vaults will be imported simultaneously.
            </p>
          </div>

          {selectedFiles.length > 0 && (
            <div className="bg-gray-50 p-3 rounded border border-gray-200">
              <strong className="text-sm">Selected files ({selectedFiles.length}):</strong>
              <ul className="mt-2 space-y-1">
                {selectedFiles.map((filePath, index) => (
                  <li key={index} className="text-sm text-gray-600">
                    • {filePath.split('/').pop()}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && <div className="text-error text-sm bg-red-50 p-3 rounded">{error}</div>}

          <Button type="submit" variant="primary" fullWidth isLoading={isLoading} disabled={selectedFiles.length === 0}>
            Import {selectedFiles.length > 1 ? `${selectedFiles.length} Vaults` : 'Vault'}
          </Button>
        </form>
      </Modal>

      {/* Password prompt modal */}
      <Modal isOpen={!!passwordPrompt} onClose={handlePasswordCancel} title="Password Required">
        <div className="space-y-4">
          <p className="text-gray-600">
            Please enter the password for <strong>{passwordPrompt?.fileName}</strong>
          </p>
          <Input
            type="password"
            value={passwordInput}
            onChange={e => setPasswordInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handlePasswordSubmit()}
            placeholder="Enter password"
            autoFocus
          />
          <div className="flex justify-end space-x-2">
            <Button variant="secondary" onClick={handlePasswordCancel}>
              Skip
            </Button>
            <Button onClick={handlePasswordSubmit} disabled={!passwordInput}>
              Submit
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
