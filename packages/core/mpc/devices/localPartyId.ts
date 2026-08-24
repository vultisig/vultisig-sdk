import { bytesToHex, randomBytes } from '@noble/hashes/utils'
import { capitalizeFirstLetter } from '@vultisig/lib-utils/capitalizeFirstLetter'

import { MpcDevice, mpcDeviceFromDeviceName } from './MpcDevice'

const localPartyIdSeparator = '-'
const localPartyIdEntropyBytes = 8
const legacyServerDeviceName = 'vultiserver'

export const generateLocalPartyId = (device: MpcDevice) => {
  const deviceName = device === 'server' ? capitalizeFirstLetter(device) : device

  const suffix = bytesToHex(randomBytes(localPartyIdEntropyBytes))

  return [deviceName, suffix].join(localPartyIdSeparator)
}

export const parseLocalPartyId = (localPartyId: string) => {
  const [deviceName, hash] = localPartyId.split(localPartyIdSeparator)

  return { deviceName, hash }
}

export const hasServer = (signers: readonly string[]) => signers.some(isServer)

export const isServer = (device: string) => {
  const { deviceName } = parseLocalPartyId(device)

  return mpcDeviceFromDeviceName(deviceName) === 'server' || deviceName.toLowerCase() === legacyServerDeviceName
}
