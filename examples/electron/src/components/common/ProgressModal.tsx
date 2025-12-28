import Button from './Button'
import Modal from './Modal'

type ProgressModalProps = {
  isOpen: boolean
  onClose: () => void
  onCancel?: () => void
  title: string
  message: string
  progress?: number
  hint?: string
  showCancelButton?: boolean
}

export default function ProgressModal({
  isOpen,
  onClose,
  onCancel,
  title,
  message,
  progress,
  hint,
  showCancelButton = true,
}: ProgressModalProps) {
  const handleCancel = () => {
    onCancel?.()
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={handleCancel} title={title}>
      <div className="space-y-4">
        <div className="text-center">
          <div className="animate-spin h-12 w-12 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-700 font-medium">{message}</p>
          {progress !== undefined && <p className="text-sm text-gray-500 mt-1">{progress}% complete</p>}
        </div>

        {progress !== undefined && (
          <div className="w-full bg-gray-200 rounded-full h-2.5">
            <div
              className="h-2.5 rounded-full bg-blue-500 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}

        {hint && <p className="text-xs text-gray-500 text-center">{hint}</p>}

        {showCancelButton && (
          <Button variant="secondary" onClick={handleCancel} fullWidth>
            Cancel
          </Button>
        )}
      </div>
    </Modal>
  )
}
