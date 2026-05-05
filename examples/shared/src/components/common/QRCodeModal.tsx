import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useRef, useState } from 'react'

import { copyToClipboard } from '../../utils/copyToClipboard'
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
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const copyStatusResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (copyStatusResetTimer.current) {
        clearTimeout(copyStatusResetTimer.current)
      }
    }
  }, [])

  const handleCopy = async () => {
    const copied = await copyToClipboard(qrData)
    setCopyStatus(copied ? 'copied' : 'failed')
    if (copyStatusResetTimer.current) {
      clearTimeout(copyStatusResetTimer.current)
    }
    copyStatusResetTimer.current = setTimeout(() => {
      setCopyStatus('idle')
      copyStatusResetTimer.current = null
    }, 5000)
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
          <div className="flex items-start gap-2">
            <textarea
              value={qrData}
              readOnly
              rows={4}
              spellCheck={false}
              className="flex-1 min-h-[5.5rem] text-xs bg-gray-50 border border-gray-200 rounded px-3 py-2 font-mono break-all resize-y max-h-40"
            />
            <button
              type="button"
              onClick={handleCopy}
              className="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded border border-gray-200 transition-colors"
            >
              {copyStatus === 'copied' ? 'Copied!' : copyStatus === 'failed' ? 'Copy failed' : 'Copy'}
            </button>
          </div>
          <div className="min-h-5 mt-1 text-center text-sm" role="status" aria-live="polite">
            {copyStatus === 'copied' && <span className="text-green-600">Copied!</span>}
            {copyStatus === 'failed' && <span className="text-red-600">Copy failed</span>}
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
