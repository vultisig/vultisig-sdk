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
import { ConfirmationRequiredError } from '../core/errors'
import {
  createSpinner,
  info,
  isJsonOutput,
  isNonInteractive,
  isSilent,
  outputJson,
  printResult,
  warn,
} from '../lib/output'
import { confirmTransaction } from '../ui'

/**
 * Parameters for signing arbitrary bytes
 */
export type SignBytesParams = {
  chain: Chain
  bytes: string // Base64-encoded pre-hashed data
  password?: string
  /**
   * Skip the interactive confirmation prompt. Required in non-interactive
   * contexts (piped / redirected / CI) because signBytes produces a valid
   * signature on ANY 32-byte input — a signed hash CAN be a tx digest that
   * moves funds. Explicit opt-in is required so a script bug or shell
   * injection cannot silently produce arbitrary sigs. bead vultisig-j2njo.
   */
  yes?: boolean
  signal?: AbortSignal
}

/**
 * Result of signing operation
 */
export type SignBytesResult = {
  signature: string // Base64-encoded signature
  recovery?: number
  format: string
  mldsaSignature?: string // Hex-encoded ML-DSA-44 post-quantum signature
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

  // Fund-safety confirmation gate (bead vultisig-j2njo). signBytes produces a
  // valid signature on ANY 32-byte input — a signed hash CAN be a tx digest
  // that moves funds. Send and swap both gate on --yes + interactive prompt
  // for exactly this reason; the sign primitive needs the same protection so
  // a script bug, shell injection, or malicious CLI wrapper reaching --bytes
  // cannot silently produce arbitrary sigs.
  if (!params.yes) {
    if (isNonInteractive()) {
      throw new ConfirmationRequiredError(
        'sign requires confirmation.',
        'Pass --yes to confirm. signBytes produces a signature on ANY 32-byte input; be sure the bytes are what you intend to sign.'
      )
    }
    // REVIEW FIX (j2njo): the header used to be the string literal '32 bytes' regardless of the
    // payload. `Buffer.from(x, 'base64')` NEVER throws - it silently drops anything outside the
    // alphabet - so the one line whose entire job is to tell the operator what they are about to
    // sign could be wrong at the moment they read it. A 55-byte payload rendered '32 bytes', and
    // non-base64 garbage rendered '32 bytes' above an empty `Bytes: 0x` and still proceeded on
    // confirm: the anti-blind-signing prompt doing blind signing. Report what we DECODED.
    const hashHex = hashBytes.toString('hex')
    warn(`\n⚠  You are about to sign ${hashBytes.length} bytes with your MPC vault.`)
    warn(`   Chain:  ${params.chain}`)
    warn(`   Bytes:  0x${hashHex}`)
    // A digest that decoded to nothing is never something to sign. Refuse rather than render an
    // empty `Bytes: 0x` line and let a confirm through - there is nothing for the operator to check.
    if (hashBytes.length === 0) {
      throw new ConfirmationRequiredError(
        'sign refused: --bytes did not decode to any data.',
        "Pass a base64-encoded digest. Buffer.from(..., 'base64') silently drops invalid characters, so a malformed value decodes to an empty payload rather than erroring."
      )
    }
    // A non-32-byte payload is not necessarily wrong, but the operator must be told, because every
    // chain digest this primitive is meant for is 32 bytes.
    if (hashBytes.length !== 32) {
      warn(`   NOTE:   this is NOT a 32-byte digest (decoded ${hashBytes.length} bytes) - double-check the input.`)
    }
    warn(`   This is IRREVERSIBLE. If these bytes are a valid tx digest, funds CAN move.\n`)
    const confirmed = await confirmTransaction()
    if (!confirmed) {
      throw new ConfirmationRequiredError('Sign declined at the confirmation prompt')
    }
  }

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
      mldsaSignature: signature.mldsaSignature,
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
      if (result.mldsaSignature) {
        printResult(`ML-DSA-44 Signature: ${result.mldsaSignature.substring(0, 40)}...`)
      }
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
