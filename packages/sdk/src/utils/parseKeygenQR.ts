/**
 * Parse QR code payload from keygen/key import session
 *
 * The QR payload format is:
 * vultisig://?type=NewVault&tssType=Keygen&jsonData=<compressed_base64>
 *
 * The jsonData is a compressed protobuf (KeygenMessage) containing session params.
 */
import { fromBinary } from '@bufbuild/protobuf'
import { Chain } from '@core/chain/Chain'
import { getSevenZip } from '@core/mpc/compression/getSevenZip'
import { KeygenMessageSchema } from '@core/mpc/types/vultisig/keygen/v1/keygen_message_pb'
import { LibType } from '@core/mpc/types/vultisig/keygen/v1/lib_type_message_pb'
import { attempt } from '@lib/utils/attempt'

/**
 * Parsed keygen QR payload
 */
export type ParsedKeygenQR = {
  /** Session ID for relay coordination */
  sessionId: string
  /** Encryption key for MPC messages (hex) */
  hexEncryptionKey: string
  /** BIP32 chain code (hex) */
  hexChainCode: string
  /** Party ID of the initiator device */
  initiatorPartyId: string
  /** Name of the vault being created */
  vaultName: string
  /** Chains to import (for key import) */
  chains: Chain[]
  /** Type of keygen operation */
  libType: 'GG20' | 'DKLS' | 'KEYIMPORT'
  /** Whether to use Vultisig relay server */
  useVultisigRelay: boolean
}

/**
 * Decompress LZMA/XZ compressed data using 7z-wasm
 */
async function decompressData(compressedBase64: string): Promise<Uint8Array> {
  const sevenZip = await getSevenZip()
  const compressedData = Buffer.from(compressedBase64, 'base64')

  const archiveName = 'compressed.xz'
  // Possible output filenames - 7z may use original name or archive name minus extension
  const possibleOutputFiles = ['data.bin', 'compressed']

  try {
    // Write compressed data as .xz archive
    sevenZip.FS.writeFile(archiveName, compressedData)

    // Extract the archive using 'e' command (extract without paths)
    sevenZip.callMain(['e', archiveName, '-y', '-o.'])

    // Try to read from possible output filenames
    for (const filename of possibleOutputFiles) {
      const { data } = attempt(() => sevenZip.FS.readFile(filename))
      if (data) {
        // Cleanup the extracted file
        attempt(() => sevenZip.FS.unlink(filename))
        return new Uint8Array(data)
      }
    }

    throw new Error('Decompression failed: no output file found')
  } finally {
    // Cleanup archive
    attempt(() => sevenZip.FS.unlink(archiveName))
  }
}

/**
 * Set of valid Chain values for O(1) lookup
 */
const VALID_CHAINS = new Set<string>(Object.values(Chain))

/**
 * Type guard to check if a string is a valid Chain value
 */
function isValidChain(value: string): value is Chain {
  return VALID_CHAINS.has(value)
}

/**
 * Convert LibType enum to string
 */
function libTypeToString(libType: LibType): 'GG20' | 'DKLS' | 'KEYIMPORT' {
  switch (libType) {
    case LibType.GG20:
      return 'GG20'
    case LibType.DKLS:
      return 'DKLS'
    case LibType.KEYIMPORT:
      return 'KEYIMPORT'
    default:
      throw new Error(`Unsupported libType: ${libType}`)
  }
}

/**
 * Parse a keygen/key import QR code payload
 *
 * @param qrPayload - The full QR code content (vultisig://...)
 * @returns Parsed session parameters
 * @throws Error if payload is invalid or cannot be parsed
 *
 * @example
 * ```typescript
 * const params = await parseKeygenQR(qrPayload)
 * console.log(params.sessionId, params.vaultName)
 * ```
 */
export async function parseKeygenQR(qrPayload: string): Promise<ParsedKeygenQR> {
  // Parse the URL
  if (!qrPayload.startsWith('vultisig://')) {
    throw new Error('Invalid QR payload: must start with vultisig://')
  }

  // Extract query parameters
  const urlParts = qrPayload.split('?')
  if (urlParts.length < 2) {
    throw new Error('Invalid QR payload: missing query parameters')
  }

  const params = new URLSearchParams(urlParts[1])
  const jsonData = params.get('jsonData')

  if (!jsonData) {
    throw new Error('Invalid QR payload: missing jsonData parameter')
  }

  // URL decode and decompress
  const decodedData = decodeURIComponent(jsonData)
  const binaryData = await decompressData(decodedData)

  // Parse protobuf
  const keygenMessage = fromBinary(KeygenMessageSchema, binaryData)

  // Validate and filter chains to only include recognized Chain values
  const validatedChains = keygenMessage.chains.filter(isValidChain)
  const invalidChains = keygenMessage.chains.filter(c => !isValidChain(c))
  if (invalidChains.length > 0) {
    console.warn(`QR payload contains unrecognized chains: ${invalidChains.join(', ')}`)
  }

  return {
    sessionId: keygenMessage.sessionId,
    hexEncryptionKey: keygenMessage.encryptionKeyHex,
    hexChainCode: keygenMessage.hexChainCode,
    initiatorPartyId: keygenMessage.serviceName,
    vaultName: keygenMessage.vaultName,
    chains: validatedChains,
    libType: libTypeToString(keygenMessage.libType),
    useVultisigRelay: keygenMessage.useVultisigRelay,
  }
}
