import { useEffect, useState } from 'react'
import type { Vault, Vultisig } from 'vultisig-sdk'

type AddressMap = Partial<Record<'BTC' | 'ETH' | 'SOL' | 'THOR', string>>

export const VaultDisplay = ({
  vault,
  sdk,
  fastVault,
}: {
  vault: Vault
  sdk: Vultisig
  fastVault?: boolean
}) => {
  const [addresses, setAddresses] = useState<AddressMap>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const derive = async () => {
      try {
        setLoading(true)
        setError(null)

        // Ensure SDK is initialized before deriving addresses
        const isInitialized = await sdk.isInitialized()
        if (!isInitialized) {
          console.log('SDK not initialized, initializing now...')
          await sdk.initialize()
        }

        const [btc, eth, sol, thor] = await Promise.all([
          sdk.deriveAddress(vault, 'bitcoin'),
          sdk.deriveAddress(vault, 'ethereum'),
          sdk.deriveAddress(vault, 'solana'),
          sdk.deriveAddress(vault, 'thorchain'),
        ])
        if (!cancelled)
          setAddresses({ BTC: btc, ETH: eth, SOL: sol, THOR: thor })
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    derive()
    return () => {
      cancelled = true
    }
  }, [sdk, vault])

  return (
    <div
      style={{
        marginTop: 16,
        border: '1px solid #e9ecef',
        borderRadius: 8,
        padding: 12,
        position: 'relative',
      }}
    >
      {fastVault && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            background: '#0d6efd',
            color: 'white',
            fontSize: 12,
            padding: '4px 8px',
            borderRadius: 9999,
          }}
        >
          Fast Vault
        </div>
      )}
      <h3 style={{ marginTop: 0, color: '#333' }}>Current Vault</h3>
      <div style={{ color: '#555' }}>Name: {vault.name}</div>
      <div style={{ color: '#555' }}>Local Party: {vault.localPartyId}</div>
      <div style={{ color: '#555' }}>
        ECDSA PubKey: {vault.publicKeys.ecdsa}
      </div>
      <div style={{ color: '#555' }}>
        EDDSA PubKey: {vault.publicKeys.eddsa}
      </div>

      <div style={{ marginTop: 12 }}>
        <h4 style={{ margin: '8px 0', color: '#333' }}>Addresses</h4>
        {loading && <div style={{ color: '#666' }}>Deriving addresses...</div>}
        {error && <div style={{ color: '#dc3545' }}>{error}</div>}
        {!loading && !error && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '140px 1fr',
              rowGap: 6,
              columnGap: 8,
            }}
          >
            <div style={{ color: '#6c757d' }}>BTC</div>
            <div style={{ wordBreak: 'break-all', color: '#222' }}>
              {addresses.BTC || '-'}
            </div>
            <div style={{ color: '#6c757d' }}>ETH</div>
            <div style={{ wordBreak: 'break-all', color: '#222' }}>
              {addresses.ETH || '-'}
            </div>
            <div style={{ color: '#6c757d' }}>SOL</div>
            <div style={{ wordBreak: 'break-all', color: '#222' }}>
              {addresses.SOL || '-'}
            </div>
            <div style={{ color: '#6c757d' }}>THOR</div>
            <div style={{ wordBreak: 'break-all', color: '#222' }}>
              {addresses.THOR || '-'}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
