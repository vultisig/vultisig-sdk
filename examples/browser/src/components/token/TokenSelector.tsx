import type { Chain, Token, VaultBase } from '@vultisig/sdk'
import { useState } from 'react'

import Select from '@/components/common/Select'
import { isEvmChain } from '@/constants/tokens'

import AddTokenModal from './AddTokenModal'

const ADD_TOKEN_VALUE = '__add_token__'

type TokenSelectorProps = {
  chain: Chain | ''
  vault: VaultBase
  value: string // tokenId or '' for native
  onChange: (tokenId: string) => void
  label?: string
  disabled?: boolean
}

export default function TokenSelector({ chain, vault, value, onChange, label, disabled }: TokenSelectorProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)

  // No chain selected
  if (!chain) {
    return null
  }

  const tokens = vault.getTokens(chain)
  const isEvm = isEvmChain(chain)

  // Build options: Native + vault tokens + Add Token option
  const options = [
    { value: '', label: `${chain} (Native)` },
    ...tokens.map((token: Token) => ({
      value: token.id,
      label: `${token.symbol} (${token.name})`,
    })),
  ]

  // Add "Add Token..." option for EVM chains or chains that could support tokens
  if (isEvm) {
    options.push({ value: ADD_TOKEN_VALUE, label: '+ Add Token...' })
  }

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = e.target.value
    if (newValue === ADD_TOKEN_VALUE) {
      setIsModalOpen(true)
      // Don't change the actual value
      return
    }
    onChange(newValue)
  }

  const handleTokenAdded = (tokenId: string) => {
    // Auto-select the newly added token
    onChange(tokenId)
  }

  return (
    <>
      <Select label={label} options={options} value={value} onChange={handleChange} disabled={disabled} />

      <AddTokenModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        chain={chain}
        vault={vault}
        onTokenAdded={handleTokenAdded}
      />
    </>
  )
}
