/**
 * Sign Command - Sign arbitrary pre-hashed bytes
 *
 * Used for signing transactions constructed externally (e.g., with ethers.js or bitcoinjs-lib).
 * The user provides pre-hashed data and receives a signature in base64 format.
 */
import type { VaultBase } from '@vultisig/sdk'
import { Chain } from '@vultisig/sdk'
import qrcode from 'qrcode-terminal'

import type { CommandContext } from '../core'
import { ensureVaultUnlocked } from '../core'
import { createSpinner, info, isJsonOutput, isSilent, outputJson, printResult } from '../lib/output'

/**
 * Parameters for signing arbitrary bytes
 */
export type SignBytesParams = {
  chain: Chain
  bytes: string // Base64-encoded pre-hashed data
  password?: string
  signal?: AbortSignal
}

/**
 * Result of signing operation
 */
export type SignBytesResult = {
  signature: string // Base64-encoded signature
  recovery?: number
  format: string
}

/**
 * Execute sign bytes command - sign pre-hashed data
 */
export async function executeSignBytes(ctx: CommandContext, params: SignBytesParams): Promise<SignBytesResult> {
  const vault = await ctx.ensureActiveVault()

  if (!Object.values(Chain).includes(params.chain)) {
    throw new Error(`Invalid chain: ${params.chain}`)
  }

  return signBytes(vault, params)
}

/**
 * Sign pre-hashed bytes with vault
 */
export async function signBytes(vault: VaultBase, params: SignBytesParams): Promise<SignBytesResult> {
  // Decode base64 input to get the raw hash bytes
  const hashBytes = Buffer.from(params.bytes, 'base64')

  // Pre-unlock vault before signing
  await ensureVaultUnlocked(vault, params.password)

  const isSecureVault = vault.type === 'secure'
  const signSpinner = createSpinner(isSecureVault ? 'Preparing secure signing session...' : 'Signing bytes...')

  // Setup event handlers
  vault.on('signingProgress', ({ step }: any) => {
    signSpinner.text = `${step.message} (${step.progress}%)`
  })

  // For secure vaults, handle QR code display and device joining
  if (isSecureVault) {
    vault.on('qrCodeReady', ({ qrPayload }: { qrPayload: string }) => {
      if (isJsonOutput()) {
        // JSON mode: include QR payload in structured output
        printResult(JSON.stringify({ qrPayload }))
      } else if (isSilent()) {
        printResult(`QR Payload: ${qrPayload}`)
      } else {
        signSpinner.stop()
        info('\nScan this QR code with your Vultisig mobile app to sign:')
        qrcode.generate(qrPayload, { small: true })
        info(`\nOr use this URL: ${qrPayload}\n`)
        signSpinner.start('Waiting for devices to join signing session...')
      }
    })

    vault.on(
      'deviceJoined',
      ({ deviceId, totalJoined, required }: { deviceId: string; totalJoined: number; required: number }) => {
        if (!isSilent()) {
          signSpinner.text = `Device joined: ${totalJoined}/${required} (${deviceId})`
        } else if (!isJsonOutput()) {
          printResult(`Device joined: ${totalJoined}/${required}`)
        }
      }
    )
  }

  try {
    const signature = await vault.signBytes(
      {
        data: hashBytes,
        chain: params.chain,
      },
      { signal: params.signal }
    )

    signSpinner.succeed('Bytes signed')

    // Convert signature to base64 for CLI output
    // The signature.signature is hex-encoded, convert to base64
    const sigHex = signature.signature.startsWith('0x') ? signature.signature.slice(2) : signature.signature
    const sigBase64 = Buffer.from(sigHex, 'hex').toString('base64')

    const result: SignBytesResult = {
      signature: sigBase64,
      recovery: signature.recovery,
      format: signature.format,
    }

    // Output result
    if (isJsonOutput()) {
      outputJson(result)
    } else {
      printResult(`Signature: ${result.signature}`)
      if (result.recovery !== undefined) {
        printResult(`Recovery: ${result.recovery}`)
      }
      printResult(`Format: ${result.format}`)
    }

    return result
  } finally {
    vault.removeAllListeners('signingProgress')
    if (isSecureVault) {
      vault.removeAllListeners('qrCodeReady')
      vault.removeAllListeners('deviceJoined')
    }
  }
}
