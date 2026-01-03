import { useState } from 'react'

import { useSDKAdapter } from '../../adapters'
import type { VaultInfo } from '../../types'
import Button from '../common/Button'
import Input from '../common/Input'
import Modal from '../common/Modal'

type VaultCreatorProps = {
  onVaultCreated: (vault: VaultInfo) => void
}

export default function VaultCreator({ onVaultCreated }: VaultCreatorProps) {
  const sdk = useSDKAdapter()

  const [isOpen, setIsOpen] = useState(false)
  const [step, setStep] = useState<'form' | 'verify'>('form')
  const [isLoading, setIsLoading] = useState(false)
  const [vaultId, setVaultId] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
  })
  const [verificationCode, setVerificationCode] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    // Validation
    if (!formData.name || !formData.email || !formData.password) {
      setError('All fields are required')
      return
    }

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match')
      return
    }

    if (formData.password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    setIsLoading(true)

    try {
      // createFastVault returns just the vaultId - vault is returned from verifyVault
      const result = await sdk.createFastVault({
        name: formData.name,
        password: formData.password,
        email: formData.email,
      })

      // Fast vaults always require email verification
      setVaultId(result.vaultId)
      setStep('verify')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create vault')
    } finally {
      setIsLoading(false)
    }
  }

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsLoading(true)

    try {
      if (!vaultId) {
        throw new Error('No vault ID')
      }

      // verifyVault returns the vault directly (throws on failure)
      const vault = await sdk.verifyVault(vaultId, verificationCode)
      onVaultCreated(vault)
      handleClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed')
    } finally {
      setIsLoading(false)
    }
  }

  const handleClose = () => {
    setIsOpen(false)
    setStep('form')
    setVaultId(null)
    setFormData({ name: '', email: '', password: '', confirmPassword: '' })
    setVerificationCode('')
    setError(null)
  }

  return (
    <>
      <Button onClick={() => setIsOpen(true)} variant="primary" fullWidth>
        Create Fast Vault
      </Button>

      <Modal isOpen={isOpen} onClose={handleClose} title="Create Fast Vault">
        {step === 'form' ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Vault Name"
              value={formData.name}
              onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
              placeholder="My Vault"
              required
            />
            <Input
              label="Email"
              type="email"
              value={formData.email}
              onChange={e => setFormData(prev => ({ ...prev, email: e.target.value }))}
              placeholder="your@email.com"
              required
            />
            <Input
              label="Password"
              type="password"
              value={formData.password}
              onChange={e => setFormData(prev => ({ ...prev, password: e.target.value }))}
              placeholder="Min. 8 characters"
              required
            />
            <Input
              label="Confirm Password"
              type="password"
              value={formData.confirmPassword}
              onChange={e =>
                setFormData(prev => ({
                  ...prev,
                  confirmPassword: e.target.value,
                }))
              }
              placeholder="Re-enter password"
              required
            />
            {error && <div className="text-error text-sm bg-red-50 p-3 rounded">{error}</div>}
            <Button type="submit" variant="primary" fullWidth isLoading={isLoading}>
              Create Vault
            </Button>
          </form>
        ) : (
          <form onSubmit={handleVerify} className="space-y-4">
            <p className="text-sm text-gray-600 bg-blue-50 p-3 rounded">
              A verification code has been sent to <strong>{formData.email}</strong>. Please enter it below to complete
              vault creation.
            </p>
            <Input
              label="Verification Code"
              value={verificationCode}
              onChange={e => setVerificationCode(e.target.value)}
              placeholder="123456"
              required
            />
            {error && <div className="text-error text-sm bg-red-50 p-3 rounded">{error}</div>}
            <Button type="submit" variant="primary" fullWidth isLoading={isLoading}>
              Verify & Complete
            </Button>
          </form>
        )}
      </Modal>
    </>
  )
}
