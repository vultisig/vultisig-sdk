import Button from '@/components/common/Button'
import DeviceProgress from '@/components/common/DeviceProgress'
import Modal from '@/components/common/Modal'
import ProgressModal from '@/components/common/ProgressModal'
import QRCodeModal from '@/components/common/QRCodeModal'
import SuccessModal from '@/components/common/SuccessModal'

type SigningModalStep = 'waiting_for_qr' | 'qr_ready' | 'devices_joining' | 'signing' | 'complete'

type SigningProgress = {
  message: string
  progress: number
}

type SigningModalProps = {
  isOpen: boolean
  onClose: () => void
  onCancel: () => void
  qrCode: string | null
  step: SigningModalStep
  devicesJoined: number
  devicesRequired: number
  deviceIds?: string[]
  signingProgress: SigningProgress | null
  error?: string | null
}

export default function SigningModal({
  isOpen,
  onClose,
  onCancel,
  qrCode,
  step,
  devicesJoined,
  devicesRequired,
  deviceIds = [],
  signingProgress,
  error,
}: SigningModalProps) {
  // Waiting for QR code to be generated
  if (step === 'waiting_for_qr') {
    return (
      <ProgressModal
        isOpen={isOpen}
        onClose={onCancel}
        onCancel={onCancel}
        title="Preparing Transaction"
        message="Preparing transaction for signing..."
        hint="Please wait while we set up the signing session"
      />
    )
  }

  // QR code ready - show it with device progress
  if ((step === 'qr_ready' || step === 'devices_joining') && qrCode) {
    return (
      <QRCodeModal
        isOpen={isOpen}
        onClose={onCancel}
        onCancel={onCancel}
        title="Sign with Mobile Devices"
        qrData={qrCode}
        subtitle={`Scan this QR code with ${devicesRequired} Vultisig mobile devices to sign the transaction`}
        statusText={
          devicesJoined < devicesRequired
            ? `Waiting for ${devicesRequired - devicesJoined} more device(s)...`
            : 'All devices connected! Signing...'
        }
      >
        <DeviceProgress
          currentDevices={devicesJoined}
          requiredDevices={devicesRequired}
          action="signing"
          deviceIds={deviceIds}
        />
      </QRCodeModal>
    )
  }

  // Signing in progress
  if (step === 'signing') {
    return (
      <ProgressModal
        isOpen={isOpen}
        onClose={onCancel}
        onCancel={onCancel}
        title="Signing Transaction"
        message={signingProgress?.message || 'Signing transaction...'}
        progress={signingProgress?.progress}
        hint="Please keep the mobile devices connected during signing"
      />
    )
  }

  // Complete
  if (step === 'complete') {
    return (
      <SuccessModal
        isOpen={isOpen}
        onClose={onClose}
        title="Transaction Signed"
        heading="Transaction Signed!"
        message="The transaction has been signed and will be broadcast."
      />
    )
  }

  // Error state
  if (error) {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title="Signing Failed">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
            <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Signing Failed</h3>
            <p className="text-sm text-red-600 mt-1">{error}</p>
          </div>
          <Button onClick={onClose} variant="secondary" fullWidth>
            Close
          </Button>
        </div>
      </Modal>
    )
  }

  // Default/unknown state - shouldn't normally happen
  return (
    <ProgressModal
      isOpen={isOpen}
      onClose={onCancel}
      onCancel={onCancel}
      title="Sign Transaction"
      message="Preparing to sign..."
    />
  )
}
