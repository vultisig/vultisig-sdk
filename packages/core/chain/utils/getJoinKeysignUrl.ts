import { create, toBinary } from '@bufbuild/protobuf'
import { toCompressedString } from './protobuf/toCompressedString'
import { deepLinkBaseUrl } from '../../config'
import { getSevenZip } from '../../mpc/compression/getSevenZip'
import { uploadPayloadToServer } from '../../mpc/keygen/server/uploadPayloadToServer'
import { KeysignMessagePayload } from '../../mpc/keysign/keysignPayload/KeysignMessagePayload'
import { MpcServerType, mpcServerUrl } from '../../mpc/MpcServerType'
import {
  KeysignMessageSchema,
  KeysignPayloadSchema,
} from '../../mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { matchRecordUnion } from '../../../lib/utils/matchRecordUnion'
import { addQueryParams } from '../../../lib/utils/query/addQueryParams'

export type GetJoinKeysignUrlInput = {
  serverType: MpcServerType
  serviceName: string
  sessionId: string
  hexEncryptionKey: string
  payload?: KeysignMessagePayload
  payloadId?: string
  vaultId: string
}

const urlMaxLength = 2048

export const getJoinKeysignUrl = async ({
  serverType,
  serviceName,
  sessionId,
  hexEncryptionKey,
  payload,
  payloadId,
  vaultId,
}: GetJoinKeysignUrlInput): Promise<string> => {
  const keysignMessage = create(KeysignMessageSchema, {
    sessionId,
    serviceName: serviceName,
    encryptionKeyHex: hexEncryptionKey,
    useVultisigRelay: serverType === 'relay',
    payloadId,
  })

  if (payload) {
    matchRecordUnion(payload, {
      keysign: keysignPayload => {
        keysignMessage.keysignPayload = keysignPayload
      },
      custom: customPayload => {
        keysignMessage.customMessagePayload = customPayload
      },
    })
  }

  const binary = toBinary(KeysignMessageSchema, keysignMessage)

  const sevenZip = await getSevenZip()

  const jsonData = toCompressedString({
    sevenZip,
    binary,
  })

  const urlWithPayload = addQueryParams(deepLinkBaseUrl, {
    type: 'SignTransaction',
    vault: vaultId,
    jsonData,
  })

  if (payload && 'keysign' in payload && urlWithPayload.length > urlMaxLength) {
    const binary = toBinary(KeysignPayloadSchema, payload.keysign)
    const compressedPayload = toCompressedString({
      sevenZip,
      binary,
    })
    const payloadId = await uploadPayloadToServer({
      payload: compressedPayload,
      serverUrl: mpcServerUrl[serverType],
    })

    return getJoinKeysignUrl({
      serverType,
      serviceName,
      sessionId,
      hexEncryptionKey,
      payloadId,
      vaultId,
    })
  }

  return urlWithPayload
}
