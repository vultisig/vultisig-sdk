import { useState } from 'react'
import {
  type Signature,
  type TransactionReceipt,
  Vault as VaultClass,
  Vultisig,
} from 'vultisig-sdk'

type SignTransactionProps = {
  vault: VaultClass
  sdk: Vultisig
}

export function SignTransaction({ vault, sdk }: SignTransactionProps) {
  const [password, setPassword] = useState('Password123!')
  const [toAddress, setToAddress] = useState(
    '0x0b52FDD14661EF6ce2F994b06369da3A6073800b'
  )
  const [amount, setAmount] = useState('0.00001')
  const [chain, setChain] = useState('Ethereum')
  const [signing, setSigning] = useState(false)
  const [broadcasting, setBroadcasting] = useState(false)
  const [signingStatus, setSigningStatus] = useState('')
  const [broadcastStatus, setBroadcastStatus] = useState('')
  const [result, setResult] = useState<Signature | null>(null)
  const [receipt, setReceipt] = useState<TransactionReceipt | null>(null)
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
    setReceipt(null)
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

      const signature = await sdk.signTransactionWithVault(
        vault,
        payload,
        password
      )
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

  const handleBroadcast = async () => {
    if (!result || !result.compiled) {
      setError('No signed transaction to broadcast')
      return
    }

    setBroadcasting(true)
    setError(null)
    setReceipt(null)
    setBroadcastStatus('Broadcasting transaction...')

    try {
      console.log('Broadcasting transaction:', result)

      const signedTransaction = {
        signature: result.signature,
        compiled: result.compiled,
        chain,
        format: result.format,
        recovery: result.recovery,
      }

      const receipt = await sdk.broadcastTransaction(chain, signedTransaction)
      console.log('Transaction broadcast successfully:', receipt)

      setReceipt(receipt)
      setBroadcastStatus('')
    } catch (err) {
      console.error('Failed to broadcast transaction:', err)
      setError((err as Error).message)
    } finally {
      setBroadcasting(false)
      setBroadcastStatus('')
    }
  }

  const handleSignAndBroadcast = async () => {
    if (!password || !toAddress || !amount) {
      setError('Please fill in all fields')
      return
    }

    setSigning(true)
    setBroadcasting(true)
    setError(null)
    setResult(null)
    setReceipt(null)
    setSigningStatus('Signing and broadcasting transaction...')

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

      console.log('Signing and broadcasting transaction with payload:', payload)

      const receipt = await sdk.signAndBroadcast(payload, password)
      console.log('Transaction signed and broadcast successfully:', receipt)

      setReceipt(receipt)
      setSigningStatus('')
    } catch (err) {
      console.error('Failed to sign and broadcast transaction:', err)
      setError((err as Error).message)
    } finally {
      setSigning(false)
      setBroadcasting(false)
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
    setReceipt(null)
    setError(null)
  }

  // Check if this is a fast vault
  const isFastVault = vault.data.signers.some(signer =>
    signer.startsWith('Server-')
  )

  if (!isFastVault) {
    return (
      <div className="bg-yellow-100 border border-yellow-400 text-yellow-700 px-4 py-3 rounded">
        <p className="font-bold">Fast signing not available</p>
        <p>
          This vault doesn&apos;t support fast signing. Only fast vaults
          (created with VultiServer) can use this feature.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <h2 className="text-2xl font-bold mb-4">Test Fast Signing</h2>

      <div className="space-y-4">
        <div>
          <label
            className="block text-sm font-medium mb-2"
            htmlFor="chain_select"
          >
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
          <label
            className="block text-sm font-medium mb-2"
            htmlFor="to_address"
          >
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

        <div className="flex gap-2">
          <button
            onClick={handleSign}
            disabled={signing || broadcasting}
            className="flex-1 bg-blue-500 text-white p-2 rounded hover:bg-blue-600 disabled:bg-gray-400"
          >
            {signing ? 'Signing...' : 'Sign Only'}
          </button>
          <button
            onClick={handleSignAndBroadcast}
            disabled={signing || broadcasting}
            className="flex-1 bg-green-500 text-white p-2 rounded hover:bg-green-600 disabled:bg-gray-400"
          >
            {signing || broadcasting ? 'Processing...' : 'Sign & Broadcast'}
          </button>
        </div>

        {signing && signingStatus && (
          <div className="bg-blue-100 border border-blue-400 text-blue-700 px-4 py-3 rounded animate-pulse">
            <p className="font-bold">🔄 {signingStatus}</p>
            <p className="text-sm mt-1">This may take a few seconds...</p>
          </div>
        )}

        {broadcasting && broadcastStatus && (
          <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded animate-pulse">
            <p className="font-bold">📡 {broadcastStatus}</p>
            <p className="text-sm mt-1">Sending transaction to blockchain...</p>
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
            <p className="font-bold text-lg mb-2">
              ✅ Transaction Signed Successfully!
            </p>

            <div className="space-y-2">
              <div>
                <p className="font-semibold">Signature Format:</p>
                <p className="text-sm">{result.format || 'Unknown'}</p>
              </div>

              {result.compiled && (
                <div>
                  <p className="font-semibold">Transaction Hash:</p>
                  <div className="bg-white p-2 rounded border border-green-300">
                    <p className="text-xs font-mono break-all">
                      {result.compiled.hash}
                    </p>
                  </div>
                </div>
              )}

              {result.compiled?.serialized && (
                <div>
                  <p className="font-semibold">Serialized Transaction:</p>
                  <div className="bg-white p-2 rounded border border-green-300">
                    <p className="text-xs font-mono break-all">
                      {result.compiled.serialized}
                    </p>
                  </div>
                </div>
              )}

              {result.signature && (
                <div>
                  <p className="font-semibold">Raw Signature:</p>
                  <div className="bg-white p-2 rounded border border-green-300">
                    <p className="text-xs font-mono break-all">
                      {result.signature}
                    </p>
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
                {result.compiled && (
                  <button
                    onClick={handleBroadcast}
                    disabled={broadcasting}
                    className="bg-orange-500 text-white px-3 py-1 rounded text-sm hover:bg-orange-600 disabled:bg-gray-400"
                  >
                    {broadcasting ? 'Broadcasting...' : '📡 Broadcast'}
                  </button>
                )}
                <button
                  onClick={() =>
                    copyToClipboard(result.signature || JSON.stringify(result))
                  }
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
                <summary className="cursor-pointer text-sm font-semibold">
                  View Raw Response
                </summary>
                <pre className="mt-2 text-xs bg-white p-2 rounded overflow-x-auto">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </details>
            </div>
          </div>
        )}

        {receipt && (
          <div className="bg-blue-100 border border-blue-400 text-blue-700 px-4 py-3 rounded">
            <p className="font-bold text-lg mb-2">
              📡 Transaction Broadcast Successfully!
            </p>

            <div className="space-y-2">
              <div>
                <p className="font-semibold">Transaction Hash:</p>
                <div className="bg-white p-2 rounded border border-blue-300">
                  <p className="text-xs font-mono break-all">{receipt.hash}</p>
                </div>
              </div>

              <div>
                <p className="font-semibold">Status:</p>
                <p className="text-sm">
                  <span
                    className={`px-2 py-1 rounded text-xs font-semibold ${
                      receipt.status === 'confirmed'
                        ? 'bg-green-200 text-green-800'
                        : receipt.status === 'pending'
                          ? 'bg-yellow-200 text-yellow-800'
                          : 'bg-red-200 text-red-800'
                    }`}
                  >
                    {receipt.status.toUpperCase()}
                  </span>
                </p>
              </div>

              {receipt.blockNumber && (
                <div>
                  <p className="font-semibold">Block Number:</p>
                  <p className="text-sm">{receipt.blockNumber}</p>
                </div>
              )}

              {receipt.confirmations && (
                <div>
                  <p className="font-semibold">Confirmations:</p>
                  <p className="text-sm">{receipt.confirmations}</p>
                </div>
              )}

              {receipt.gasUsed && (
                <div>
                  <p className="font-semibold">Gas Used:</p>
                  <p className="text-sm">{receipt.gasUsed}</p>
                </div>
              )}

              {receipt.explorerUrl && (
                <div>
                  <p className="font-semibold">Explorer:</p>
                  <a
                    href={receipt.explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800 underline text-sm"
                  >
                    🔗 View on Explorer
                  </a>
                </div>
              )}

              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => copyToClipboard(receipt.hash)}
                  className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700"
                >
                  {copied ? '✓ Copied!' : '📋 Copy Hash'}
                </button>
                <button
                  onClick={resetForm}
                  className="bg-gray-600 text-white px-3 py-1 rounded text-sm hover:bg-gray-700"
                >
                  🔄 New Transaction
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
