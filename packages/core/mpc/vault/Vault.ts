import { Chain } from '@vultisig/core-chain/Chain'
import { PublicKeys } from '@vultisig/core-chain/publicKey/PublicKeys'
import { SignatureAlgorithm } from '@vultisig/core-chain/signing/SignatureAlgorithm'
import { MpcLib } from '@vultisig/core-mpc/mpcLib'

export type VaultKeyShares = Record<SignatureAlgorithm, string>

export type VaultAllKeyShares = {
  keyShares: VaultKeyShares
  chainKeyShares?: Partial<Record<Chain, string>>
  keyShareMldsa?: string
}

export type Vault = {
  name: string
  publicKeys: PublicKeys
  signers: string[]
  createdAt?: number
  hexChainCode: string
  keyShares: VaultKeyShares
  localPartyId: string
  // should only be present in legacy GG20 vaults
  resharePrefix?: string
  libType: MpcLib
  isBackedUp: boolean
  order: number
  folderId?: string
  lastPasswordVerificationTime?: number
  chainPublicKeys?: Partial<Record<Chain, string>>
  chainKeyShares?: Partial<Record<Chain, string>>
  publicKeyMldsa?: string
  keyShareMldsa?: string
}

export const getVaultId = (vault: Vault): string => vault.publicKeys.ecdsa

export const isKeyImportVault = (vault: Vault): boolean =>
  vault.chainPublicKeys !== undefined &&
  Object.keys(vault.chainPublicKeys).length > 0
