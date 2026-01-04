import { useEffect, useRef, useState } from 'react'

import { useSDKAdapter } from '../../../adapters'
import type { CoinInfo, ProgressStep, TokenInfo, VaultInfo } from '../../../types'
import Button from '../../common/Button'
import Input from '../../common/Input'
import Select from '../../common/Select'
import SigningModal from '../../signing/SigningModal'
import { TokenSelector } from '../../token'

type SigningModalStep = 'waiting_for_qr' | 'qr_ready' | 'devices_joining' | 'signing' | 'complete'

type VaultSendProps = {
  vault: VaultInfo
}

export default function VaultSend({ vault }: VaultSendProps) {
  const sdk = useSDKAdapter()
  const chains = vault.chains
  const isSecureVault = vault.type === 'secure'

  const [formData, setFormData] = useState({
    chain: chains[0] || '',
    recipient: '',
    amount: '',
    tokenId: '', // Empty means native token
    memo: '',
  })
  const [isLoading, setIsLoading] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [result, setResult] = useState<{ txHash: string; explorerUrl?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Secure vault signing state
  const [showSigningModal, setShowSigningModal] = useState(false)
  const [signingModalStep, setSigningModalStep] = useState<SigningModalStep>('waiting_for_qr')
  const [signingQrCode, setSigningQrCode] = useState<string | null>(null)
  const [devicesJoined, setDevicesJoined] = useState(0)
  const [deviceIds, setDeviceIds] = useState<string[]>([])
  const [signingProgress, setSigningProgress] = useState<ProgressStep | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Get selected token info
  const [selectedToken, setSelectedToken] = useState<TokenInfo | null>(null)

  useEffect(() => {
    if (formData.tokenId && formData.chain) {
      sdk.getTokens(vault.id, formData.chain).then(tokens => {
        const token = tokens.find(t => t.id === formData.tokenId)
        setSelectedToken(token || null)
      })
    } else {
      setSelectedToken(null)
    }
  }, [sdk, vault.id, formData.chain, formData.tokenId])

  const resetSigningState = () => {
    setShowSigningModal(false)
    setSigningModalStep('waiting_for_qr')
    setSigningQrCode(null)
    setDevicesJoined(0)
    setDeviceIds([])
    setSigningProgress(null)
    if (abortControllerRef.current) {
      abortControllerRef.current = null
    }
  }

  const handleCancelSigning = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    resetSigningState()
    setIsLoading(false)
    setProgress(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setResult(null)
    setProgress(null)
    setIsLoading(true)

    // Reset secure vault signing state
    if (isSecureVault) {
      resetSigningState()
      setShowSigningModal(true)
      setSigningModalStep('waiting_for_qr')
      abortControllerRef.current = new AbortController()
    }

    // Subscribe to events
    const unsubProgress = sdk.onSigningProgress(step => {
      setProgress(`${step.message} (${step.progress}%)`)
      if (isSecureVault) {
        setSigningProgress(step)
      }
    })

    let unsubQr: (() => void) | null = null
    let unsubDevice: (() => void) | null = null

    if (isSecureVault) {
      unsubQr = sdk.onQrCodeReady(qrPayload => {
        setSigningQrCode(qrPayload)
        setSigningModalStep('qr_ready')
      })

      unsubDevice = sdk.onDeviceJoined(({ deviceId, totalJoined, required }) => {
        setDevicesJoined(totalJoined)
        setDeviceIds(prev => (prev.includes(deviceId) ? prev : [...prev, deviceId]))
        if (totalJoined >= required) {
          setSigningModalStep('signing')
        } else {
          setSigningModalStep('devices_joining')
        }
      })
    }

    try {
      const chain = formData.chain

      // Get address for the chain
      const address = await sdk.getAddress(vault.id, chain)
      setProgress('Preparing transaction...')

      // Create coin object
      const coin: CoinInfo = {
        chain,
        address,
        decimals: selectedToken?.decimals ?? getChainDecimals(chain),
        ticker: selectedToken?.symbol ?? chain,
        id: selectedToken?.id,
      }

      // Parse amount
      const decimals = coin.decimals
      const amountParts = formData.amount.split('.')
      const wholePart = amountParts[0] || '0'
      const fractionalPart = (amountParts[1] || '').padEnd(decimals, '0').slice(0, decimals)
      const amountBigInt = BigInt(wholePart + fractionalPart)

      // Prepare transaction (creates KeysignPayload)
      setProgress('Building transaction...')
      const keysignPayload = await sdk.prepareSendTx(vault.id, {
        coin,
        receiver: formData.recipient,
        amount: amountBigInt,
        memo: formData.memo || undefined,
      })

      // Extract message hashes from the keysign payload
      setProgress('Extracting message hashes...')
      const messageHashes = await sdk.extractMessageHashes(vault.id, keysignPayload)

      // Create signing payload
      const signingPayload = {
        transaction: keysignPayload,
        chain,
        messageHashes,
      }

      // Sign transaction
      setProgress('Signing transaction...')
      const signature = await sdk.sign(vault.id, signingPayload)

      // Broadcast transaction
      setProgress('Broadcasting transaction...')
      const txHash = await sdk.broadcastTx(vault.id, {
        chain,
        keysignPayload,
        signature,
      })

      // Get explorer URL
      const explorerUrl = await sdk.getTxExplorerUrl(chain, txHash)

      // Show success state in modal for secure vault
      if (isSecureVault) {
        setSigningModalStep('complete')
        setTimeout(() => {
          resetSigningState()
        }, 2000)
      }

      setResult({ txHash, explorerUrl })
      setProgress(null)

      // Reset form
      setFormData(prev => ({
        ...prev,
        recipient: '',
        amount: '',
        memo: '',
      }))
    } catch (err) {
      // Cleanup on error
      if (isSecureVault) {
        resetSigningState()
      }

      if (err instanceof Error && (err.message.includes('cancelled') || err.message === 'Operation aborted')) {
        // User cancelled, just reset
        setProgress(null)
        return
      }

      setError(err instanceof Error ? err.message : 'Failed to send transaction')
      setProgress(null)
    } finally {
      setIsLoading(false)
      unsubProgress()
      unsubQr?.()
      unsubDevice?.()
    }
  }

  const chainOptions = chains.map(chain => ({
    value: chain,
    label: chain,
  }))

  return (
    <>
      {/* Signing Modal for secure vaults */}
      {isSecureVault && (
        <SigningModal
          isOpen={showSigningModal}
          onClose={resetSigningState}
          onCancel={handleCancelSigning}
          qrCode={signingQrCode}
          step={signingModalStep}
          devicesJoined={devicesJoined}
          devicesRequired={vault.threshold ?? 2}
          deviceIds={deviceIds}
          signingProgress={signingProgress}
          error={error}
        />
      )}

      <div className="max-w-lg mx-auto">
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-6">
            Send Transaction
            {isSecureVault && (
              <span className="ml-2 text-xs font-normal text-blue-600 bg-blue-50 px-2 py-1 rounded">Secure Vault</span>
            )}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Select
              label="Chain"
              options={chainOptions}
              value={formData.chain}
              onChange={e => setFormData(prev => ({ ...prev, chain: e.target.value, tokenId: '' }))}
              required
            />

            <TokenSelector
              chain={formData.chain}
              vault={vault}
              value={formData.tokenId}
              onChange={tokenId => setFormData(prev => ({ ...prev, tokenId }))}
              label="Token"
            />

            <Input
              label="Recipient Address"
              value={formData.recipient}
              onChange={e => setFormData(prev => ({ ...prev, recipient: e.target.value }))}
              placeholder="Enter recipient address"
              required
            />

            <Input
              label="Amount"
              type="text"
              value={formData.amount}
              onChange={e => setFormData(prev => ({ ...prev, amount: e.target.value }))}
              placeholder="0.0"
              required
            />

            <Input
              label="Memo (Optional)"
              value={formData.memo}
              onChange={e => setFormData(prev => ({ ...prev, memo: e.target.value }))}
              placeholder="Optional message"
            />

            {/* Progress indicator (only for fast vaults - secure vaults use modal) */}
            {!isSecureVault && progress && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <div className="animate-spin h-5 w-5 border-2 border-blue-600 border-t-transparent rounded-full" />
                  <span className="text-blue-700">{progress}</span>
                </div>
              </div>
            )}

            {/* Error */}
            {error && <div className="text-error text-sm bg-red-50 p-3 rounded">{error}</div>}

            {/* Success */}
            {result && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <div className="flex items-center gap-2 text-green-700 font-medium mb-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Transaction Sent!
                </div>
                <div className="text-sm text-green-600 break-all">
                  <span className="font-medium">Hash:</span> {result.txHash}
                </div>
                {result.explorerUrl && (
                  <a
                    href={result.explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-green-700 hover:underline mt-2"
                  >
                    View on Explorer
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                      />
                    </svg>
                  </a>
                )}
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              fullWidth
              isLoading={isLoading}
              disabled={!formData.chain || !formData.recipient || !formData.amount}
            >
              Send Transaction
            </Button>
          </form>
        </div>
      </div>
    </>
  )
}

// Get native token decimals for common chains
function getChainDecimals(chain: string): number {
  const decimalsMap: Record<string, number> = {
    Bitcoin: 8,
    'Bitcoin-Cash': 8,
    Litecoin: 8,
    Dogecoin: 8,
    Dash: 8,
    Zcash: 8,
    Ethereum: 18,
    Polygon: 18,
    Avalanche: 18,
    BSC: 18,
    Arbitrum: 18,
    Optimism: 18,
    Base: 18,
    Solana: 9,
    Cosmos: 6,
    THORChain: 8,
    MayaChain: 10,
    Sui: 9,
    Ripple: 6,
  }
  return decimalsMap[chain] ?? 18
}
