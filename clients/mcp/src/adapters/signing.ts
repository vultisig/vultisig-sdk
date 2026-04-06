import type { Vault } from '../types.js'

export type PreparedTx = {
  chain: string
  keysignPayload: unknown
}

export type SignedTx = {
  txHash: string
  chain: string
}

export type SigningAdapter = {
  sign(vault: Vault, tx: PreparedTx): Promise<SignedTx>
}

export class LocalSigningAdapter implements SigningAdapter {
  async sign(vault: Vault, tx: PreparedTx): Promise<SignedTx> {
    const { chain, keysignPayload } = tx
    if (!vault.sign || !vault.broadcastTx) {
      throw new Error('Vault does not support local signing')
    }
    const signature = await vault.sign({ transaction: keysignPayload, chain })
    const txHash = await vault.broadcastTx({ chain, keysignPayload, signature })
    return { txHash, chain }
  }
}

export class DeferredSigningAdapter implements SigningAdapter {
  async sign(_vault: Vault, _tx: PreparedTx): Promise<SignedTx> {
    throw new Error('DeferredSigningAdapter: TSS signing not implemented')
  }
}
