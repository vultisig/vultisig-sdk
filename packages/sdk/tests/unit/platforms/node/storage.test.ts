import { afterEach, describe, expect, it } from 'vitest'

import { FileStorage } from '../../../../src/platforms/node/storage'

const ENV_KEY = 'VULTISIG_CONFIG_DIR'
const savedConfigDir = process.env[ENV_KEY]

afterEach(() => {
  if (savedConfigDir === undefined) {
    delete process.env[ENV_KEY]
  } else {
    process.env[ENV_KEY] = savedConfigDir
  }
})

describe('FileStorage', () => {
  it('honors VULTISIG_CONFIG_DIR when basePath is omitted', () => {
    process.env[ENV_KEY] = '/tmp/vultisig-config-dir-node-storage'

    const storage = new FileStorage()

    expect(storage.basePath).toBe('/tmp/vultisig-config-dir-node-storage')
  })

  it('falls back to the default config dir when VULTISIG_CONFIG_DIR is blank', () => {
    process.env[ENV_KEY] = '   '

    const storage = new FileStorage()

    expect(storage.basePath.endsWith('/.vultisig')).toBe(true)
  })

  it('keeps explicit basePath overrides ahead of VULTISIG_CONFIG_DIR', () => {
    process.env[ENV_KEY] = '/tmp/vultisig-config-dir-node-storage'

    const storage = new FileStorage({ basePath: '/tmp/explicit-vault-dir' })

    expect(storage.basePath).toBe('/tmp/explicit-vault-dir')
  })
})
