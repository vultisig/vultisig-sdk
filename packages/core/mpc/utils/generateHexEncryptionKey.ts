import { getHexEncodedRandomBytes } from '@vultisig/lib-utils/crypto/getHexEncodedRandomBytes'

export const generateHexEncryptionKey = () => getHexEncodedRandomBytes(32)
