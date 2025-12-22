import { QRCodeSVG } from 'qrcode.react'
import { useState } from 'react'

import Button from './Button'
import Modal from './Modal'

type QRCodeModalProps = {
  isOpen: boolean
  onClose: () => void
  title: string
  qrData: string
  subtitle?: string
  statusText?: string
  showCancelButton?: boolean
  onCancel?: () => void
  children?: React.ReactNode
}

export default function QRCodeModal({
  isOpen,
  onClose,
  title,
  qrData,
  subtitle,
  statusText,
  showCancelButton = true,
  onCancel,
  children,
}: QRCodeModalProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(qrData)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const handleCancel = () => {
    onCancel?.()
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <div className="flex flex-col items-center space-y-4">
        {subtitle && <p className="text-sm text-gray-600 text-center">{subtitle}</p>}

        {/* QR Code */}
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <QRCodeSVG value={qrData} size={240} level="M" />
        </div>

        {/* Status text */}
        {statusText && (
          <div className="flex items-center gap-2 text-blue-600">
            <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full" />
            <span className="text-sm">{statusText}</span>
          </div>
        )}

        {/* Copyable URL */}
        <div className="w-full">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={qrData}
              readOnly
              className="flex-1 text-xs bg-gray-50 border border-gray-200 rounded px-3 py-2 font-mono truncate"
            />
            <button
              onClick={handleCopy}
              className="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded border border-gray-200 transition-colors"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-1 text-center">Or copy this URL for manual entry</p>
        </div>

        {/* Additional content (e.g., device progress) */}
        {children}

        {/* Cancel button */}
        {showCancelButton && (
          <Button variant="secondary" onClick={handleCancel} fullWidth>
            Cancel
          </Button>
        )}
      </div>
    </Modal>
  )
}
