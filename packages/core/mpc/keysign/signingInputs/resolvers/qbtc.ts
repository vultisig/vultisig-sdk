import { toBinary } from '@bufbuild/protobuf'
import {
  KeysignPayload,
  KeysignPayloadSchema,
} from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'

export const getQbtcSigningInputs = ({
  keysignPayload,
}: {
  keysignPayload: KeysignPayload
}): Uint8Array[] => [toBinary(KeysignPayloadSchema, keysignPayload)]
