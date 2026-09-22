import { VaultError, VaultErrorCode } from '../vault/VaultError'

/** Both MPC KeyImportInitiator implementations assign the first ID to the initiator. */
export function getKeyImportCommittee(devices: readonly string[], initiatorPartyId: string): string[] {
  if (!devices.includes(initiatorPartyId)) {
    throw new VaultError(VaultErrorCode.InvalidConfig, 'The key import initiator is missing from the relay committee')
  }
  return [initiatorPartyId, ...devices.filter(device => device !== initiatorPartyId).sort()]
}
