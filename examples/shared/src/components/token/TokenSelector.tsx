import { useEffect, useState } from 'react'

import { useSDKAdapter } from '../../adapters'
import { isEvmChain } from '../../constants/tokens'
import type { TokenInfo, VaultInfo } from '../../types'
import Select from '../common/Select'
import AddTokenModal from './AddTokenModal'

const ADD_TOKEN_VALUE = '__add_token__'

type TokenSelectorProps = {
  chain: string
  vault: VaultInfo
  value: string // tokenId or '' for native
  onChange: (tokenId: string) => void
  label?: string
  disabled?: boolean
}

export default function TokenSelector({ chain, vault, value, onChange, label, disabled }: TokenSelectorProps) {
  const sdk = useSDKAdapter()
  const [tokens, setTokens] = useState<TokenInfo[]>([])
  const [isModalOpen, setIsModalOpen] = useState(false)

  // Load tokens when chain changes
  useEffect(() => {
    if (!chain) {
      setTokens([])
      return
    }

    const loadTokens = async () => {
      try {
        const chainTokens = await sdk.getTokens(vault.id, chain)
        setTokens(chainTokens)
      } catch (err) {
        console.error('Failed to load tokens:', err)
        setTokens([])
      }
    }

    loadTokens()
  }, [sdk, vault.id, chain])

  // No chain selected
  if (!chain) {
    return null
  }

  const isEvm = isEvmChain(chain)

  // Build options: Native + vault tokens + Add Token option
  const options = [
    { value: '', label: `${chain} (Native)` },
    ...tokens.map(token => ({
      value: token.id,
      label: `${token.symbol} (${token.name})`,
    })),
  ]

  // Add "Add Token..." option for EVM chains
  if (isEvm) {
    options.push({ value: ADD_TOKEN_VALUE, label: '+ Add Token...' })
  }

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = e.target.value
    if (newValue === ADD_TOKEN_VALUE) {
      setIsModalOpen(true)
      return
    }
    onChange(newValue)
  }

  const handleTokenAdded = (tokenId: string) => {
    // Reload tokens and auto-select the newly added token
    sdk.getTokens(vault.id, chain).then(chainTokens => {
      setTokens(chainTokens)
      onChange(tokenId)
    })
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
