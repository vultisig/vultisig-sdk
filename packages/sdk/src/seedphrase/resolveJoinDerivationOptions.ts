import { VaultError, VaultErrorCode } from '../vault/VaultError'
import type { DeriveChainPrivateKeysOptions } from './MasterKeyDeriver'

/** Pairing settings are authoritative; explicit options support legacy QR payloads. */
export function resolveJoinDerivationOptions(
  pairing: DeriveChainPrivateKeysOptions,
  options: DeriveChainPrivateKeysOptions
): DeriveChainPrivateKeysOptions {
  const resolved: DeriveChainPrivateKeysOptions = {}
  for (const key of ['usePhantomSolanaPath', 'useCosmosPathTerra'] as const) {
    const paired = pairing[key]
    const explicit = options[key]
    if (
      (paired !== undefined && typeof paired !== 'boolean') ||
      (explicit !== undefined && typeof explicit !== 'boolean')
    ) {
      throw new VaultError(VaultErrorCode.InvalidConfig, `${key} must be a boolean`)
    }
    if (paired !== undefined && explicit !== undefined && paired !== explicit) {
      throw new VaultError(VaultErrorCode.InvalidConfig, `${key} conflicts with the initiator's pairing settings`)
    }
    resolved[key] = paired ?? explicit ?? false
  }
  return resolved
}
