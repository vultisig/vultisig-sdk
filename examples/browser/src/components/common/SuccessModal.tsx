import Button from './Button'
import Modal from './Modal'

type SuccessModalProps = {
  isOpen: boolean
  onClose: () => void
  title: string
  heading: string
  message: string
  buttonText?: string
}

export default function SuccessModal({
  isOpen,
  onClose,
  title,
  heading,
  message,
  buttonText = 'Done',
}: SuccessModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <div className="text-center space-y-4">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
          <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{heading}</h3>
          <p className="text-sm text-gray-600 mt-1">{message}</p>
        </div>
        <Button onClick={onClose} variant="primary" fullWidth>
          {buttonText}
        </Button>
      </div>
    </Modal>
  )
}
