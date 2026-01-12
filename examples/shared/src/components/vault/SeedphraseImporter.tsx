import { useState } from 'react'

import { useSDKAdapter } from '../../adapters'
import type { ProgressStep, SeedphraseValidation, VaultInfo } from '../../types'
import Button from '../common/Button'
import DeviceProgress from '../common/DeviceProgress'
import Input from '../common/Input'
import Modal from '../common/Modal'
import ProgressModal from '../common/ProgressModal'
import QRCodeModal from '../common/QRCodeModal'
import SuccessModal from '../common/SuccessModal'

type SeedphraseImporterProps = {
  onVaultCreated: (vault: VaultInfo) => void
}

type Step = 'seedphrase' | 'form' | 'verify' | 'qr' | 'keygen' | 'complete'

export default function SeedphraseImporter({ onVaultCreated }: SeedphraseImporterProps) {
  const sdk = useSDKAdapter()

  const [isOpen, setIsOpen] = useState(false)
  const [vaultType, setVaultType] = useState<'fast' | 'secure'>('fast')
  const [step, setStep] = useState<Step>('seedphrase')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Seedphrase state
  const [mnemonic, setMnemonic] = useState('')
  const [validation, setValidation] = useState<SeedphraseValidation | null>(null)
  const [discoverChains, setDiscoverChains] = useState(false)

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    deviceCount: 2,
  })

  // Vault creation state
  const [vaultId, setVaultId] = useState<string | null>(null)
  const [verificationCode, setVerificationCode] = useState('')

  // Secure vault state
  const [qrPayload, setQrPayload] = useState<string | null>(null)
  const [devicesJoined, setDevicesJoined] = useState(0)
  const [keygenProgress, setKeygenProgress] = useState<ProgressStep | null>(null)
  const [createdVault, setCreatedVault] = useState<VaultInfo | null>(null)

  // Calculate word count
  const wordCount = mnemonic.trim() ? mnemonic.trim().split(/\s+/).length : 0
  const isValidWordCount = wordCount === 12 || wordCount === 24

  const handleValidateSeedphrase = async () => {
    if (!isValidWordCount) {
      setError('Seedphrase must be 12 or 24 words')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const result = await sdk.validateSeedphrase(mnemonic.trim().toLowerCase())
      setValidation(result)

      if (result.valid) {
        setStep('form')
      } else {
        setError(result.error || 'Invalid seedphrase')
        if (result.invalidWords?.length) {
          setError(`Invalid words: ${result.invalidWords.join(', ')}`)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation failed')
    } finally {
      setIsLoading(false)
    }
  }

  const handleImportFast = async (e: React.FormEvent) => {
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
      const result = await sdk.importSeedphraseAsFastVault({
        mnemonic: mnemonic.trim().toLowerCase(),
        name: formData.name,
        email: formData.email,
        password: formData.password,
        discoverChains,
      })

      setVaultId(result.vaultId)
      setStep('verify')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
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

      const vault = await sdk.verifyVault(vaultId, verificationCode)
      onVaultCreated(vault)
      handleClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed')
    } finally {
      setIsLoading(false)
    }
  }

  const handleImportSecure = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!formData.name) {
      setError('Vault name is required')
      return
    }

    setIsLoading(true)
    setStep('qr')

    try {
      const result = await sdk.importSeedphraseAsSecureVault({
        mnemonic: mnemonic.trim().toLowerCase(),
        name: formData.name,
        password: formData.password || undefined,
        devices: formData.deviceCount,
        threshold: Math.ceil((formData.deviceCount + 1) / 2),
        discoverChains,
        onProgress: progress => {
          setKeygenProgress(progress)
          if (progress.phase === 'keygen') {
            setStep('keygen')
          }
        },
        onQRCodeReady: payload => {
          setQrPayload(payload)
        },
        onDeviceJoined: (_deviceId, totalJoined, _required) => {
          setDevicesJoined(totalJoined)
        },
      })

      setCreatedVault(result.vault)
      setStep('complete')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
      setStep('form')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSuccessClose = () => {
    if (createdVault) {
      onVaultCreated(createdVault)
    }
    handleClose()
  }

  const handleClose = () => {
    setIsOpen(false)
    setStep('seedphrase')
    setVaultType('fast')
    setMnemonic('')
    setValidation(null)
    setDiscoverChains(false)
    setFormData({
      name: '',
      email: '',
      password: '',
      confirmPassword: '',
      deviceCount: 2,
    })
    setVaultId(null)
    setVerificationCode('')
    setQrPayload(null)
    setDevicesJoined(0)
    setKeygenProgress(null)
    setCreatedVault(null)
    setError(null)
  }

  const renderSeedphraseStep = () => (
    <div className="space-y-4">
      <div className="flex gap-2 mb-4">
        <Button
          variant={vaultType === 'fast' ? 'primary' : 'secondary'}
          size="small"
          onClick={() => setVaultType('fast')}
        >
          FastVault
        </Button>
        <Button
          variant={vaultType === 'secure' ? 'primary' : 'secondary'}
          size="small"
          onClick={() => setVaultType('secure')}
        >
          SecureVault
        </Button>
      </div>

      <p className="text-sm text-gray-600">
        {vaultType === 'fast'
          ? 'FastVault uses VultiServer for instant signing (2-of-2).'
          : 'SecureVault requires mobile device coordination (N-of-M).'}
      </p>

      <div>
        <label htmlFor="seedphrase-input" className="block text-sm font-medium text-gray-700 mb-1">
          Recovery Phrase
        </label>
        <textarea
          id="seedphrase-input"
          className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
          rows={4}
          value={mnemonic}
          onChange={e => {
            setMnemonic(e.target.value)
            setValidation(null)
            setError(null)
          }}
          placeholder="Enter your 12 or 24-word recovery phrase..."
        />
        <div className="flex justify-between mt-1">
          <span className={`text-sm ${isValidWordCount ? 'text-green-600' : 'text-gray-500'}`}>
            Words: {wordCount}/{wordCount <= 12 ? 12 : 24}
            {isValidWordCount && validation?.valid && ' ✓'}
          </span>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={discoverChains}
          onChange={e => setDiscoverChains(e.target.checked)}
          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        Discover chains with existing balances
      </label>

      {error && <div className="text-error text-sm bg-red-50 p-3 rounded">{error}</div>}

      <Button
        variant="primary"
        fullWidth
        isLoading={isLoading}
        disabled={!isValidWordCount}
        onClick={handleValidateSeedphrase}
      >
        Continue
      </Button>
    </div>
  )

  const renderFastFormStep = () => (
    <form onSubmit={handleImportFast} className="space-y-4">
      <div className="text-sm text-green-600 bg-green-50 p-3 rounded">
        ✓ Valid {validation?.wordCount}-word seedphrase
      </div>

      <Input
        label="Vault Name"
        value={formData.name}
        onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
        placeholder="My Imported Wallet"
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
        onChange={e => setFormData(prev => ({ ...prev, confirmPassword: e.target.value }))}
        placeholder="Re-enter password"
        required
      />

      {error && <div className="text-error text-sm bg-red-50 p-3 rounded">{error}</div>}

      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => setStep('seedphrase')}>
          Back
        </Button>
        <Button type="submit" variant="primary" fullWidth isLoading={isLoading}>
          Import Seedphrase
        </Button>
      </div>
    </form>
  )

  const renderSecureFormStep = () => (
    <form onSubmit={handleImportSecure} className="space-y-4">
      <div className="text-sm text-green-600 bg-green-50 p-3 rounded">
        ✓ Valid {validation?.wordCount}-word seedphrase
      </div>

      <Input
        label="Vault Name"
        value={formData.name}
        onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
        placeholder="Team Wallet"
        required
      />

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Number of Devices: {formData.deviceCount}
        </label>
        <input
          type="range"
          min="2"
          max="10"
          value={formData.deviceCount}
          onChange={e => setFormData(prev => ({ ...prev, deviceCount: parseInt(e.target.value, 10) }))}
          className="w-full"
        />
        <p className="text-sm text-gray-500 mt-1">
          Threshold: {Math.ceil((formData.deviceCount + 1) / 2)}-of-{formData.deviceCount}
        </p>
      </div>

      <Input
        label="Password (optional)"
        type="password"
        value={formData.password}
        onChange={e => setFormData(prev => ({ ...prev, password: e.target.value }))}
        placeholder="Optional encryption password"
      />

      {error && <div className="text-error text-sm bg-red-50 p-3 rounded">{error}</div>}

      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => setStep('seedphrase')}>
          Back
        </Button>
        <Button type="submit" variant="primary" fullWidth isLoading={isLoading}>
          Start Import
        </Button>
      </div>
    </form>
  )

  const renderVerifyStep = () => (
    <form onSubmit={handleVerify} className="space-y-4">
      <p className="text-sm text-gray-600 bg-blue-50 p-3 rounded">
        A verification code has been sent to <strong>{formData.email}</strong>. Please enter it below to complete the
        import.
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
  )

  const getModalContent = () => {
    switch (step) {
      case 'seedphrase':
        return renderSeedphraseStep()
      case 'form':
        return vaultType === 'fast' ? renderFastFormStep() : renderSecureFormStep()
      case 'verify':
        return renderVerifyStep()
      default:
        return null
    }
  }

  const getModalTitle = () => {
    switch (step) {
      case 'seedphrase':
        return 'Import from Seedphrase'
      case 'form':
        return vaultType === 'fast' ? 'FastVault Details' : 'SecureVault Details'
      case 'verify':
        return 'Email Verification'
      default:
        return 'Import from Seedphrase'
    }
  }

  return (
    <>
      <Button onClick={() => setIsOpen(true)} variant="secondary" fullWidth>
        Import Seedphrase
      </Button>

      {/* Main Modal */}
      {step !== 'qr' && step !== 'keygen' && step !== 'complete' && (
        <Modal isOpen={isOpen} onClose={handleClose} title={getModalTitle()}>
          {getModalContent()}
        </Modal>
      )}

      {/* QR Code Modal for SecureVault */}
      {step === 'qr' && qrPayload && (
        <QRCodeModal
          isOpen={isOpen}
          onClose={handleClose}
          title="Scan to Join"
          qrData={qrPayload}
          subtitle={`Importing: ${formData.name}`}
          statusText="Scan with Vultisig mobile app"
        >
          <DeviceProgress currentDevices={devicesJoined} requiredDevices={formData.deviceCount} action="keygen" />
        </QRCodeModal>
      )}

      {/* Keygen Progress Modal */}
      {step === 'keygen' && (
        <ProgressModal
          isOpen={isOpen}
          onClose={handleClose}
          title="Generating Keys"
          message={keygenProgress?.message || 'Generating keys...'}
          progress={keygenProgress?.progress || 0}
          hint="Please wait while keys are being generated..."
        />
      )}

      {/* Success Modal */}
      {step === 'complete' && createdVault && (
        <SuccessModal
          isOpen={isOpen}
          onClose={handleSuccessClose}
          title="Success"
          heading="Import Successful!"
          message={`SecureVault "${createdVault.name}" has been created.`}
        />
      )}
    </>
  )
}
