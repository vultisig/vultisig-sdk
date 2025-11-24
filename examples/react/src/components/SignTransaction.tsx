import { useState } from 'react'
import { Vault as VaultClass, Vultisig } from 'vultisig-sdk'

type SignTransactionProps = {
  vault: VaultClass
  sdk: Vultisig
}

export function SignTransaction({ vault, sdk }: SignTransactionProps) {
  const [password, setPassword] = useState('')
  const [toAddress, setToAddress] = useState('')
  const [amount, setAmount] = useState('')
  const [chain, setChain] = useState('Ethereum')
  const [signing, setSigning] = useState(false)
  const [signingStatus, setSigningStatus] = useState('')
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const handleSign = async () => {
    if (!password || !toAddress || !amount) {
      setError('Please fill in all fields')
      return
    }

    setSigning(true)
    setError(null)
    setResult(null)
    setSigningStatus('Preparing transaction...')

    try {
      // Create a simple Ethereum transaction payload for testing
      const payload = {
        chain,
        transaction: {
          to: toAddress,
          value: (parseFloat(amount) * 1e18).toString(), // Convert ETH to wei
          data: '0x',
          chainId: 1, // Mainnet
          nonce: 0,
          gasLimit: '21000',
          maxFeePerGas: '20000000000', // 20 gwei
          maxPriorityFeePerGas: '1500000000', // 1.5 gwei
        },
      }

      console.log('Signing transaction with payload:', payload)
      setSigningStatus('Connecting to VultiServer...')

      const signature = await sdk.signTransactionWithVault(vault, payload, password)
      console.log('Transaction signed successfully:', signature)

      setResult(signature)
      setSigningStatus('')
    } catch (err) {
      console.error('Failed to sign transaction:', err)
      setError((err as Error).message)
    } finally {
      setSigning(false)
      setSigningStatus('')
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const resetForm = () => {
    setToAddress('')
    setAmount('')
    setPassword('')
    setResult(null)
    setError(null)
  }

  // Check if this is a fast vault
  const isFastVault = vault.data.signers.some(signer => signer.startsWith('Server-'))

  if (!isFastVault) {
    return (
      <div className="bg-yellow-100 border border-yellow-400 text-yellow-700 px-4 py-3 rounded">
        <p className="font-bold">Fast signing not available</p>
        <p>
          This vault doesn&apos;t support fast signing. Only fast vaults (created with VultiServer) can use this
          feature.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <h2 className="text-2xl font-bold mb-4">Test Fast Signing</h2>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2" htmlFor="chain_select">
            Chain
          </label>
          <select
            id="chain_select"
            value={chain}
            onChange={e => setChain(e.target.value)}
            className="w-full p-2 border rounded"
          >
            <option value="Ethereum">Ethereum</option>
            <option value="Bitcoin">Bitcoin (not yet supported)</option>
            <option value="Solana">Solana (not yet supported)</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2" htmlFor="to_address">
            To Address
          </label>
          <input
            type="text"
            value={toAddress}
            onChange={e => setToAddress(e.target.value)}
            placeholder="0x..."
            className="w-full p-2 border rounded"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2" htmlFor="amount">
            Amount (ETH)
          </label>
          <input
            type="text"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="0.001"
            className="w-full p-2 border rounded"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2" htmlFor="password">
            Vault Password
          </label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Enter vault password"
            className="w-full p-2 border rounded"
          />
        </div>

        <button
          onClick={handleSign}
          disabled={signing}
          className="w-full bg-blue-500 text-white p-2 rounded hover:bg-blue-600 disabled:bg-gray-400"
        >
          {signing ? 'Signing...' : 'Sign Transaction'}
        </button>

        {signing && signingStatus && (
          <div className="bg-blue-100 border border-blue-400 text-blue-700 px-4 py-3 rounded animate-pulse">
            <p className="font-bold">🔄 {signingStatus}</p>
            <p className="text-sm mt-1">This may take a few seconds...</p>
          </div>
        )}

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
            <p className="font-bold">Error</p>
            <p>{error}</p>
          </div>
        )}

        {result && (
          <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded">
            <p className="font-bold text-lg mb-2">✅ Transaction Signed Successfully!</p>

            <div className="space-y-2">
              <div>
                <p className="font-semibold">Signature Format:</p>
                <p className="text-sm">{result.format || 'Unknown'}</p>
              </div>

              {result.signature && (
                <div>
                  <p className="font-semibold">Signature:</p>
                  <div className="bg-white p-2 rounded border border-green-300">
                    <p className="text-xs font-mono break-all">{result.signature}</p>
                  </div>
                </div>
              )}

              {result.recovery !== undefined && (
                <div>
                  <p className="font-semibold">Recovery ID:</p>
                  <p className="text-sm">{result.recovery}</p>
                </div>
              )}

              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => copyToClipboard(result.signature || JSON.stringify(result))}
                  className="bg-green-600 text-white px-3 py-1 rounded text-sm hover:bg-green-700"
                >
                  {copied ? '✓ Copied!' : '📋 Copy Signature'}
                </button>
                <button
                  onClick={resetForm}
                  className="bg-gray-600 text-white px-3 py-1 rounded text-sm hover:bg-gray-700"
                >
                  🔄 Sign Another
                </button>
              </div>

              <details className="mt-2">
                <summary className="cursor-pointer text-sm font-semibold">View Raw Response</summary>
                <pre className="mt-2 text-xs bg-white p-2 rounded overflow-x-auto">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </details>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
