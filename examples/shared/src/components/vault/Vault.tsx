import { useEffect, useState } from 'react'

import type { FiatCurrency, VaultInfo } from '../../types'
import VaultAddresses from './sections/VaultAddresses'
import VaultBalance from './sections/VaultBalance'
import VaultChains from './sections/VaultChains'
import VaultOverview from './sections/VaultOverview'
import VaultPortfolio, { type PortfolioData, type PortfolioSnapshot } from './sections/VaultPortfolio'
import VaultSend from './sections/VaultSend'
import VaultSwap from './sections/VaultSwap'
import VaultTokens from './sections/VaultTokens'

// Section types for sub-navigation
export type VaultSection = 'overview' | 'addresses' | 'chains' | 'tokens' | 'balance' | 'portfolio' | 'send' | 'swap'

type VaultProps = {
  vault: VaultInfo
  onVaultDeleted?: (vaultId: string) => void
  onVaultRenamed?: (vaultId: string, newName: string) => void
  onVaultUpdated?: (vault: VaultInfo) => void
}

const SECTION_CONFIG: { id: VaultSection; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
  {
    id: 'addresses',
    label: 'Addresses',
    icon: 'M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z',
  },
  {
    id: 'chains',
    label: 'Chains',
    icon: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1',
  },
  {
    id: 'tokens',
    label: 'Tokens',
    icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  },
  {
    id: 'balance',
    label: 'Balance',
    icon: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z',
  },
  {
    id: 'portfolio',
    label: 'Portfolio',
    icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  },
  { id: 'send', label: 'Send', icon: 'M12 19l9 2-9-18-9 18 9-2zm0 0v-8' },
  { id: 'swap', label: 'Swap', icon: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4' },
]

const PORTFOLIO_STORAGE_KEY = (vaultId: string) => `vultisig-example-portfolio:${vaultId}`

const FIAT_CODES = new Set<string>([
  'usd',
  'eur',
  'gbp',
  'jpy',
  'cny',
  'aud',
  'cad',
  'chf',
  'sgd',
  'sek',
])

function parsePortfolioSnapshot(vaultId: string): PortfolioSnapshot | null {
  if (typeof sessionStorage === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(PORTFOLIO_STORAGE_KEY(vaultId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { currency?: unknown; portfolio?: unknown }
    const currency: FiatCurrency =
      typeof parsed.currency === 'string' && FIAT_CODES.has(parsed.currency)
        ? (parsed.currency as FiatCurrency)
        : 'usd'
    let portfolio: PortfolioData | null = null
    if (
      parsed.portfolio &&
      typeof parsed.portfolio === 'object' &&
      parsed.portfolio !== null &&
      'total' in parsed.portfolio &&
      typeof (parsed.portfolio as PortfolioData).total === 'number' &&
      'byChain' in parsed.portfolio &&
      typeof (parsed.portfolio as PortfolioData).byChain === 'object' &&
      (parsed.portfolio as PortfolioData).byChain !== null
    ) {
      portfolio = parsed.portfolio as PortfolioData
    }
    return { currency, portfolio }
  } catch {
    return null
  }
}

function persistPortfolioSnapshot(vaultId: string, snapshot: PortfolioSnapshot): void {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(PORTFOLIO_STORAGE_KEY(vaultId), JSON.stringify(snapshot))
  } catch {
    // ignore quota / private mode
  }
}

export default function Vault({ vault, onVaultDeleted, onVaultRenamed, onVaultUpdated }: VaultProps) {
  const [activeSection, setActiveSection] = useState<VaultSection>('overview')
  const [portfolioSnapshot, setPortfolioSnapshot] = useState<PortfolioSnapshot>(() => {
    return parsePortfolioSnapshot(vault.id) ?? { currency: 'usd', portfolio: null }
  })

  useEffect(() => {
    persistPortfolioSnapshot(vault.id, portfolioSnapshot)
  }, [vault.id, portfolioSnapshot])

  const renderSection = () => {
    switch (activeSection) {
      case 'overview':
        return <VaultOverview vault={vault} onVaultDeleted={onVaultDeleted} onVaultRenamed={onVaultRenamed} />
      case 'addresses':
        return <VaultAddresses vault={vault} />
      case 'chains':
        return <VaultChains vault={vault} onVaultUpdated={onVaultUpdated} />
      case 'tokens':
        return <VaultTokens vault={vault} />
      case 'balance':
        return <VaultBalance vault={vault} />
      case 'portfolio':
        return (
          <VaultPortfolio vault={vault} snapshot={portfolioSnapshot} setSnapshot={setPortfolioSnapshot} />
        )
      case 'send':
        return <VaultSend vault={vault} />
      case 'swap':
        return <VaultSwap vault={vault} />
      default:
        return null
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Sub-navigation tabs */}
      <div className="border-b border-gray-200 bg-white">
        <nav className="flex overflow-x-auto" aria-label="Vault sections">
          {SECTION_CONFIG.map(section => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={`
                flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap
                border-b-2 transition-colors duration-200
                ${
                  activeSection === section.id
                    ? 'border-primary text-primary'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }
              `}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={section.icon} />
              </svg>
              {section.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Section content */}
      <div className="flex-1 p-6 overflow-auto">{renderSection()}</div>
    </div>
  )
}
