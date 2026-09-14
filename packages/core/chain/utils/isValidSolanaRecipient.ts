import { ed25519 } from '@noble/curves/ed25519.js'
import bs58 from 'bs58'

/** Check wallet-recipient curve membership without importing the Solana RPC stack. */
export const isValidSolanaRecipient = (address: string): boolean => {
  try {
    ed25519.Point.fromBytes(bs58.decode(address.trim()))
    return true
  } catch {
    return false
  }
}
