import { useCallback, useEffect, useState } from 'react'
import { Balance, Vault } from 'vultisig-sdk'

type BalanceDisplayProps = {
  vault: Vault
}

function BalanceDisplay({ vault }: BalanceDisplayProps) {
  const [balances, setBalances] = useState<Record<string, Balance> | null>(null)
  const [addresses, setAddresses] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [addressLoading, setAddressLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadBalances = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const vaultBalances = await vault.balances()
      setBalances(vaultBalances)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [vault])

  const loadAddresses = useCallback(async () => {
    if (!balances) return

    setAddressLoading(true)
    try {
      const addressPromises = Object.keys(balances).map(async chain => {
        try {
          const address = await vault.address(chain)
          return { chain, address }
        } catch (err) {
          console.warn(`Failed to derive address for ${chain}:`, err)
          return { chain, address: 'Failed to derive' }
        }
      })

      const addressResults = await Promise.all(addressPromises)
      const addressMap = addressResults.reduce(
        (acc, { chain, address }) => {
          acc[chain] = address
          return acc
        },
        {} as Record<string, string>
      )

      setAddresses(addressMap)
    } catch (err) {
      console.error('Failed to load addresses:', err)
    } finally {
      setAddressLoading(false)
    }
  }, [vault, balances])

  useEffect(() => {
    if (vault && !loading) {
      loadBalances()
    }
  }, [vault, loading, loadBalances])

  useEffect(() => {
    if (balances && Object.keys(balances).length > 0) {
      loadAddresses()
    }
  }, [balances, loadAddresses])

  if (loading) {
    return (
      <div style={{ padding: '20px', textAlign: 'center' }}>
        <div
          style={{
            width: '20px',
            height: '20px',
            border: '2px solid #f3f3f3',
            borderTop: '2px solid #007bff',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 10px',
          }}
        />
        <p>Loading balances...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: '20px' }}>
        <p style={{ color: 'red' }}>Error loading balances: {error}</p>
        <button
          onClick={loadBalances}
          style={{
            padding: '8px 16px',
            backgroundColor: '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div style={{ padding: '20px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '15px',
        }}
      >
        <h3 style={{ margin: 0, color: '#333' }}>
          Balances & Addresses
          {addressLoading && (
            <span
              style={{ fontSize: '12px', color: '#666', marginLeft: '8px' }}
            >
              (Loading addresses...)
            </span>
          )}
        </h3>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={loadAddresses}
            disabled={addressLoading || !balances}
            style={{
              padding: '6px 12px',
              backgroundColor: addressLoading ? '#6c757d' : '#17a2b8',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: addressLoading ? 'not-allowed' : 'pointer',
              fontSize: '12px',
            }}
          >
            {addressLoading ? 'Loading...' : 'Load Addresses'}
          </button>
          <button
            onClick={loadBalances}
            style={{
              padding: '6px 12px',
              backgroundColor: '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            Refresh Balances
          </button>
        </div>
      </div>

      {balances && Object.keys(balances).length > 0 ? (
        <div style={{ display: 'grid', gap: '12px' }}>
          {Object.entries(balances)
            .sort(([a], [b]) => {
              // Sort Bitcoin first, then alphabetically
              if (a.toLowerCase() === 'bitcoin') return -1
              if (b.toLowerCase() === 'bitcoin') return 1
              return a.localeCompare(b)
            })
            .map(([coinId, balance]) => {
              const getChainIcon = (chainId: string) => {
                switch (chainId.toLowerCase()) {
                  case 'bitcoin':
                    return 'BTC'
                  case 'ethereum':
                    return 'ETH'
                  case 'cosmos':
                    return 'COS'
                  case 'thorchain':
                    return 'THOR'
                  case 'solana':
                    return 'SOL'
                  default:
                    return '*'
                }
              }

              const getChainColor = (chainId: string) => {
                switch (chainId.toLowerCase()) {
                  case 'bitcoin':
                    return '#f7931a'
                  case 'ethereum':
                    return '#627eea'
                  case 'cosmos':
                    return '#2e3148'
                  case 'thorchain':
                    return '#00d4ff'
                  case 'solana':
                    return '#9945ff'
                  default:
                    return '#666'
                }
              }

              // Format balance to show up to 4 decimal places, taking into account the coin's decimals
              const formatBalance = (
                value: string,
                decimals: number
              ): string => {
                const num = parseFloat(value)
                if (num === 0) return '0'

                // Convert from raw amount to human-readable amount
                const humanReadableAmount = num / Math.pow(10, decimals)

                // For very small amounts, show up to 6 decimal places
                if (humanReadableAmount < 0.0001) {
                  return humanReadableAmount.toFixed(6)
                }

                // For amounts >= 0.0001, show up to 4 decimal places but remove trailing zeros
                const formatted = humanReadableAmount.toFixed(4)
                return parseFloat(formatted).toString()
              }

              const formattedAmount = formatBalance(
                balance.amount,
                balance.decimals
              )
              const isZero = formattedAmount === '0'
              const isBitcoin = coinId.toLowerCase() === 'bitcoin'

              return (
                <div
                  key={coinId}
                  style={{
                    padding: isBitcoin ? '20px' : '16px',
                    backgroundColor: isBitcoin
                      ? 'linear-gradient(135deg, #fff9e6, #ffffff)'
                      : 'white',
                    background: isBitcoin
                      ? 'linear-gradient(135deg, #fff9e6, #ffffff)'
                      : 'white',
                    borderRadius: isBitcoin ? '16px' : '12px',
                    border: isBitcoin
                      ? `3px solid ${getChainColor(coinId)}40`
                      : `2px solid ${getChainColor(coinId)}20`,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    boxShadow: isBitcoin
                      ? '0 4px 16px rgba(247, 147, 26, 0.15)'
                      : '0 2px 8px rgba(0,0,0,0.05)',
                    transition: 'all 0.2s ease',
                    position: 'relative',
                    overflow: 'hidden',
                    transform: isBitcoin ? 'scale(1.02)' : 'scale(1)',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '4px',
                      height: '100%',
                      backgroundColor: getChainColor(coinId),
                    }}
                  />

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: isBitcoin ? '16px' : '12px',
                    }}
                  >
                    <div
                      style={{
                        width: isBitcoin ? '48px' : '40px',
                        height: isBitcoin ? '48px' : '40px',
                        borderRadius: '50%',
                        backgroundColor: `${getChainColor(coinId)}${isBitcoin ? '20' : '15'}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: isBitcoin ? '22px' : '18px',
                        fontWeight: 'bold',
                        color: getChainColor(coinId),
                        boxShadow: isBitcoin
                          ? `0 2px 8px ${getChainColor(coinId)}30`
                          : 'none',
                      }}
                    >
                      {getChainIcon(coinId)}
                    </div>
                    <div>
                      <div
                        style={{
                          fontWeight: isBitcoin ? '700' : '600',
                          color: '#333',
                          fontSize: isBitcoin ? '18px' : '16px',
                          textTransform: 'capitalize',
                        }}
                      >
                        {coinId}
                      </div>
                      <div
                        style={{
                          fontSize: isBitcoin ? '14px' : '12px',
                          color: '#666',
                        }}
                      >
                        {coinId.toUpperCase()} Balance
                      </div>
                      {addresses[coinId] && (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            marginTop: '4px',
                            maxWidth: '200px',
                          }}
                        >
                          <div
                            style={{
                              fontSize: isBitcoin ? '12px' : '10px',
                              color: '#888',
                              fontFamily: 'monospace',
                              wordBreak: 'break-all',
                              flex: 1,
                            }}
                            title={addresses[coinId]}
                          >
                            {addresses[coinId].length > 20
                              ? `${addresses[coinId].slice(0, 10)}...${addresses[coinId].slice(-10)}`
                              : addresses[coinId]}
                          </div>
                          <button
                            onClick={() =>
                              navigator.clipboard.writeText(addresses[coinId])
                            }
                            style={{
                              padding: '2px 4px',
                              backgroundColor: 'transparent',
                              border: '1px solid #ddd',
                              borderRadius: '3px',
                              cursor: 'pointer',
                              fontSize: '10px',
                              color: '#666',
                            }}
                            title="Copy address"
                          >
                            📋
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <div
                      style={{
                        fontWeight: '700',
                        color: isZero ? '#999' : '#333',
                        fontSize: isBitcoin ? '22px' : '18px',
                        fontFamily: 'monospace',
                      }}
                    >
                      {formattedAmount}
                    </div>
                    <div
                      style={{
                        fontSize: isBitcoin ? '16px' : '14px',
                        color: getChainColor(coinId),
                        fontWeight: '600',
                      }}
                    >
                      {coinId.toUpperCase()}
                    </div>
                  </div>
                </div>
              )
            })}
        </div>
      ) : (
        <div
          style={{
            padding: '40px',
            textAlign: 'center',
            color: '#666',
            backgroundColor: '#f8f9fa',
            borderRadius: '6px',
            border: '1px solid #dee2e6',
          }}
        >
          <p>No balances found</p>
          <p style={{ fontSize: '14px' }}>
            This vault doesn&apos;t have any coins yet.
          </p>
        </div>
      )}
    </div>
  )
}

export default BalanceDisplay
