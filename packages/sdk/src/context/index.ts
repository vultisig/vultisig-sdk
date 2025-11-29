/**
 * Context module exports
 *
 * Provides the SdkContext pattern for instance-scoped dependency injection.
 */

// Core types and interfaces
export type { SdkConfigOptions, SdkContext, VaultContext, WasmProvider } from './SdkContext'

// Builder and factory
export {
  createSdkContext,
  type PasswordCacheConfig,
  SdkContextBuilder,
  type SdkContextBuilderOptions,
  type ServerEndpoints,
} from './SdkContextBuilder'

// Shared WASM runtime (process singleton)
export { SharedWasmRuntime } from './SharedWasmRuntime'
