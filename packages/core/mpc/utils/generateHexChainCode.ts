import { getHexEncodedRandomBytes } from '@vultisig/lib-utils/crypto/getHexEncodedRandomBytes'

export const generateHexChainCode = () => getHexEncodedRandomBytes(32)
