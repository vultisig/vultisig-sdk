export type AuthAdapter = {
  getPassword(vaultId: string): Promise<string | null>
  getDecryptionPassword(vaultId: string): Promise<string | null>
}

const SERVICE_NAME = 'vultisig'

export class LocalKeyringAdapter implements AuthAdapter {
  async getPassword(vaultId: string): Promise<string | null> {
    try {
      const keytar = await import('keytar')
      return await keytar.default.getPassword(SERVICE_NAME, `${vaultId}/server`)
    } catch {
      return null
    }
  }

  async getDecryptionPassword(vaultId: string): Promise<string | null> {
    try {
      const keytar = await import('keytar')
      return await keytar.default.getPassword(SERVICE_NAME, `${vaultId}/decrypt`)
    } catch {
      return null
    }
  }
}

export class EnvVarAdapter implements AuthAdapter {
  async getPassword(_vaultId: string): Promise<string | null> {
    return process.env.VAULT_PASSWORD ?? null
  }

  async getDecryptionPassword(_vaultId: string): Promise<string | null> {
    return process.env.VAULT_DECRYPT_PASSWORD ?? null
  }
}

export class FallbackAuthAdapter implements AuthAdapter {
  private adapters: AuthAdapter[]

  constructor(adapters: AuthAdapter[]) {
    this.adapters = adapters
  }

  async getPassword(vaultId: string): Promise<string | null> {
    for (const adapter of this.adapters) {
      const result = await adapter.getPassword(vaultId)
      if (result) return result
    }
    return null
  }

  async getDecryptionPassword(vaultId: string): Promise<string | null> {
    for (const adapter of this.adapters) {
      const result = await adapter.getDecryptionPassword(vaultId)
      if (result) return result
    }
    return null
  }
}

export function createDefaultAuthAdapter(): AuthAdapter {
  return new FallbackAuthAdapter([new LocalKeyringAdapter(), new EnvVarAdapter()])
}
