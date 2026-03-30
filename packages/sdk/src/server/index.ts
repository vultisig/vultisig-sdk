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

// Re-export core fast vault API functions directly
export { batchReshareWithServer } from '@vultisig/core-mpc/fast/api/batchReshareWithServer'
export { createVaultWithServer } from '@vultisig/core-mpc/fast/api/createVaultWithServer'
export { getVaultFromServer } from '@vultisig/core-mpc/fast/api/getVaultFromServer'
export { keyImportWithServer } from '@vultisig/core-mpc/fast/api/keyImportWithServer'
export { reshareWithServer } from '@vultisig/core-mpc/fast/api/reshareWithServer'
export { sequentialKeyImportWithServer } from '@vultisig/core-mpc/fast/api/sequentialKeyImportWithServer'
export { setupVaultWithServer } from '@vultisig/core-mpc/fast/api/setupVaultWithServer'
export { signWithServer } from '@vultisig/core-mpc/fast/api/signWithServer'
export { verifyVaultEmailCode } from '@vultisig/core-mpc/fast/api/verifyVaultEmailCode'

// Re-export core relay functions directly
export { deleteMpcRelayMessage } from '@vultisig/core-mpc/message/relay/delete'
export { getMpcRelayMessages } from '@vultisig/core-mpc/message/relay/get'
export { sendMpcRelayMessage } from '@vultisig/core-mpc/message/relay/send'
export { waitForSetupMessage } from '@vultisig/core-mpc/message/setup/get'
export { uploadMpcSetupMessage } from '@vultisig/core-mpc/message/setup/upload'
export { joinMpcSession } from '@vultisig/core-mpc/session/joinMpcSession'

// Re-export message server functions
export { fromMpcServerMessage, toMpcServerMessage } from '@vultisig/core-mpc/message/server'

// Re-export types
export type { MpcRelayMessage } from '@vultisig/core-mpc/message/relay'
