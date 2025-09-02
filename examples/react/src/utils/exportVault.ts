import { toBinary } from '@bufbuild/protobuf'
import { toCommVault } from '@core/mpc/types/utils/commVault'
import { VaultContainerSchema } from '@core/mpc/types/vultisig/vault/v1/vault_container_pb'
import { VaultSchema } from '@core/mpc/types/vultisig/vault/v1/vault_pb'
import { encryptWithAesGcm } from '@lib/utils/encryption/aesGcm/encryptWithAesGcm'

const base64FromUint8 = (u8: Uint8Array) =>
  typeof window !== 'undefined'
    ? btoa(String.fromCharCode(...Array.from(u8)))
    : Buffer.from(u8).toString('base64')

export const buildVultFile = async (vault: any, password?: string) => {
  const comm = toCommVault(vault)
  const binary = toBinary(VaultSchema, comm)
  let innerBase64: string
  const isEncrypted = !!password
  if (isEncrypted) {
    const encrypted = await encryptWithAesGcm({ key: password!, value: binary })
    innerBase64 = base64FromUint8(encrypted as unknown as Uint8Array)
  } else {
    innerBase64 = base64FromUint8(binary as unknown as Uint8Array)
  }
  const containerBinary = toBinary(
    VaultContainerSchema as any,
    { vault: innerBase64, isEncrypted } as any
  )
  const containerBase64 = base64FromUint8(
    containerBinary as unknown as Uint8Array
  )
  const blob = new Blob([containerBase64], { type: 'text/plain' })
  return { blob, filename: `${vault.name || 'vault'}.vult` }
}
