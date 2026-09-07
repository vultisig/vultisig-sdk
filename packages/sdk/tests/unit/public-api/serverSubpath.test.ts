import { describe, expect, it } from 'vitest'

import * as server from '../../../src/server'

describe('@vultisig/sdk/server source surface', () => {
  it('exports the documented fast-vault and relay helpers', () => {
    expect(typeof server.setupVaultWithServer).toBe('function')
    expect(typeof server.createVaultWithServer).toBe('function')
    expect(typeof server.signWithServer).toBe('function')
    expect(typeof server.verifyVaultEmailCode).toBe('function')
    expect(typeof server.getVaultFromServer).toBe('function')
    expect(typeof server.reshareWithServer).toBe('function')
    expect(typeof server.batchReshareWithServer).toBe('function')
    expect(typeof server.keyImportWithServer).toBe('function')
    expect(typeof server.sequentialKeyImportWithServer).toBe('function')
    expect(typeof server.sendMpcRelayMessage).toBe('function')
    expect(typeof server.getMpcRelayMessages).toBe('function')
    expect(typeof server.deleteMpcRelayMessage).toBe('function')
    expect(typeof server.waitForSetupMessage).toBe('function')
    expect(typeof server.uploadMpcSetupMessage).toBe('function')
    expect(typeof server.joinMpcSession).toBe('function')
    expect(typeof server.fromMpcServerMessage).toBe('function')
    expect(typeof server.toMpcServerMessage).toBe('function')
  })

  it('does not leak the internal ServerManager on the public server surface', () => {
    expect('ServerManager' in server).toBe(false)
  })
})
