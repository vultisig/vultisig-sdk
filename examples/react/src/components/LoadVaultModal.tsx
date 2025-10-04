import { useEffect, useState } from 'react'
import type { Vault, Vultisig } from 'vultisig-sdk'

import type { LoadedKeyshare } from '../types'

type LoadVaultModalProps = {
  keyshare: LoadedKeyshare
  sdk: Vultisig
  onClose: () => void
  onVaultLoaded: (v: Vault, options?: { serverVerified?: boolean }) => void
  onInitialize: () => Promise<void>
}

export const LoadVaultModal = ({
  keyshare,
  sdk,
  onClose,
  onVaultLoaded,
  onInitialize,
}: LoadVaultModalProps) => {
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<
    'idle' | 'checking' | 'decrypting' | 'verifying' | 'done' | 'error'
  >('idle')
  const [error, setError] = useState<string | null>(null)
  const [isEncrypted, setIsEncrypted] = useState<boolean | null>(null)
  const [forcePasswordInput, setForcePasswordInput] = useState(false)

  // Check if file is encrypted when component mounts
  useEffect(() => {
    let cancelled = false
    const checkEncryption = async () => {
      try {
        setStatus('checking')
        let encrypted = false
        if (keyshare.file) {
          encrypted = await sdk.isVaultFileEncrypted(keyshare.file)
          console.log('Checking file encryption:', encrypted)
        } else if (keyshare.containerBase64) {
          // For containerBase64, check if it's actually encrypted by examining the content
          // The VaultContainer has an isEncrypted field we can check
          try {
            // Try to parse the base64 content to check the container
            const blob = new Blob([keyshare.containerBase64], {
              type: 'text/plain',
            })
            const file = new File([blob], keyshare.name, { type: 'text/plain' })
            encrypted = await sdk.isVaultFileEncrypted(file)
            console.log(
              'Checking containerBase64 encryption via SDK:',
              encrypted
            )
          } catch {
            // Fallback to stored metadata
            encrypted = keyshare.encrypted || false
            console.log('Using stored encryption status:', encrypted)
          }
        }
        if (!cancelled) {
          setIsEncrypted(encrypted)
          setStatus('idle')
        }
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message)
          setStatus('error')
        }
      }
    }
    checkEncryption()
    return () => {
      cancelled = true
    }
  }, [
    sdk,
    keyshare.file,
    keyshare.containerBase64,
    keyshare.encrypted,
    keyshare.name,
  ])

  const handleLoad = async () => {
    try {
      setError(null)
      setStatus('decrypting')
      await onInitialize()

      console.log(
        'Loading vault - isEncrypted:',
        isEncrypted,
        'password:',
        password ? 'provided' : 'not provided'
      )

      // Use password only if file is encrypted
      let vault: Vault
      try {
        if (keyshare.file) {
          vault = await sdk.addVault(
            keyshare.file,
            isEncrypted || forcePasswordInput ? password : undefined
          )
        } else if (keyshare.containerBase64) {
          // Create a File-like object from the base64 content
          const blob = new Blob([keyshare.containerBase64], {
            type: 'text/plain',
          })
          const file = new File([blob], keyshare.name, { type: 'text/plain' })
          console.log('Importing from containerBase64, file size:', blob.size)
          console.log(
            'First 100 chars of containerBase64:',
            keyshare.containerBase64.substring(0, 100)
          )
          console.log(
            'Using password:',
            (isEncrypted || forcePasswordInput) && password ? 'yes' : 'no'
          )
          vault = await sdk.addVault(
            file,
            isEncrypted || forcePasswordInput ? password : undefined
          )
        } else {
          // If no file or containerBase64, use keyshare data directly (already loaded)
          vault = keyshare.data as Vault
        }
      } catch (err) {
        console.error('Error importing vault:', err)
        const errorMessage = err instanceof Error ? err.message : String(err)
        console.error('Error details:', errorMessage)
        setStatus('error')

        // If vault wasn't detected as encrypted but import failed, suggest trying with password
        if (!isEncrypted && !forcePasswordInput) {
          setError(
            `Failed to import vault. It might be encrypted - try entering a password. (${errorMessage})`
          )
          setForcePasswordInput(true)
        } else {
          setError(
            `Wrong password or corrupted vault file. Please try again. (${errorMessage})`
          )
        }
        return
      }
      // For unencrypted vaults, skip server verification and load directly
      if (!isEncrypted) {
        onVaultLoaded(vault, { serverVerified: false })
        setStatus('done')
        onClose()
        return
      }

      // For encrypted vaults, we'll skip server verification for now
      // since we're loading from a local file
      setStatus('verifying')

      // Just load the vault locally without server verification
      onVaultLoaded(vault, { serverVerified: false })
      setStatus('done')

      onClose()
    } catch (e) {
      setStatus('error')
      setError((e as Error).message)
    }
  }

  const getStatusDisplay = () => {
    switch (status) {
      case 'checking':
        return (
          <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
            Checking file...
          </div>
        )

      case 'decrypting':
        return (
          <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
            Decrypting vault...
          </div>
        )

      case 'verifying':
        return (
          <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
            Verifying with server...
          </div>
        )

      case 'done':
        return (
          <div
            style={{
              padding: '16px',
              backgroundColor: '#d4edda',
              border: '1px solid #c3e6cb',
              borderRadius: '6px',
              color: '#155724',
            }}
          >
            Vault loaded successfully!
          </div>
        )

      case 'error':
        return (
          error && (
            <div
              style={{
                padding: '16px',
                backgroundColor: '#f8d7da',
                border: '1px solid #f5c6cb',
                borderRadius: '6px',
                color: '#721c24',
              }}
            >
              <strong>Error:</strong> {error}
            </div>
          )
        )

      default:
        return null
    }
  }

  const isLoading =
    status === 'checking' || status === 'decrypting' || status === 'verifying'
  const showPasswordInput =
    (isEncrypted || forcePasswordInput) &&
    (status === 'idle' || status === 'error')
  const showActions = status === 'idle' || status === 'error'

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          backgroundColor: 'white',
          borderRadius: '8px',
          padding: '20px',
          maxWidth: '500px',
          width: '90vw',
          maxHeight: '90vh',
          overflow: 'auto',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '16px',
          }}
        >
          <h3 style={{ margin: 0, color: '#333' }}>Load Vault File</h3>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '20px',
              cursor: 'pointer',
              color: '#666',
            }}
          >
            x
          </button>
        </div>

        <div
          style={{
            border: '1px solid #e9ecef',
            borderRadius: '6px',
            padding: '12px',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: keyshare.encrypted ? '#fff3cd' : '#d1ecf1',
              color: keyshare.encrypted ? '#856404' : '#0c5460',
            }}
          >
            {keyshare.encrypted ? '🔒' : '📄'}
          </div>
          <div style={{ flex: 1 }}>
            <div
              style={{ fontWeight: '600', color: '#333', marginBottom: '4px' }}
            >
              {keyshare.name}
            </div>
            <div
              style={{
                fontSize: '12px',
                color: '#666',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {Math.round(keyshare.size / 1024)} KB
              {keyshare.encrypted && <span>🔒</span>}
            </div>
          </div>
        </div>

        {getStatusDisplay()}

        {showPasswordInput && (
          <div style={{ marginBottom: '16px' }}>
            <label
              htmlFor="password"
              style={{
                display: 'block',
                marginBottom: '8px',
                color: '#666',
                fontWeight: '500',
              }}
            >
              Vault Password
            </label>
            <input
              id="password"
              type="password"
              placeholder="Enter your vault password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLoad()}
              autoFocus
              style={{
                width: '100%',
                padding: '10px',
                borderRadius: '6px',
                border: '1px solid #e9ecef',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
              {forcePasswordInput
                ? 'Enter the password you used when exporting this vault (if any)'
                : 'This is the password you set when exporting the vault file'}
            </div>
          </div>
        )}

        {showActions && (
          <div
            style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}
          >
            <button
              onClick={onClose}
              style={{
                padding: '10px 16px',
                backgroundColor: '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleLoad}
              disabled={
                isLoading ||
                ((!!isEncrypted || forcePasswordInput) && !password)
              }
              style={{
                padding: '10px 16px',
                backgroundColor:
                  isLoading ||
                  ((!!isEncrypted || forcePasswordInput) && !password)
                    ? '#6c757d'
                    : '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              Load Vault
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
