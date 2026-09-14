import { hasServer } from '@vultisig/core-mpc/devices/localPartyId'

import type { VaultData } from '../../types'

/** Canonicalizes vault metadata written by SDKs that did not recognize legacy server party IDs. */
export const canonicalizeVaultData = (vaultData: VaultData): VaultData =>
  vaultData.type === 'secure' && hasServer(vaultData.signers) ? { ...vaultData, type: 'fast' } : vaultData
