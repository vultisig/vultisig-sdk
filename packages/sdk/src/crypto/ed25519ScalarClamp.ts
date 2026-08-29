/**
 * Ed25519 scalar clamping utility for Schnorr key import.
 *
 * Keep the SDK export as a compatibility surface while sharing the canonical
 * implementation with Core MPC.
 */
export { clampThenUniformScalar } from '@vultisig/core-mpc/utils/ed25519ScalarClamp'
