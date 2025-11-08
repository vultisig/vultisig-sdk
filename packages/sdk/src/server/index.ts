/**
 * Server module - Public API
 *
 * ServerManager is INTERNAL ONLY - users should access server-assisted signing via:
 * vault.sign('fast', payload)
 *
 * This module exports:
 * - Utilities (generateSessionId, pingServer, etc.)
 * - Fast Vault API functions (setupVaultWithServer, signWithServer, etc.)
 * - Relay functions (sendMpcRelayMessage, getMpcRelayMessages, etc.)
 */

// ServerManager is internal-only - not exported
// import { ServerManager } from './ServerManager'

// Server utilities removed - replaced by core/lib utilities
// Users should use core utilities directly:
// - generateLocalPartyId from '@core/mpc/devices/localPartyId'
// - getHexEncodedRandomBytes from '@lib/utils/crypto/getHexEncodedRandomBytes'
// - crypto.randomUUID() for session IDs

// Re-export core fast vault API functions directly
export { getVaultFromServer } from '@core/mpc/fast/api/getVaultFromServer'
export { reshareWithServer } from '@core/mpc/fast/api/reshareWithServer'
export { setupVaultWithServer } from '@core/mpc/fast/api/setupVaultWithServer'
export { signWithServer } from '@core/mpc/fast/api/signWithServer'
export { verifyVaultEmailCode } from '@core/mpc/fast/api/verifyVaultEmailCode'

// Re-export core relay functions directly
export { deleteMpcRelayMessage } from '@core/mpc/message/relay/delete'
export { getMpcRelayMessages } from '@core/mpc/message/relay/get'
export { sendMpcRelayMessage } from '@core/mpc/message/relay/send'
export { waitForSetupMessage } from '@core/mpc/message/setup/get'
export { uploadMpcSetupMessage } from '@core/mpc/message/setup/upload'
export { joinMpcSession } from '@core/mpc/session/joinMpcSession'

// Re-export message server functions
export {
  fromMpcServerMessage,
  toMpcServerMessage,
} from '@core/mpc/message/server'

// Re-export types
export type { MpcRelayMessage } from '@core/mpc/message/relay'
