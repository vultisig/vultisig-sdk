import type { VaultBase } from '@vultisig/sdk'
import { useState } from 'react'

import Button from '@/components/common/Button'
import Modal from '@/components/common/Modal'

type VaultImporterProps = {
  onVaultImported: (vaults: VaultBase[]) => void
}

export default function VaultImporter({ onVaultImported }: VaultImporterProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedFiles(e.target.files)
    setError(null)
  }

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!selectedFiles || selectedFiles.length === 0) {
      setError('Please select at least one vault file')
      return
    }

    setIsLoading(true)

    try {
      const { getSDK } = await import('@/utils/sdk')
      const sdk = getSDK()
      const importedVaults: VaultBase[] = []

      // Import each file
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i]

        // Read file content
        const content = await readFileAsText(file)

        try {
          let password: string | undefined = undefined

          // Check if vault is encrypted using SDK method
          if (sdk.isVaultEncrypted(content)) {
            password = window.prompt(`Enter password for ${file.name}:`)
            if (!password) {
              throw new Error('Password required for encrypted vault')
            }
          }

          // Import vault through SDK
          const vault = await sdk.importVault(content, password)
          importedVaults.push(vault)
        } catch (fileError) {
          console.error(`Failed to import ${file.name}:`, fileError)
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

  const handleClose = () => {
    setIsOpen(false)
    setSelectedFiles(null)
    setError(null)
  }

  const readFileAsText = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(new Error('Failed to read file'))
      reader.readAsText(file)
    })
  }

  return (
    <>
      <Button onClick={() => setIsOpen(true)} variant="secondary" fullWidth>
        Import Vault(s)
      </Button>

      <Modal isOpen={isOpen} onClose={handleClose} title="Import Vault Files">
        <form onSubmit={handleImport} className="space-y-4">
          <div>
            <label htmlFor="vault-files" className="block text-sm font-medium text-gray-700 mb-2">
              Select Vault File(s)
            </label>
            <input
              id="vault-files"
              type="file"
              accept=".vult,.json"
              multiple
              onChange={handleFileChange}
              className="block w-full text-sm text-gray-500
                file:mr-4 file:py-2 file:px-4
                file:rounded-lg file:border-0
                file:text-sm file:font-medium
                file:bg-primary file:text-white
                hover:file:bg-primary-600
                cursor-pointer"
            />
            <p className="mt-2 text-sm text-gray-500">
              Select one or more .vult files to import. Multiple vaults will be imported simultaneously.
            </p>
          </div>

          {selectedFiles && selectedFiles.length > 0 && (
            <div className="bg-gray-50 p-3 rounded border border-gray-200">
              <strong className="text-sm">Selected files ({selectedFiles.length}):</strong>
              <ul className="mt-2 space-y-1">
                {Array.from(selectedFiles).map((file, index) => (
                  <li key={index} className="text-sm text-gray-600">
                    • {file.name}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && <div className="text-error text-sm bg-red-50 p-3 rounded">{error}</div>}

          <Button
            type="submit"
            variant="primary"
            fullWidth
            isLoading={isLoading}
            disabled={!selectedFiles || selectedFiles.length === 0}
          >
            Import {selectedFiles && selectedFiles.length > 1 ? `${selectedFiles.length} Vaults` : 'Vault'}
          </Button>
        </form>
      </Modal>
    </>
  )
}
