import type { WalletCore } from '@trustwallet/wallet-core'
import { useState } from 'react'
import { Vault } from 'vultisig-sdk'

type VaultData = any

type DirectTestResult = {
  success: boolean
  address?: string
  error?: string
  duration: number
  cached: boolean
}

export const VaultDirectTester = ({
  vaultData,
  walletCore,
}: {
  vaultData: VaultData
  walletCore: WalletCore
}) => {
  const [chain, setChain] = useState('bitcoin')
  const [results, setResults] = useState<DirectTestResult[]>([])
  const [loading, setLoading] = useState(false)

  const supportedChains = [
    'bitcoin',
    'ethereum',
    'thorchain',
    'litecoin',
    'solana',
  ]

  const testDirectVaultMethod = async () => {
    if (!walletCore) {
      setResults([
        {
          success: false,
          error: 'WalletCore not available',
          duration: 0,
          cached: false,
        },
      ])
      return
    }

    setLoading(true)
    setResults([])

    const startTime = performance.now()

    try {
      // Create a Vault instance with WalletCore
      const vault = new Vault(vaultData, walletCore)

      console.log('Testing direct Vault.address method...')

      // Test the address(chain: string) method
      const address = await vault.address(chain)

      const duration = performance.now() - startTime

      setResults([
        {
          success: true,
          address,
          duration,
          cached: false, // Would need to check vault's cache
        },
      ])

      console.log(`✅ Direct vault method successful: ${address}`)
    } catch (error) {
      const duration = performance.now() - startTime
      setResults([
        {
          success: false,
          error: (error as Error).message,
          duration,
          cached: false,
        },
      ])

      console.error('❌ Direct vault method failed:', error)
    } finally {
      setLoading(false)
    }
  }

  const testErrorCases = async () => {
    if (!walletCore) {
      setResults([
        {
          success: false,
          error: 'WalletCore not available',
          duration: 0,
          cached: false,
        },
      ])
      return
    }

    setLoading(true)
    setResults([])

    const vault = new Vault(vaultData, walletCore)
    const errorResults: DirectTestResult[] = []

    // Test unsupported chain
    try {
      console.log('Testing unsupported chain...')
      const startTime = performance.now()
      await vault.address('unsupported-chain')
      const duration = performance.now() - startTime
      errorResults.push({
        success: false,
        error: 'Should have failed for unsupported chain',
        duration,
        cached: false,
      })
    } catch (error) {
      const duration = performance.now() - startTime
      errorResults.push({
        success: true,
        error: (error as Error).message,
        duration,
        cached: false,
      })
    }

    // Test empty chain
    try {
      console.log('Testing empty chain...')
      const startTime = performance.now()
      await vault.address('')
      const duration = performance.now() - startTime
      errorResults.push({
        success: false,
        error: 'Should have failed for empty chain',
        duration,
        cached: false,
      })
    } catch (error) {
      const duration = performance.now() - startTime
      errorResults.push({
        success: true,
        error: (error as Error).message,
        duration,
        cached: false,
      })
    }

    setResults(errorResults)
    setLoading(false)
  }

  return (
    <div
      style={{
        marginTop: 16,
        border: '1px solid #17a2b8',
        borderRadius: 8,
        padding: 16,
        backgroundColor: '#d1ecf1',
      }}
    >
      <h3 style={{ marginTop: 0, color: '#0c5460' }}>
        🔧 Direct Vault Method Tester
      </h3>
      <p style={{ color: '#0c5460', fontSize: '14px', marginBottom: 16 }}>
        Test the Vault.address(chain: string) method directly
      </p>

      <div
        style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}
      >
        <select
          value={chain}
          onChange={e => setChain(e.target.value)}
          style={{
            padding: '8px 12px',
            border: '1px solid #ced4da',
            borderRadius: 4,
            minWidth: 120,
          }}
        >
          {supportedChains.map(chainName => (
            <option key={chainName} value={chainName}>
              {chainName}
            </option>
          ))}
        </select>

        <button
          onClick={testDirectVaultMethod}
          disabled={loading || !walletCore}
          style={{
            padding: '8px 16px',
            backgroundColor: '#17a2b8',
            color: 'white',
            border: 'none',
            borderRadius: 4,
            cursor: loading || !walletCore ? 'not-allowed' : 'pointer',
            opacity: loading || !walletCore ? 0.6 : 1,
          }}
        >
          {loading ? 'Testing...' : 'Test Direct Method'}
        </button>

        <button
          onClick={testErrorCases}
          disabled={loading || !walletCore}
          style={{
            padding: '8px 16px',
            backgroundColor: '#ffc107',
            color: '#212529',
            border: 'none',
            borderRadius: 4,
            cursor: loading || !walletCore ? 'not-allowed' : 'pointer',
            opacity: loading || !walletCore ? 0.6 : 1,
          }}
        >
          Test Error Cases
        </button>
      </div>

      {!walletCore && (
        <div
          style={{
            backgroundColor: '#fff3cd',
            color: '#856404',
            padding: 12,
            borderRadius: 4,
            marginBottom: 16,
            border: '1px solid #ffeaa7',
          }}
        >
          <strong>Warning:</strong> WalletCore not available. This component
          requires direct access to WalletCore instance.
        </div>
      )}

      {results.length > 0 && (
        <div>
          <h4 style={{ marginBottom: 8, color: '#0c5460' }}>
            Direct Test Results:
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {results.map((result, index) => (
              <div
                key={index}
                style={{
                  backgroundColor: result.success ? '#d4edda' : '#f8d7da',
                  border: `1px solid ${result.success ? '#c3e6cb' : '#f5c6cb'}`,
                  borderRadius: 4,
                  padding: 12,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <strong
                      style={{ color: result.success ? '#155724' : '#721c24' }}
                    >
                      {result.success ? '✅ SUCCESS' : '❌ ERROR'}
                    </strong>
                  </div>
                  <div style={{ fontSize: '12px', color: '#666' }}>
                    {result.duration.toFixed(2)}ms
                  </div>
                </div>

                {result.address && (
                  <div
                    style={{
                      marginTop: 8,
                      fontFamily: 'monospace',
                      fontSize: '12px',
                      wordBreak: 'break-all',
                      backgroundColor: '#f8f9fa',
                      padding: 8,
                      borderRadius: 4,
                    }}
                  >
                    {result.address}
                  </div>
                )}

                {result.error && (
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: '12px',
                      color: '#721c24',
                      backgroundColor: '#f8d7da',
                      padding: 8,
                      borderRadius: 4,
                      border: '1px solid #f5c6cb',
                    }}
                  >
                    {result.error}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 16, fontSize: '12px', color: '#0c5460' }}>
        <p>
          <strong>Direct Vault Testing:</strong>
        </p>
        <ul style={{ margin: 0, paddingLeft: 16 }}>
          <li>
            Tests the <code>address(chain: string)</code> method directly on
            Vault instance
          </li>
          <li>
            Requires WalletCore instance to be passed to Vault constructor
          </li>
          <li>Demonstrates proper error handling with VaultError codes</li>
          <li>Shows performance timing for address derivation</li>
        </ul>
      </div>
    </div>
  )
}
