import { describe, expect, it } from 'vitest'

import { generateLocalPartyId, hasServer, isServer, parseLocalPartyId } from './localPartyId'

describe('localPartyId', () => {
  it('generates a CSPRNG-backed hex suffix for SDK parties', () => {
    const id = generateLocalPartyId('sdk')

    expect(id).toMatch(/^sdk-[0-9a-f]{16}$/)
  })

  it('keeps server party IDs capitalized for existing server detection', () => {
    const id = generateLocalPartyId('server')

    expect(id).toMatch(/^Server-[0-9a-f]{16}$/)
    expect(hasServer([id])).toBe(true)
  })

  it.each(['Server-current', 'server-current', 'VultiServer-legacy', 'vultiserver-legacy'])(
    'recognizes current and legacy server party ID %s',
    id => {
      expect(isServer(id)).toBe(true)
    }
  )

  it.each(['Serverless-device', 'VultiServerBackup-device', 'desktop-server-device'])(
    'does not classify prefix lookalike %s as a server party',
    id => {
      expect(isServer(id)).toBe(false)
    }
  )

  it('detects a legacy VultiServer signer in a hybrid signer list', () => {
    expect(hasServer(['iPhone-current', 'VultiServer-legacy'])).toBe(true)
  })

  it('parses generated party IDs into device name and suffix', () => {
    const id = generateLocalPartyId('sdk')
    const parsed = parseLocalPartyId(id)

    expect(parsed.deviceName).toBe('sdk')
    expect(parsed.hash).toMatch(/^[0-9a-f]{16}$/)
  })

  it('does not reuse suffixes across repeated generations', () => {
    const ids = Array.from({ length: 1_000 }, () => generateLocalPartyId('sdk'))

    expect(new Set(ids).size).toBe(ids.length)
  })
})
