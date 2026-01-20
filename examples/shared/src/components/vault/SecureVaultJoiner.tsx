import { useRef, useState } from 'react'

import { useSDKAdapter } from '../../adapters'
import type { ProgressStep, VaultInfo } from '../../types'
import Button from '../common/Button'
import DeviceProgress from '../common/DeviceProgress'
import Input from '../common/Input'
import Modal from '../common/Modal'
import ProgressModal from '../common/ProgressModal'
import SuccessModal from '../common/SuccessModal'

// Helper to wrap a promise with abort signal support
function withAbortSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise

  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      if (signal.aborted) reject(new Error('Operation aborted'))
      signal.addEventListener('abort', () => reject(new Error('Operation aborted')), { once: true })
    }),
  ])
}

type SecureVaultJoinerProps = {
  onVaultCreated: (vault: VaultInfo) => void
}

type JoinStep = 'form' | 'joining' | 'keygen' | 'complete'

export default function SecureVaultJoiner({ onVaultCreated }: SecureVaultJoinerProps) {
  const sdk = useSDKAdapter()

  const [isOpen, setIsOpen] = useState(false)
  const [step, setStep] = useState<JoinStep>('form')
  const [isLoading, setIsLoading] = useState(false)
  const [formData, setFormData] = useState({
    qrPayload: '',
    mnemonic: '',
    password: '',
  })
  const [devicesJoined, setDevicesJoined] = useState(0)
  const [requiredDevices, setRequiredDevices] = useState(0)
  const [deviceIds, setDeviceIds] = useState<string[]>([])
  const [progress, setProgress] = useState<ProgressStep | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [createdVault, setCreatedVault] = useState<VaultInfo | null>(null)

  // Track if seedphrase is required (based on QR payload libType)
  const [showMnemonic, setShowMnemonic] = useState(false)

  const abortControllerRef = useRef<AbortController | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    // Validation
    if (!formData.qrPayload.trim()) {
      setError('QR payload is required')
      return
    }

    // Try to parse the QR payload to detect if seedphrase is needed
    try {
      // The QR payload is base64 encoded, check if it contains KEYIMPORT libType
      const decoded = atob(formData.qrPayload.trim())
      if (decoded.includes('KEYIMPORT') && !formData.mnemonic.trim()) {
        setShowMnemonic(true)
        setError('This session requires a seedphrase to join')
        return
      }
    } catch {
      // If we can't decode, just proceed and let the SDK handle it
    }

    setIsLoading(true)
    setStep('joining')

    // Create abort controller for cancellation
    abortControllerRef.current = new AbortController()

    try {
      const result = await withAbortSignal(
        sdk.joinSecureVault(formData.qrPayload.trim(), {
          mnemonic: formData.mnemonic.trim() || undefined,
          password: formData.password || undefined,
          onProgress: (progressStep: ProgressStep) => {
            setProgress(progressStep)
            if (progressStep.phase === 'keygen') {
              setStep('keygen')
            }
          },
          onDeviceJoined: (deviceId: string, totalJoined: number, required: number) => {
            setDevicesJoined(totalJoined)
            setRequiredDevices(required)
            setDeviceIds(prev => (prev.includes(deviceId) ? prev : [...prev, deviceId]))
          },
        }),
        abortControllerRef.current?.signal
      )

      setCreatedVault(result.vault)
      setStep('complete')
      onVaultCreated(result.vault)

      // Auto-close after success
      setTimeout(() => {
        handleClose()
      }, 2000)
    } catch (err) {
      if (err instanceof Error && (err.message.includes('cancelled') || err.message === 'Operation aborted')) {
        // User cancelled, just close
        handleClose()
        return
      }

      // Check if the error indicates seedphrase is required
      if (err instanceof Error && err.message.includes('mnemonic')) {
        setShowMnemonic(true)
        setError('This session requires a seedphrase to join')
        setStep('form')
        setIsLoading(false)
        return
      }

      setError(err instanceof Error ? err.message : 'Failed to join secure vault')
      setStep('form')
    } finally {
      setIsLoading(false)
      abortControllerRef.current = null
    }
  }

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    handleClose()
  }

  const handleClose = () => {
    setIsOpen(false)
    setStep('form')
    setFormData({ qrPayload: '', mnemonic: '', password: '' })
    setDevicesJoined(0)
    setRequiredDevices(0)
    setDeviceIds([])
    setProgress(null)
    setError(null)
    setCreatedVault(null)
    setShowMnemonic(false)
    setIsLoading(false)
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
  }

  // Joining/waiting modal
  if (step === 'joining') {
    return (
      <>
        <Button onClick={() => setIsOpen(true)} variant="secondary" fullWidth>
          Join Secure Vault
        </Button>

        <Modal isOpen={isOpen} onClose={handleCancel} title="Joining Vault">
          <div className="space-y-4">
            <div className="text-center">
              <div className="animate-spin h-12 w-12 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4" />
              <p className="text-gray-700 font-medium">{progress?.message || 'Connecting to session...'}</p>
              {progress?.progress !== undefined && (
                <p className="text-sm text-gray-500 mt-1">{progress.progress}% complete</p>
              )}
            </div>

            {progress?.progress !== undefined && (
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div
                  className="h-2.5 rounded-full bg-blue-500 transition-all duration-300"
                  style={{ width: `${progress.progress}%` }}
                />
              </div>
            )}

            {requiredDevices > 0 && (
              <DeviceProgress
                currentDevices={devicesJoined}
                requiredDevices={requiredDevices}
                action="keygen"
                deviceIds={deviceIds}
              />
            )}

            <p className="text-xs text-gray-500 text-center">
              Please wait while connecting to the vault creation session
            </p>

            <Button variant="secondary" onClick={handleCancel} fullWidth>
              Cancel
            </Button>
          </div>
        </Modal>
      </>
    )
  }

  // Keygen progress modal
  if (step === 'keygen') {
    return (
      <>
        <Button onClick={() => setIsOpen(true)} variant="secondary" fullWidth>
          Join Secure Vault
        </Button>

        <ProgressModal
          isOpen={isOpen}
          onClose={handleCancel}
          onCancel={handleCancel}
          title="Generating Keys"
          message={progress?.message || 'Generating keys...'}
          progress={progress?.progress}
          hint="Please keep all devices connected during key generation"
        />
      </>
    )
  }

  // Success modal
  if (step === 'complete' && createdVault) {
    return (
      <>
        <Button onClick={() => setIsOpen(true)} variant="secondary" fullWidth>
          Join Secure Vault
        </Button>

        <SuccessModal
          isOpen={isOpen}
          onClose={handleClose}
          title="Vault Joined"
          heading="Successfully Joined!"
          message={`You have joined the secure vault "${createdVault.name}".`}
        />
      </>
    )
  }

  // Form modal (default)
  return (
    <>
      <Button onClick={() => setIsOpen(true)} variant="secondary" fullWidth>
        Join Secure Vault
      </Button>

      <Modal isOpen={isOpen} onClose={handleClose} title="Join Secure Vault">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
            Join an existing vault creation session initiated by another device. Paste the QR payload from the
            initiating device below.
          </div>

          <div>
            <label htmlFor="qr-payload" className="block text-sm font-medium text-gray-700 mb-1">
              QR Payload
            </label>
            <textarea
              id="qr-payload"
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
              rows={4}
              value={formData.qrPayload}
              onChange={e => {
                setFormData(prev => ({ ...prev, qrPayload: e.target.value }))
                setError(null)
              }}
              placeholder="Paste the QR payload here..."
            />
          </div>

          {showMnemonic && (
            <div>
              <label htmlFor="mnemonic-input" className="block text-sm font-medium text-gray-700 mb-1">
                Recovery Phrase
              </label>
              <textarea
                id="mnemonic-input"
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
                rows={3}
                value={formData.mnemonic}
                onChange={e => {
                  setFormData(prev => ({ ...prev, mnemonic: e.target.value }))
                  setError(null)
                }}
                placeholder="Enter the same seedphrase used by the initiator..."
              />
              <p className="text-xs text-gray-500 mt-1">
                This session was initiated from a seedphrase. You must provide the same seedphrase to join.
              </p>
            </div>
          )}

          <div className="border-t border-gray-200 pt-4">
            <Input
              label="Password (Optional)"
              type="password"
              value={formData.password}
              onChange={e => setFormData(prev => ({ ...prev, password: e.target.value }))}
              placeholder="Leave empty for no encryption"
            />
          </div>

          {error && <div className="text-error text-sm bg-red-50 p-3 rounded">{error}</div>}

          <Button type="submit" variant="primary" fullWidth isLoading={isLoading}>
            Join Vault
          </Button>
        </form>
      </Modal>
    </>
  )
}
