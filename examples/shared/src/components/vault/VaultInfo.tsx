import type { VaultInfo } from '../../types'

// Shorten address for display
function shortenAddress(address: string, chars = 6): string {
  if (address.length <= chars * 2 + 3) return address
  return `${address.slice(0, chars)}...${address.slice(-chars)}`
}

type VaultInfoCardProps = {
  vault: VaultInfo
}

export default function VaultInfoCard({ vault }: VaultInfoCardProps) {
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
          <div className="text-sm font-medium text-gray-500">Type</div>
          <p className="text-lg capitalize">{vault.type}</p>
        </div>
        <div>
          <div className="text-sm font-medium text-gray-500">Chains</div>
          <p className="text-lg">{vault.chains.length}</p>
        </div>
      </div>
    </div>
  )
}
