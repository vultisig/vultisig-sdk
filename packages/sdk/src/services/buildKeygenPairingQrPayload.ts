import { create, toBinary } from '@bufbuild/protobuf'
import { toCompressedString } from '@vultisig/core-chain/utils/protobuf/toCompressedString'
import { getSevenZip } from '@vultisig/core-mpc/compression/getSevenZip'
import { KeygenMessageSchema } from '@vultisig/core-mpc/types/vultisig/keygen/v1/keygen_message_pb'
import { LibType } from '@vultisig/core-mpc/types/vultisig/keygen/v1/lib_type_message_pb'

/**
 * Build `vultisig://?type=NewVault&tssType=Keygen&jsonData=...` QR payload for mobile pairing.
 * Caller supplies {@link LibType} (DKLS keygen vs KEYIMPORT) and optional `chains` for import flows.
 */
export async function buildKeygenPairingQrPayload(params: {
  sessionId: string
  hexEncryptionKey: string
  hexChainCode: string
  localPartyId: string
  vaultName: string
  libType: LibType
  chains?: readonly string[]
  tssBatching?: boolean
}): Promise<string> {
  const keygenMessage = create(KeygenMessageSchema, {
    sessionId: params.sessionId,
    hexChainCode: params.hexChainCode,
    serviceName: params.localPartyId,
    encryptionKeyHex: params.hexEncryptionKey,
    useVultisigRelay: true,
    vaultName: params.vaultName,
    libType: params.libType,
    ...(params.chains !== undefined ? { chains: [...params.chains] } : {}),
  })

  const binary = toBinary(KeygenMessageSchema, keygenMessage)
  const sevenZip = await getSevenZip()
  const compressedData = toCompressedString({ sevenZip, binary })
  const tssBatchingParam = params.tssBatching ? '&tssBatching=1' : ''
  return `vultisig://?type=NewVault&tssType=Keygen&jsonData=${encodeURIComponent(compressedData)}${tssBatchingParam}`
}
