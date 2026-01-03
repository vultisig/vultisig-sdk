import { useEffect, useRef, useState } from 'react'

import { useSDKAdapter } from '../../../adapters'
import type { CoinInfo, FiatCurrency, ProgressStep, SwapQuoteResult, TokenInfo, VaultInfo } from '../../../types'
import Button from '../../common/Button'
import Input from '../../common/Input'
import Select from '../../common/Select'
import Spinner from '../../common/Spinner'
import SigningModal from '../../signing/SigningModal'
import { TokenSelector } from '../../token'

type SigningModalStep = 'waiting_for_qr' | 'qr_ready' | 'devices_joining' | 'signing' | 'complete'

type VaultSwapProps = {
  vault: VaultInfo
}

type DisplayQuote = {
  expectedOutput: string
  expectedOutputFiat?: number
  fee: string
  feeFiat?: number
  provider?: string
  raw: SwapQuoteResult
}

export default function VaultSwap({ vault }: VaultSwapProps) {
  const sdk = useSDKAdapter()
  const isSecureVault = vault.type === 'secure'

  const [supportedChains, setSupportedChains] = useState<string[]>([])
  const [isLoadingChains, setIsLoadingChains] = useState(true)

  const [formData, setFormData] = useState({
    fromChain: '' as string,
    toChain: '' as string,
    fromTokenId: '',
    toTokenId: '',
    amount: '',
    slippage: '1',
  })

  const [quote, setQuote] = useState<DisplayQuote | null>(null)
  const [isLoadingQuote, setIsLoadingQuote] = useState(false)
  const [isSwapping, setIsSwapping] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [result, setResult] = useState<{ txHash: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Secure vault signing state
  const [showSigningModal, setShowSigningModal] = useState(false)
  const [signingModalStep, setSigningModalStep] = useState<SigningModalStep>('waiting_for_qr')
  const [signingQrCode, setSigningQrCode] = useState<string | null>(null)
  const [devicesJoined, setDevicesJoined] = useState(0)
  const [deviceIds, setDeviceIds] = useState<string[]>([])
  const [signingProgress, setSigningProgress] = useState<ProgressStep | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Load supported swap chains
  useEffect(() => {
    const loadSupportedChains = async () => {
      setIsLoadingChains(true)
      try {
        const chains = await sdk.getSupportedSwapChains(vault.id)
        setSupportedChains(chains)
        // Filter to only chains that are in the vault
        const available = chains.filter(chain => vault.chains.includes(chain))
        if (available.length > 0) {
          setFormData(prev => ({
            ...prev,
            fromChain: available[0],
            toChain: available.length > 1 ? available[1] : available[0],
          }))
        }
      } catch (err) {
        console.error('Failed to load supported chains:', err)
        setError('Failed to load supported swap chains')
      } finally {
        setIsLoadingChains(false)
      }
    }

    loadSupportedChains()
  }, [sdk, vault.id, vault.chains])

  // Get tokens for selected chains
  const [fromTokens, setFromTokens] = useState<TokenInfo[]>([])
  const [toTokens, setToTokens] = useState<TokenInfo[]>([])

  useEffect(() => {
    if (formData.fromChain) {
      sdk
        .getTokens(vault.id, formData.fromChain)
        .then(setFromTokens)
        .catch(() => setFromTokens([]))
    } else {
      setFromTokens([])
    }
  }, [sdk, vault.id, formData.fromChain])

  useEffect(() => {
    if (formData.toChain) {
      sdk
        .getTokens(vault.id, formData.toChain)
        .then(setToTokens)
        .catch(() => setToTokens([]))
    } else {
      setToTokens([])
    }
  }, [sdk, vault.id, formData.toChain])

  // Filter chains to only those in vault
  const availableChains = supportedChains.filter(chain => vault.chains.includes(chain))

  const chainOptions = availableChains.map(chain => ({
    value: chain,
    label: chain,
  }))

  // Get quote
  const handleGetQuote = async () => {
    if (!formData.fromChain || !formData.toChain || !formData.amount) {
      setError('Please fill in all required fields')
      return
    }

    setIsLoadingQuote(true)
    setError(null)
    setQuote(null)

    try {
      // Check if swap is supported
      const isSupported = await sdk.isSwapSupported(vault.id, formData.fromChain, formData.toChain)
      if (!isSupported) {
        throw new Error(`Swap from ${formData.fromChain} to ${formData.toChain} is not supported`)
      }

      const fromAddress = await sdk.getAddress(vault.id, formData.fromChain)
      const toAddress = await sdk.getAddress(vault.id, formData.toChain)

      // Get token info
      const fromToken = formData.fromTokenId ? fromTokens.find(t => t.id === formData.fromTokenId) : undefined
      const toToken = formData.toTokenId ? toTokens.find(t => t.id === formData.toTokenId) : undefined

      const fromCoin: CoinInfo = {
        chain: formData.fromChain,
        address: fromAddress,
        decimals: fromToken?.decimals ?? getChainDecimals(formData.fromChain),
        ticker: fromToken?.symbol ?? formData.fromChain,
        id: fromToken?.id,
      }

      const toCoin: CoinInfo = {
        chain: formData.toChain,
        address: toAddress,
        decimals: toToken?.decimals ?? getChainDecimals(formData.toChain),
        ticker: toToken?.symbol ?? formData.toChain,
        id: toToken?.id,
      }

      // Parse amount as human-readable number
      const amount = parseFloat(formData.amount)
      if (isNaN(amount) || amount <= 0) {
        throw new Error('Invalid amount')
      }

      const currency: FiatCurrency = 'usd'
      const quoteResult = await sdk.getSwapQuote(vault.id, {
        fromCoin,
        toCoin,
        amount,
        fiatCurrency: currency,
      })

      setQuote({
        expectedOutput: formatAmount(quoteResult.estimatedOutput, toCoin.decimals),
        expectedOutputFiat: quoteResult.estimatedOutputFiat,
        fee: formatAmount(quoteResult.fees.total, fromCoin.decimals),
        feeFiat: quoteResult.feesFiat?.total,
        provider: quoteResult.provider,
        raw: quoteResult,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get quote')
    } finally {
      setIsLoadingQuote(false)
    }
  }

  // Secure vault signing helpers
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
    setIsSwapping(false)
    setProgress(null)
  }

  // Execute swap
  const handleSwap = async () => {
    if (!quote || !formData.fromChain || !formData.toChain || !formData.amount) {
      setError('Please get a quote first')
      return
    }

    setIsSwapping(true)
    setProgress(null)
    setResult(null)
    setError(null)

    // Reset secure vault signing state
    if (isSecureVault) {
      resetSigningState()
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
      const fromAddress = await sdk.getAddress(vault.id, formData.fromChain)
      const toAddress = await sdk.getAddress(vault.id, formData.toChain)

      // Get token info
      const fromToken = formData.fromTokenId ? fromTokens.find(t => t.id === formData.fromTokenId) : undefined
      const toToken = formData.toTokenId ? toTokens.find(t => t.id === formData.toTokenId) : undefined

      const fromCoin: CoinInfo = {
        chain: formData.fromChain,
        address: fromAddress,
        decimals: fromToken?.decimals ?? getChainDecimals(formData.fromChain),
        ticker: fromToken?.symbol ?? formData.fromChain,
        id: fromToken?.id,
      }

      const toCoin: CoinInfo = {
        chain: formData.toChain,
        address: toAddress,
        decimals: toToken?.decimals ?? getChainDecimals(formData.toChain),
        ticker: toToken?.symbol ?? formData.toChain,
        id: toToken?.id,
      }

      // Parse amount as human-readable number
      const amount = parseFloat(formData.amount)
      if (isNaN(amount) || amount <= 0) {
        throw new Error('Invalid amount')
      }

      setProgress('Preparing swap transaction...')

      // Prepare swap transaction
      const swapResult = await sdk.prepareSwapTx(vault.id, {
        fromCoin,
        toCoin,
        amount,
        swapQuote: quote.raw,
        autoApprove: false,
      })

      // Handle approval if needed
      if (swapResult.approvalPayload) {
        if (isSecureVault) {
          setShowSigningModal(true)
          setSigningModalStep('waiting_for_qr')
          setDevicesJoined(0)
          setDeviceIds([])
        }

        setProgress('Signing approval transaction...')
        const approvalHashes = await sdk.extractMessageHashes(vault.id, swapResult.approvalPayload)
        const approvalSig = await sdk.sign(vault.id, {
          transaction: swapResult.approvalPayload,
          chain: formData.fromChain,
          messageHashes: approvalHashes,
        })

        setProgress('Broadcasting approval...')
        await sdk.broadcastTx(vault.id, {
          chain: formData.fromChain,
          keysignPayload: swapResult.approvalPayload,
          signature: approvalSig,
        })

        // Wait a bit for approval to be mined
        setProgress('Waiting for approval confirmation...')
        await new Promise(resolve => setTimeout(resolve, 5000))

        // Reset for swap signing
        if (isSecureVault) {
          setDevicesJoined(0)
          setDeviceIds([])
          setSigningQrCode(null)
          setSigningModalStep('waiting_for_qr')
        }
      }

      // Sign and broadcast main swap transaction
      if (isSecureVault) {
        setShowSigningModal(true)
        setSigningModalStep('waiting_for_qr')
      }

      setProgress('Signing swap transaction...')
      const swapHashes = await sdk.extractMessageHashes(vault.id, swapResult.keysignPayload)
      const swapSig = await sdk.sign(vault.id, {
        transaction: swapResult.keysignPayload,
        chain: formData.fromChain,
        messageHashes: swapHashes,
      })

      setProgress('Broadcasting swap...')
      const txHash = await sdk.broadcastTx(vault.id, {
        chain: formData.fromChain,
        keysignPayload: swapResult.keysignPayload,
        signature: swapSig,
      })

      // Show success state in modal for secure vault
      if (isSecureVault) {
        setSigningModalStep('complete')
        setTimeout(() => {
          resetSigningState()
        }, 2000)
      }

      setResult({ txHash })
      setProgress(null)
      setQuote(null)

      // Reset form
      setFormData(prev => ({ ...prev, amount: '' }))
    } catch (err) {
      // Cleanup on error
      if (isSecureVault) {
        resetSigningState()
      }

      if (err instanceof Error && (err.message.includes('cancelled') || err.message === 'Operation aborted')) {
        setProgress(null)
        return
      }

      setError(err instanceof Error ? err.message : 'Failed to execute swap')
      setProgress(null)
    } finally {
      setIsSwapping(false)
      unsubProgress()
      unsubQr?.()
      unsubDevice?.()
    }
  }

  if (isLoadingChains) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner size="large" />
      </div>
    )
  }

  if (availableChains.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
          <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
            />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">No Swap Chains Available</h3>
        <p className="text-gray-500">Add swap-supported chains to your vault to use swaps.</p>
      </div>
    )
  }

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
            Swap Tokens
            {isSecureVault && (
              <span className="ml-2 text-xs font-normal text-blue-600 bg-blue-50 px-2 py-1 rounded">Secure Vault</span>
            )}
          </h2>

          <div className="space-y-4">
            {/* From */}
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="text-sm text-gray-500 mb-2">From</div>
              <div className="grid grid-cols-2 gap-3">
                <Select
                  options={chainOptions}
                  value={formData.fromChain}
                  onChange={e =>
                    setFormData(prev => ({
                      ...prev,
                      fromChain: e.target.value,
                      fromTokenId: '',
                    }))
                  }
                />
                <TokenSelector
                  chain={formData.fromChain}
                  vault={vault}
                  value={formData.fromTokenId}
                  onChange={tokenId => setFormData(prev => ({ ...prev, fromTokenId: tokenId }))}
                />
              </div>
              <Input
                value={formData.amount}
                onChange={e => setFormData(prev => ({ ...prev, amount: e.target.value }))}
                placeholder="0.0"
                className="mt-3"
              />
            </div>

            {/* Swap arrow */}
            <div className="flex justify-center">
              <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
              </div>
            </div>

            {/* To */}
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="text-sm text-gray-500 mb-2">To</div>
              <div className="grid grid-cols-2 gap-3">
                <Select
                  options={chainOptions}
                  value={formData.toChain}
                  onChange={e =>
                    setFormData(prev => ({
                      ...prev,
                      toChain: e.target.value,
                      toTokenId: '',
                    }))
                  }
                />
                <TokenSelector
                  chain={formData.toChain}
                  vault={vault}
                  value={formData.toTokenId}
                  onChange={tokenId => setFormData(prev => ({ ...prev, toTokenId: tokenId }))}
                />
              </div>
              {quote && (
                <div className="mt-3 p-3 bg-white rounded border border-gray-200">
                  <div className="text-2xl font-mono font-bold text-gray-900">{quote.expectedOutput}</div>
                  {quote.expectedOutputFiat !== undefined && (
                    <div className="text-sm text-gray-500">~${quote.expectedOutputFiat.toFixed(2)}</div>
                  )}
                </div>
              )}
            </div>

            {/* Quote details */}
            {quote && (
              <div className="bg-blue-50 rounded-lg p-4 text-sm">
                <div className="flex justify-between mb-1">
                  <span className="text-gray-600">Network fee</span>
                  <span className="font-medium">
                    {quote.feeFiat !== undefined ? `$${quote.feeFiat.toFixed(2)}` : quote.fee}
                  </span>
                </div>
                {quote.provider && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Provider</span>
                    <span className="font-medium">{quote.provider}</span>
                  </div>
                )}
              </div>
            )}

            {/* Slippage */}
            <div>
              <span className="text-sm text-gray-600 mb-1 block">Slippage Tolerance</span>
              <div className="flex gap-2">
                {['0.5', '1', '2', '3'].map(slippage => (
                  <button
                    key={slippage}
                    type="button"
                    className={`px-3 py-1 rounded text-sm ${
                      formData.slippage === slippage
                        ? 'bg-primary text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                    onClick={() => setFormData(prev => ({ ...prev, slippage }))}
                  >
                    {slippage}%
                  </button>
                ))}
              </div>
            </div>

            {/* Progress (only for fast vaults - secure vaults use modal) */}
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
                  Swap Submitted!
                </div>
                <div className="text-sm text-green-600 break-all">
                  <span className="font-medium">Hash:</span> {result.txHash}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <Button
                variant="secondary"
                fullWidth
                onClick={handleGetQuote}
                isLoading={isLoadingQuote}
                disabled={!formData.fromChain || !formData.toChain || !formData.amount || isSwapping}
              >
                Get Quote
              </Button>
              <Button variant="primary" fullWidth onClick={handleSwap} isLoading={isSwapping} disabled={!quote}>
                Swap
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

// Format amount with decimals
function formatAmount(amount: string | bigint, decimals: number): string {
  const amountStr = typeof amount === 'bigint' ? amount.toString() : amount
  if (amountStr === '0') return '0'

  const amountBig = BigInt(amountStr)
  const divisor = BigInt(10 ** decimals)
  const wholePart = amountBig / divisor
  const fractionalPart = amountBig % divisor

  if (fractionalPart === BigInt(0)) {
    return wholePart.toString()
  }

  let fractionalStr = fractionalPart.toString().padStart(decimals, '0')
  fractionalStr = fractionalStr.replace(/0+$/, '').slice(0, 6)

  return `${wholePart}.${fractionalStr}`
}

// Get native token decimals
function getChainDecimals(chain: string): number {
  const decimalsMap: Record<string, number> = {
    Bitcoin: 8,
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
  }
  return decimalsMap[chain] ?? 18
}
