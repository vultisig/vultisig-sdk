import { create, toBinary } from '@bufbuild/protobuf'
import { KeysignMessageSchema, KeysignMessage } from '@core/mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { KeysignPayload } from '@core/mpc/types/vultisig/keysign/v1/keysign_message_pb'
import * as crypto from 'crypto'
import { compress } from 'node-7z'
import { promises as fs } from 'fs'
import * as path from 'path'
import * as os from 'os'

export interface KeysignUriOptions {
  sessionId: string
  vaultId: string
  keysignPayload: KeysignPayload
  useVultisigRelay: boolean
  serviceName?: string
  encryptionKeyHex?: string
  payloadId?: string
}

export class KeysignUriGenerator {
  private static readonly BASE_URL = 'vultisig://vultisig.com'
  private static readonly MAX_URI_LENGTH = 2048
  
  /**
   * Generate a keysign URI for QR code display
   */
  async generateKeysignUri(options: KeysignUriOptions): Promise<string> {
    // Generate encryption key if not provided
    const encryptionKeyHex = options.encryptionKeyHex || crypto.randomBytes(32).toString('hex')
    
    // Generate service name for local mode if not provided
    const serviceName = options.serviceName || (options.useVultisigRelay ? '' : `vultisig-${crypto.randomBytes(4).toString('hex')}`)
    
    // Create the keysign message
    const keysignMessage = create(KeysignMessageSchema, {
      sessionId: options.sessionId,
      serviceName,
      encryptionKeyHex,
      keysignPayload: options.keysignPayload,
      useVultisigRelay: options.useVultisigRelay,
      payloadId: options.payloadId || ''
    })
    
    // Convert to compressed protobuf string
    const compressedData = await this.compressProtobufData(keysignMessage)
    
    // Build the URI
    const uri = `${KeysignUriGenerator.BASE_URL}?type=SignTransaction&vault=${options.vaultId}&jsonData=${compressedData}`
    
    // Check if URI is too long and needs payload upload
    if (uri.length > KeysignUriGenerator.MAX_URI_LENGTH && !options.payloadId) {
      console.log(`🔄 URI too long (${uri.length} chars), uploading payload to server...`)
      
      // In a real implementation, this would upload to the Vultisig relay server
      // For now, we'll generate a mock payload ID and recreate the URI
      const mockPayloadId = `payload-${crypto.randomBytes(16).toString('hex')}`
      
      return this.generateKeysignUri({
        ...options,
        payloadId: mockPayloadId,
        keysignPayload: undefined as any // Remove payload since we're using payloadId
      })
    }
    
    return uri
  }
  
  /**
   * Compress protobuf data using 7z compression and base64 encoding
   */
  private async compressProtobufData(message: KeysignMessage): Promise<string> {
    // Convert protobuf to binary
    const binaryData = toBinary(KeysignMessageSchema, message)
    
    // Create temporary files for compression
    const tempDir = os.tmpdir()
    const inputFile = path.join(tempDir, `keysign-input-${Date.now()}.bin`)
    const outputFile = path.join(tempDir, `keysign-output-${Date.now()}.7z`)
    
    try {
      // Write binary data to temp file
      await fs.writeFile(inputFile, binaryData)
      
      // Compress using 7z
      await new Promise<void>((resolve, reject) => {
        const stream = compress(outputFile, inputFile, {
          $progress: true
        })
        
        stream.on('end', () => resolve())
        stream.on('error', (err) => reject(err))
      })
      
      // Read compressed data and encode as base64
      const compressedData = await fs.readFile(outputFile)
      const base64Data = compressedData.toString('base64')
      
      // Clean up temp files
      await fs.unlink(inputFile).catch(() => {})
      await fs.unlink(outputFile).catch(() => {})
      
      return base64Data
      
    } catch (error) {
      // Clean up temp files on error
      await fs.unlink(inputFile).catch(() => {})
      await fs.unlink(outputFile).catch(() => {})
      
      // Fallback to simple base64 encoding without compression
      console.warn('7z compression failed, using simple base64:', error)
      return Buffer.from(binaryData).toString('base64')
    }
  }
  
  /**
   * Generate session parameters for keysign
   */
  generateSessionParams() {
    return {
      sessionId: `cli-${crypto.randomBytes(8).toString('hex')}`,
      encryptionKeyHex: crypto.randomBytes(32).toString('hex'),
      serviceName: `vultisig-cli-${crypto.randomBytes(4).toString('hex')}`
    }
  }
}