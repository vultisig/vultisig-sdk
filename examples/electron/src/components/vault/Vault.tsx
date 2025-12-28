import { useState } from 'react'

import type { VaultInfo } from '@/types'

import VaultAddresses from './sections/VaultAddresses'
import VaultChains from './sections/VaultChains'
import VaultOverview from './sections/VaultOverview'
import VaultSend from './sections/VaultSend'

// Section types for sub-navigation (core features only)
export type VaultSection = 'overview' | 'addresses' | 'chains' | 'send'

type VaultProps = {
  vault: VaultInfo
  onVaultDeleted?: (vaultId: string) => void
  onVaultRenamed?: (vaultId: string, newName: string) => void
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
  { id: 'send', label: 'Send', icon: 'M12 19l9 2-9-18-9 18 9-2zm0 0v-8' },
]

export default function Vault({ vault, onVaultDeleted, onVaultRenamed }: VaultProps) {
  const [activeSection, setActiveSection] = useState<VaultSection>('overview')

  const renderSection = () => {
    switch (activeSection) {
      case 'overview':
        return <VaultOverview vault={vault} onVaultDeleted={onVaultDeleted} onVaultRenamed={onVaultRenamed} />
      case 'addresses':
        return <VaultAddresses vault={vault} />
      case 'chains':
        return <VaultChains vault={vault} />
      case 'send':
        return <VaultSend vault={vault} />
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
