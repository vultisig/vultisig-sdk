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

  // Chain-specific fields
  const [memo, setMemo] = useState('')
  const [psbtBase64, setPsbtBase64] = useState('')

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
      let payload: any

      // Create chain-specific transaction payloads
      switch (chain) {
        case 'Ethereum':
          payload = {
            chain: 'Ethereum',
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
          break

        case 'THORChain':
          payload = {
            chain: 'THORChain',
            transaction: {
              toAddress,
              toAmount: (parseFloat(amount) * 1e8).toString(), // Convert to RUNE units
              memo: memo || '',
              accountNumber: 0, // Will be fetched from chain
              sequence: 0, // Will be fetched from chain
              fee: 0, // Will be fetched from chain
              isDeposit: false,
              transactionType: 0,
            },
          }
          break

        case 'Solana':
          payload = {
            chain: 'Solana',
            transaction: {
              toAddress,
              toAmount: (parseFloat(amount) * 1e9).toString(), // Convert to lamports
              memo: memo || '',
              recentBlockHash: '', // Will be fetched from chain
              priorityFee: '0', // Will be calculated
              fromTokenAssociatedAddress: '',
              toTokenAssociatedAddress: '',
              programId: false,
            },
          }
          break

        case 'Bitcoin':
          if (!psbtBase64) {
            setError('PSBT Base64 is required for Bitcoin transactions')
            return
          }
          payload = {
            chain: 'Bitcoin',
            transaction: {
              psbtBase64,
            },
          }
          break

        default:
          throw new Error(`Unsupported chain: ${chain}`)
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
    setMemo('')
    setPsbtBase64('')
    setResult(null)
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
            <option value="THORChain">THORChain</option>
            <option value="Solana">Solana</option>
            <option value="Bitcoin">Bitcoin</option>
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
            Amount (
            {chain === 'Ethereum'
              ? 'ETH'
              : chain === 'THORChain'
                ? 'RUNE'
                : chain === 'Solana'
                  ? 'SOL'
                  : chain === 'Bitcoin'
                    ? 'BTC'
                    : 'tokens'}
            )
          </label>
          <input
            type="text"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="0.001"
            className="w-full p-2 border rounded"
          />
        </div>

        {/* Chain-specific fields */}
        {(chain === 'THORChain' || chain === 'Solana') && (
          <div>
            <label className="block text-sm font-medium mb-2" htmlFor="memo">
              Memo (optional)
            </label>
            <input
              type="text"
              value={memo}
              onChange={e => setMemo(e.target.value)}
              placeholder="Transaction memo"
              className="w-full p-2 border rounded"
            />
          </div>
        )}

        {chain === 'Bitcoin' && (
          <div>
            <label className="block text-sm font-medium mb-2" htmlFor="psbt">
              PSBT Base64
            </label>
            <textarea
              value={psbtBase64}
              onChange={e => setPsbtBase64(e.target.value)}
              placeholder="Paste your PSBT in Base64 format here (from external tools like Bitcoin Core, Electrum, etc.)"
              className="w-full p-2 border rounded h-20"
            />
            <p className="text-xs text-gray-600 mt-1">
              Bitcoin transactions require a Partially Signed Bitcoin
              Transaction (PSBT) in Base64 format.
            </p>
          </div>
        )}

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
            <p className="font-bold text-lg mb-2">
              ✅ Transaction Signed Successfully!
            </p>

            <div className="space-y-2">
              <div>
                <p className="font-semibold">Signature Format:</p>
                <p className="text-sm">{result.format || 'Unknown'}</p>
              </div>

              {result.signature && (
                <div>
                  <p className="font-semibold">Signature:</p>
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
      </div>
    </div>
  )
}
