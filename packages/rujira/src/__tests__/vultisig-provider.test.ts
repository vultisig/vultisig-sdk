import { describe, expect, it } from 'vitest'

import { VultisigRujiraProvider } from '../signer/vultisig-provider.js'

const address = 'thor1test'
const publicKey = '02' + '33'.repeat(32)

const signDirectWith = async (derSignature: string) => {
  const vault = {
    address: async () => address,
    publicKeys: { ecdsa: publicKey },
    prepareSignDirectTx: async () => ({ coin: { hexPublicKey: publicKey } }),
    extractMessageHashes: async () => ['07'.repeat(32)],
    sign: async () => ({ signature: derSignature, format: 'ECDSA' }),
  }
  const provider = new VultisigRujiraProvider(
    vault as unknown as ConstructorParameters<typeof VultisigRujiraProvider>[0]
  )
  const { signature } = await provider.signDirect(address, {
    bodyBytes: new Uint8Array([1]),
    authInfoBytes: new Uint8Array([2]),
    chainId: 'thorchain-1',
    accountNumber: 0n,
  })
  return Buffer.from(signature.signature, 'base64').toString('hex')
}

const derInteger = (scalar: string) => {
  const minimal = scalar.replace(/^(00)+/, '')
  return `02${(minimal.length / 2).toString(16).padStart(2, '0')}${minimal}`
}
const toDer = (r: string, s: string) => {
  const body = derInteger(r) + derInteger(s)
  return `30${(body.length / 2).toString(16).padStart(2, '0')}${body}`
}

describe('VultisigRujiraProvider.signDirect', () => {
  it('reads minimal DER of 64 bytes and shorter as DER, not raw r||s', async () => {
    const r = '000000' + '11'.repeat(28) + '02'
    for (const s of ['000000' + '22'.repeat(29), '00000000' + '22'.repeat(28)]) {
      const der = toDer(r, s)
      expect(der.length).toBeLessThanOrEqual(128)
      expect(await signDirectWith(der)).toBe(r + s)
    }
  })

  it('keeps a raw r||s that only starts like DER as raw', async () => {
    for (const raw of [
      '303e020101020102' + '11'.repeat(23) + '12' + '11'.repeat(32),
      '303e022101' + '11'.repeat(32) + '0219' + '22'.repeat(25),
    ]) {
      expect(await signDirectWith(raw)).toBe(raw)
    }
  })

  it('rejects a negative or non-minimal short DER integer', async () => {
    await expect(signDirectWith('3006020180020101')).rejects.toThrow()
    await expect(signDirectWith('300702010102020001')).rejects.toThrow()
  })
})
