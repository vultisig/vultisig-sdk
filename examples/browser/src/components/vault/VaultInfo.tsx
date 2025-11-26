import type { VaultBase } from '@vultisig/sdk'

import { shortenAddress } from '@/utils/formatting'

type VaultInfoProps = {
  vault: VaultBase
}

export default function VaultInfo({ vault }: VaultInfoProps) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
      <h2 className="text-xl font-semibold mb-4">Vault Information</h2>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-sm font-medium text-gray-500">Name</div>
          <p className="text-lg font-medium">{vault.name}</p>
        </div>
        <div>
          <div className="text-sm font-medium text-gray-500">ID</div>
          <p className="text-lg font-mono">{shortenAddress(vault.id, 8)}</p>
        </div>
        <div>
          <div className="text-sm font-medium text-gray-500">Encrypted</div>
          <p className="text-lg">{vault.isEncrypted ? 'Yes' : 'No'}</p>
        </div>
        <div>
          <div className="text-sm font-medium text-gray-500">Chains</div>
          <p className="text-lg">{vault.getChains().length}</p>
        </div>
      </div>
    </div>
  )
}
