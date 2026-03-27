import { fromBinary } from '@bufbuild/protobuf'
import { VaultContainerSchema } from '@vultisig/core-mpc/types/vultisig/vault/v1/vault_container_pb'
import { fromBase64 } from '@vultisig/lib-utils/fromBase64'
import { pipe } from '@vultisig/lib-utils/pipe'

export const vaultContainerFromString = (value: string) =>
  pipe(value, fromBase64, binary => fromBinary(VaultContainerSchema, binary))
