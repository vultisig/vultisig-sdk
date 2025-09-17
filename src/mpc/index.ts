/**
 * MPC (Multi-Party Computation) operations module
 * Handles keygen, keysign, and reshare operations
 */

export { MPCManager } from './MPCManager'

// Re-export available MPC types
export type { MpcServerType } from '../core/mpc/MpcServerType'

// Stub types for compilation - actual types come from core workspace
export type KeysignResult = any
export type KeysignSignature = any
export type KeygenOperation = any
export type KeygenStep = any
export type KeygenType = any
export type ReshareType = any

// Dynamic exports that will be available at runtime
export const toLibType = async (input: any): Promise<any> => {
  const { toLibType } = await import('@core/mpc/types/utils/libType')
  return toLibType(input)
}

export const toTssType = async (input: any): Promise<any> => {
  const { toTssType } = await import('@core/mpc/types/utils/tssType')
  return toTssType(input)
}

export const generateLocalPartyId = async (device?: any): Promise<any> => {
  const { generateLocalPartyId } = await import('@core/mpc/devices/localPartyId')
  // TODO: Pass proper device parameter when available
  return generateLocalPartyId(device || { name: 'SDK-Device' })
}