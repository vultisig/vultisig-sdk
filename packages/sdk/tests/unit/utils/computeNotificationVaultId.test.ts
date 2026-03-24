import { describe, expect, it } from 'vitest'

import { computeNotificationVaultId } from '../../../src/utils/computeNotificationVaultId'

describe('computeNotificationVaultId', () => {
  it('returns lowercase SHA256 hex of utf8(pubKeyECDSA + hexChainCode)', async () => {
    const ecdsa = '04testEcdsaPubKeyHex'
    const chain = '00112233445566778899aabbccddeeff'
    const expected = '456168d997f217cd775b746980ec0b41ae48660bab1e8334c10209a6ea6564cc'
    await expect(computeNotificationVaultId(ecdsa, chain)).resolves.toBe(expected)
  })
})
