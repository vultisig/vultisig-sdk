import { useEffect, useRef, useState } from 'react'

import { events, vault } from '@/api/sdk-bridge'
import Button from '@/components/common/Button'
import DeviceProgress from '@/components/common/DeviceProgress'
import Input from '@/components/common/Input'
import Modal from '@/components/common/Modal'
import ProgressModal from '@/components/common/ProgressModal'
import QRCodeModal from '@/components/common/QRCodeModal'
import SuccessModal from '@/components/common/SuccessModal'
import type { ProgressStep, VaultInfo } from '@/types'

type SecureVaultCreatorProps = {
  onVaultCreated: (vault: VaultInfo) => void
}

type CreationStep = 'form' | 'qr' | 'keygen' | 'complete'

export default function SecureVaultCreator({ onVaultCreated }: SecureVaultCreatorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [step, setStep] = useState<CreationStep>('form')
  const [isLoading, setIsLoading] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    password: '',
    confirmPassword: '',
    deviceCount: 2,
  })
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [devicesJoined, setDevicesJoined] = useState(0)
  const [deviceIds, setDeviceIds] = useState<string[]>([])
  const [progress, setProgress] = useState<ProgressStep | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [createdVault, setCreatedVault] = useState<VaultInfo | null>(null)

  const cancelledRef = useRef(false)

  const threshold = Math.ceil((formData.deviceCount + 1) / 2)

  // Subscribe to IPC events for secure vault creation
  useEffect(() => {
    if (!isOpen || step === 'form' || step === 'complete') return

    const cleanupProgress = events.onVaultCreationProgress(({ step: progressStep }) => {
      setProgress(progressStep)
      if (progressStep.phase === 'keygen') {
        setStep('keygen')
      }
    })

    const cleanupQr = events.onQrCodeReady(({ qrPayload }) => {
      setQrCode(qrPayload)
    })

    const cleanupDevice = events.onDeviceJoined(({ deviceId, totalJoined }) => {
      setDevicesJoined(totalJoined)
      setDeviceIds(prev => (prev.includes(deviceId) ? prev : [...prev, deviceId]))
    })

    return () => {
      cleanupProgress()
      cleanupQr()
      cleanupDevice()
    }
  }, [isOpen, step])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    // Validation
    if (!formData.name) {
      setError('Vault name is required')
      return
    }

    if (formData.password && formData.password !== formData.confirmPassword) {
      setError('Passwords do not match')
      return
    }

    if (formData.password && formData.password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    if (formData.deviceCount < 2) {
      setError('At least 2 devices are required')
      return
    }

    setIsLoading(true)
    setStep('qr')
    cancelledRef.current = false

    try {
      const result = await vault.createSecure({
        name: formData.name,
        password: formData.password || undefined,
        devices: formData.deviceCount,
        threshold,
      })

      if (cancelledRef.current) return

      setCreatedVault(result.vault)
      setStep('complete')
      onVaultCreated(result.vault)

      // Auto-close after success
      setTimeout(() => {
        handleClose()
      }, 2000)
    } catch (err) {
      if (cancelledRef.current) return

      setError(err instanceof Error ? err.message : 'Failed to create secure vault')
      setStep('form')
    } finally {
      setIsLoading(false)
    }
  }

  const handleCancel = () => {
    cancelledRef.current = true
    handleClose()
  }

  const handleClose = () => {
    setIsOpen(false)
    setStep('form')
    setFormData({ name: '', password: '', confirmPassword: '', deviceCount: 2 })
    setQrCode(null)
    setDevicesJoined(0)
    setDeviceIds([])
    setProgress(null)
    setError(null)
    setIsLoading(false)
    setCreatedVault(null)
    cancelledRef.current = false
  }

  // QR code modal during device pairing
  if (step === 'qr' && qrCode) {
    return (
      <>
        <Button onClick={() => setIsOpen(true)} variant="secondary" fullWidth>
          Create Secure Vault
        </Button>

        <QRCodeModal
          isOpen={isOpen}
          onClose={handleCancel}
          onCancel={handleCancel}
          title="Scan with Vultisig App"
          qrData={qrCode}
          subtitle={`Scan this QR code with ${formData.deviceCount} Vultisig mobile devices to create a ${threshold}-of-${formData.deviceCount} vault`}
          statusText={
            devicesJoined < formData.deviceCount ? `Waiting for devices to join...` : 'All devices connected!'
          }
        >
          <DeviceProgress
            currentDevices={devicesJoined}
            requiredDevices={formData.deviceCount}
            action="keygen"
            deviceIds={deviceIds}
          />
        </QRCodeModal>
      </>
    )
  }

  // Keygen progress modal
  if (step === 'keygen') {
    return (
      <>
        <Button onClick={() => setIsOpen(true)} variant="secondary" fullWidth>
          Create Secure Vault
        </Button>

        <ProgressModal
          isOpen={isOpen}
          onClose={handleCancel}
          onCancel={handleCancel}
          title="Creating Vault"
          message={progress?.message || 'Generating keys...'}
          progress={progress?.progress}
          hint="Please keep the mobile devices connected during key generation"
        />
      </>
    )
  }

  // Success modal
  if (step === 'complete' && createdVault) {
    return (
      <>
        <Button onClick={() => setIsOpen(true)} variant="secondary" fullWidth>
          Create Secure Vault
        </Button>

        <SuccessModal
          isOpen={isOpen}
          onClose={handleClose}
          title="Vault Created"
          heading="Secure Vault Created!"
          message={`Your ${threshold}-of-${formData.deviceCount} vault "${createdVault.name}" is ready to use.`}
        />
      </>
    )
  }

  // Form modal (default)
  return (
    <>
      <Button onClick={() => setIsOpen(true)} variant="secondary" fullWidth>
        Create Secure Vault
      </Button>

      <Modal isOpen={isOpen} onClose={handleClose} title="Create Secure Vault">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
            Secure vaults use multi-device MPC (Multi-Party Computation) for enhanced security. You&apos;ll need
            multiple Vultisig mobile apps to create and sign transactions.
          </div>

          <Input
            label="Vault Name"
            value={formData.name}
            onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
            placeholder="My Secure Vault"
            required
          />

          {/* Device count selector */}
          <div>
            <label htmlFor="device-count" className="block text-sm font-medium text-gray-700 mb-1">
              Number of Devices
            </label>
            <div className="flex items-center gap-4">
              <input
                id="device-count"
                type="range"
                min={2}
                max={10}
                value={formData.deviceCount}
                onChange={e => setFormData(prev => ({ ...prev, deviceCount: parseInt(e.target.value) }))}
                className="flex-1"
              />
              <span className="text-lg font-semibold w-8 text-center">{formData.deviceCount}</span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Threshold: {threshold} of {formData.deviceCount} devices required to sign
            </p>
          </div>

          <div className="border-t border-gray-200 pt-4">
            <p className="text-sm text-gray-600 mb-3">Password (Optional) - Encrypt the vault locally</p>
            <Input
              label="Password"
              type="password"
              value={formData.password}
              onChange={e => setFormData(prev => ({ ...prev, password: e.target.value }))}
              placeholder="Leave empty for no encryption"
            />
            {formData.password && (
              <div className="mt-3">
                <Input
                  label="Confirm Password"
                  type="password"
                  value={formData.confirmPassword}
                  onChange={e => setFormData(prev => ({ ...prev, confirmPassword: e.target.value }))}
                  placeholder="Re-enter password"
                />
              </div>
            )}
          </div>

          {error && <div className="text-error text-sm bg-red-50 p-3 rounded">{error}</div>}

          <Button type="submit" variant="primary" fullWidth isLoading={isLoading}>
            Create Vault
          </Button>
        </form>
      </Modal>
    </>
  )
}
