import { VaultImportError, VaultImportErrorCode } from '@vultisig/sdk'
import { useState } from 'react'

import { useFileAdapter, useSDKAdapter } from '../../adapters'
import type { SelectedFile, VaultInfo } from '../../types'
import Button from '../common/Button'
import Input from '../common/Input'
import Modal from '../common/Modal'

type VaultImporterProps = {
  onVaultImported: (vaults: VaultInfo[]) => void
}

type FileImportIssue = { fileName: string; message: string }

function describeVaultImportFailure(error: unknown): string {
  if (error instanceof VaultImportError) {
    switch (error.code) {
      case VaultImportErrorCode.INVALID_PASSWORD:
        return 'Wrong password — could not decrypt this vault file.'
      case VaultImportErrorCode.PASSWORD_REQUIRED:
        return 'Password required for this encrypted vault.'
      case VaultImportErrorCode.INVALID_FILE_FORMAT:
        return 'Invalid or unrecognized vault file format.'
      case VaultImportErrorCode.CORRUPTED_DATA:
        return 'Vault data appears corrupted or incomplete.'
      case VaultImportErrorCode.UNSUPPORTED_FORMAT:
        return 'This vault format is not supported.'
      default:
        return error.message
    }
  }
  if (error instanceof Error) {
    return error.message
  }
  return 'Import failed.'
}

function formatAllFailedSummary(failures: FileImportIssue[]): string {
  if (failures.length === 0) {
    return 'No vaults were imported.'
  }
  if (failures.length === 1) {
    return `${failures[0].fileName}: ${failures[0].message}`
  }
  return ['Could not import any vaults:', ...failures.map(f => `• ${f.fileName}: ${f.message}`)].join('\n')
}

export default function VaultImporter({ onVaultImported }: VaultImporterProps) {
  const sdk = useSDKAdapter()
  const fileAdapter = useFileAdapter()

  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [postImportWarnings, setPostImportWarnings] = useState<FileImportIssue[] | null>(null)
  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([])
  const [passwordPrompt, setPasswordPrompt] = useState<{
    fileName: string
    resolve: (password: string | null) => void
  } | null>(null)
  const [passwordInput, setPasswordInput] = useState('')

  const handleSelectFiles = async () => {
    try {
      const result = await fileAdapter.selectFiles({
        title: 'Select Vault Files',
        filters: [{ name: 'Vault Files', extensions: ['vult', 'json'] }],
        multiple: true,
      })

      if (!result.canceled && result.files.length > 0) {
        setSelectedFiles(result.files)
        setError(null)
        setPostImportWarnings(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to select files')
    }
  }

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setPostImportWarnings(null)

    if (selectedFiles.length === 0) {
      setError('Please select at least one vault file')
      return
    }

    setIsLoading(true)

    try {
      const importedVaults: VaultInfo[] = []
      const failures: FileImportIssue[] = []

      for (const file of selectedFiles) {
        try {
          const content = await fileAdapter.readFile(file)

          let password: string | undefined = undefined

          const isEncrypted = await sdk.isVaultEncrypted(content)
          if (isEncrypted) {
            const passwordResult = await new Promise<string | null>(resolve => {
              setPasswordPrompt({ fileName: file.name, resolve })
            })

            if (!passwordResult) {
              failures.push({
                fileName: file.name,
                message: 'Password was skipped or cancelled — encrypted vault was not imported.',
              })
              continue
            }
            password = passwordResult
          }

          const importedVault = await sdk.importVault(content, password)
          importedVaults.push(importedVault)
        } catch (fileError) {
          console.error(`Failed to import ${file.name}:`, fileError)
          failures.push({
            fileName: file.name,
            message: describeVaultImportFailure(fileError),
          })
        }
      }

      if (importedVaults.length === 0) {
        setError(formatAllFailedSummary(failures))
        return
      }

      onVaultImported(importedVaults)
      if (failures.length > 0) {
        setPostImportWarnings(failures)
      } else {
        handleClose()
      }
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
    setPostImportWarnings(null)
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
                {selectedFiles.map((file, index) => (
                  <li key={index} className="text-sm text-gray-600">
                    • {file.name}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && (
            <div className="text-error text-sm bg-red-50 p-3 rounded whitespace-pre-wrap">{error}</div>
          )}

          {postImportWarnings && postImportWarnings.length > 0 && (
            <div className="text-amber-900 text-sm bg-amber-50 p-3 rounded border border-amber-200">
              <strong>Some files could not be imported</strong>
              <ul className="mt-2 list-disc pl-5 space-y-1">
                {postImportWarnings.map((w, index) => (
                  <li key={`${w.fileName}-${index}`}>
                    <span className="font-medium">{w.fileName}</span>: {w.message}
                  </li>
                ))}
              </ul>
              <Button type="button" className="mt-3" variant="secondary" fullWidth onClick={handleClose}>
                Done
              </Button>
            </div>
          )}

          <Button
            type="submit"
            variant="primary"
            fullWidth
            isLoading={isLoading}
            disabled={selectedFiles.length === 0 || !!postImportWarnings}
          >
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
              Cancel
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
