import type { Chain, Token, VaultBase } from '@vultisig/sdk'
import { useState } from 'react'

import Button from '@/components/common/Button'
import Input from '@/components/common/Input'
import Select from '@/components/common/Select'
import { TokenSelector } from '@/components/token'

type VaultSendProps = {
  vault: VaultBase
}

export default function VaultSend({ vault }: VaultSendProps) {
  const chains = vault.chains

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

  // Get tokens for selected chain (used for coin info lookup)
  const selectedChainTokens = formData.chain ? vault.getTokens(formData.chain as Chain) : []

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setResult(null)
    setProgress(null)
    setIsLoading(true)

    try {
      const chain = formData.chain as Chain

      // Subscribe to signing progress
      const handleProgress = ({ step }: { step: { message: string; progress: number } }) => {
        setProgress(`${step.message} (${step.progress}%)`)
      }
      vault.on('signingProgress', handleProgress)

      // Get address for the chain
      const address = await vault.address(chain)
      setProgress('Preparing transaction...')

      // Determine token info
      let tokenInfo: Token | undefined
      if (formData.tokenId) {
        tokenInfo = selectedChainTokens.find((t: Token) => t.id === formData.tokenId)
      }

      // Create coin object
      const coin = {
        chain,
        address,
        decimals: tokenInfo?.decimals ?? getChainDecimals(chain),
        ticker: tokenInfo?.symbol ?? chain.toString(),
        id: tokenInfo?.id,
      }

      // Parse amount
      const decimals = coin.decimals
      const amountParts = formData.amount.split('.')
      const wholePart = amountParts[0] || '0'
      const fractionalPart = (amountParts[1] || '').padEnd(decimals, '0').slice(0, decimals)
      const amountBigInt = BigInt(wholePart + fractionalPart)

      // Prepare transaction (creates KeysignPayload)
      setProgress('Building transaction...')
      const keysignPayload = await vault.prepareSendTx({
        coin,
        receiver: formData.recipient,
        amount: amountBigInt,
        memo: formData.memo || undefined,
      })

      // Extract message hashes from the keysign payload
      setProgress('Extracting message hashes...')
      const messageHashes = await vault.extractMessageHashes(keysignPayload)

      // Create signing payload
      const signingPayload = {
        transaction: keysignPayload,
        chain,
        messageHashes,
      }

      // Sign transaction
      setProgress('Signing transaction...')
      const signature = await vault.sign(signingPayload)

      // Broadcast transaction
      setProgress('Broadcasting transaction...')
      const txHash = await vault.broadcastTx({
        chain,
        keysignPayload,
        signature,
      })

      // Get explorer URL
      const { Vultisig } = await import('@vultisig/sdk')
      const explorerUrl = Vultisig.getTxExplorerUrl(chain, txHash)

      vault.off('signingProgress', handleProgress)

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
      setError(err instanceof Error ? err.message : 'Failed to send transaction')
      setProgress(null)
    } finally {
      setIsLoading(false)
    }
  }

  const chainOptions = chains.map((chain: Chain) => ({
    value: chain,
    label: chain,
  }))

  return (
    <div className="max-w-lg mx-auto">
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-6">Send Transaction</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Select
            label="Chain"
            options={chainOptions}
            value={formData.chain}
            onChange={e => setFormData(prev => ({ ...prev, chain: e.target.value as Chain, tokenId: '' }))}
            required
          />

          <TokenSelector
            chain={formData.chain as Chain}
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

          {/* Progress indicator */}
          {progress && (
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
  )
}

// Get native token decimals for common chains
function getChainDecimals(chain: Chain): number {
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
