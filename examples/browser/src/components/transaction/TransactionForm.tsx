import type { Chain, VaultBase } from '@vultisig/sdk'
import { useState } from 'react'

import Button from '@/components/common/Button'
import Input from '@/components/common/Input'
import Select from '@/components/common/Select'

type TransactionFormProps = {
  vault: VaultBase
}

export default function TransactionForm({ vault }: TransactionFormProps) {
  const chains = vault.chains

  const [formData, setFormData] = useState({
    chain: chains[0] || '',
    recipient: '',
    amount: '',
    memo: '',
  })
  const [isLoading, setIsLoading] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setResult(null)
    setIsLoading(true)

    try {
      const chain = formData.chain as Chain

      // Get address for the chain
      const address = await vault.address(chain)

      // Create coin object
      const coin = {
        chain,
        address,
        decimals: 18, // This should be chain-specific
        ticker: chain.toString(),
      }

      // Prepare transaction (creates KeysignPayload)
      const keysignPayload = await vault.prepareSendTx({
        coin,
        receiver: formData.recipient,
        amount: BigInt(formData.amount),
        memo: formData.memo || undefined,
      })

      // Extract message hashes from the keysign payload
      const messageHashes = await vault.extractMessageHashes(keysignPayload)

      // Create signing payload
      const signingPayload = {
        transaction: keysignPayload,
        chain,
        messageHashes,
      }

      // Sign transaction
      const signature = await vault.sign(signingPayload)

      // Broadcast transaction
      const txHash = await vault.broadcastTx({
        chain,
        keysignPayload,
        signature,
      })

      setResult(`Transaction broadcast! Hash: ${txHash}`)

      // Reset form
      setFormData({
        chain: chains[0] || '',
        recipient: '',
        amount: '',
        memo: '',
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send transaction')
    } finally {
      setIsLoading(false)
    }
  }

  const chainOptions = chains.map((chain: Chain) => ({
    value: chain,
    label: chain,
  }))

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <h3 className="text-lg font-semibold mb-4">Send Transaction</h3>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Select
          label="Chain"
          options={chainOptions}
          value={formData.chain}
          onChange={e => setFormData(prev => ({ ...prev, chain: e.target.value }))}
          required
        />

        <Input
          label="Recipient Address"
          value={formData.recipient}
          onChange={e => setFormData(prev => ({ ...prev, recipient: e.target.value }))}
          placeholder="0x..."
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
          placeholder="Optional memo"
        />

        {error && <div className="text-error text-sm bg-red-50 p-3 rounded">{error}</div>}
        {result && <div className="text-success text-sm bg-green-50 p-3 rounded">{result}</div>}

        <Button type="submit" variant="primary" fullWidth isLoading={isLoading}>
          Send Transaction
        </Button>
      </form>
    </div>
  )
}
