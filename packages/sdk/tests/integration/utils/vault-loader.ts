import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { Vultisig } from '../../../packages/sdk/VultisigSDK'
import type { Vault } from '../../../src/vault/Vault'

const VAULT_FILE_PATH = path.join(
  __dirname,
  '..',
  'config',
  'test-vault.json.enc'
)
const ALGORITHM = 'aes-256-gcm'
const KEY_LENGTH = 32 // 256 bits
const IV_LENGTH = 16 // 128 bits
const AUTH_TAG_LENGTH = 16 // 128 bits
const SALT_LENGTH = 64

/**
 * Derive encryption key from password using PBKDF2
 */
function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, 100000, KEY_LENGTH, 'sha256')
}

/**
 * Encrypt vault data with password
 */
export function encryptVault(vaultData: string, password: string): Buffer {
  const salt = crypto.randomBytes(SALT_LENGTH)
  const key = deriveKey(password, salt)
  const iv = crypto.randomBytes(IV_LENGTH)

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([
    cipher.update(vaultData, 'utf8'),
    cipher.final(),
  ])

  const authTag = cipher.getAuthTag()

  // Format: [salt][iv][authTag][encrypted data]
  return Buffer.concat([salt, iv, authTag, encrypted])
}

/**
 * Decrypt vault data with password
 */
export function decryptVault(encryptedData: Buffer, password: string): string {
  // Extract components
  const salt = encryptedData.subarray(0, SALT_LENGTH)
  const iv = encryptedData.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH)
  const authTag = encryptedData.subarray(
    SALT_LENGTH + IV_LENGTH,
    SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH
  )
  const encrypted = encryptedData.subarray(
    SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH
  )

  const key = deriveKey(password, salt)

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ])

  return decrypted.toString('utf8')
}

/**
 * Save encrypted vault file
 */
export function saveEncryptedVault(vaultData: string, password: string): void {
  const encrypted = encryptVault(vaultData, password)
  fs.writeFileSync(VAULT_FILE_PATH, encrypted)
  console.log('Encrypted vault saved to:', VAULT_FILE_PATH)
}

/**
 * Load and decrypt test vault
 */
export function loadEncryptedVault(password: string): string {
  if (!fs.existsSync(VAULT_FILE_PATH)) {
    throw new Error(
      `Vault file not found at ${VAULT_FILE_PATH}. Please create an encrypted vault file first. See README.md for instructions.`
    )
  }

  const encryptedData = fs.readFileSync(VAULT_FILE_PATH)
  try {
    return decryptVault(encryptedData, password)
  } catch (error) {
    throw new Error(
      'Failed to decrypt vault. Please check your VAULT_PASSWORD is correct.'
    )
  }
}

/**
 * Initialize SDK and load test vault
 */
export async function getTestVault(password: string): Promise<Vault> {
  // Initialize SDK
  const sdk = new Vultisig()
  await sdk.initialize()

  // Load encrypted vault data
  const vaultData = loadEncryptedVault(password)

  // Parse vault data (assuming it's exported vault JSON)
  const vaultBlob = new Blob([vaultData], { type: 'application/json' })

  // Add vault to SDK
  const vault = await sdk.addVault(vaultBlob, password)

  return vault
}

/**
 * Helper function to create initial encrypted vault file
 * This should be run manually by developers to set up the test vault
 *
 * Usage:
 * ```
 * import { createTestVault } from './vault-loader';
 * await createTestVault('my-test-vault', 'my-secure-password');
 * ```
 */
export async function createTestVault(
  vaultName: string,
  password: string
): Promise<void> {
  console.log('Creating test vault...')

  // Initialize SDK
  const sdk = new Vultisig()
  await sdk.initialize()

  // Create a fast vault
  console.log('Creating fast vault (requires email verification)...')
  const vault = await sdk.createFastVault({
    name: vaultName,
    email: 'test@example.com', // You'll need to verify this email
    password: password,
  })

  console.log('Vault created successfully!')
  console.log('Vault ID:', vault.id)
  console.log('Please fund the following addresses:')

  // Show addresses for key chains
  const solAddress = await vault.address('Solana')
  console.log('Solana:', solAddress)

  // Export vault
  const exported = await vault.export(password)
  const vaultData = await exported.text()

  // Encrypt and save
  saveEncryptedVault(vaultData, password)

  console.log('\nTest vault setup complete!')
  console.log('Next steps:')
  console.log('1. Fund the Solana address with at least $2 worth of SOL')
  console.log('2. Set VAULT_PASSWORD in tests/integration/config/.env')
  console.log('3. Run integration tests with: yarn test:integration')
}
