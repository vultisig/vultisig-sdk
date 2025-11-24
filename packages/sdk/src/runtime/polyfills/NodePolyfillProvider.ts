import { polyfillRegistry } from './registry'

/**
 * Node.js-specific polyfills.
 *
 * Sets up required globals that are missing in Node.js but expected by some chains:
 * - WebSocket (required for Ripple and other chains)
 */
async function initializeNodePolyfills(): Promise<void> {
  // Polyfill WebSocket if not already available
  if (typeof globalThis.WebSocket === 'undefined') {
    try {
      // Import ws package - need to use require to avoid browser stub
      // Dynamic import in Node.js can resolve to ws/browser.js which throws
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Required to avoid browser stub resolution
      const ws = require('ws')
      // @ts-ignore - Adding WebSocket to global
      globalThis.WebSocket = ws
    } catch {
      // ws package not installed - log a warning but don't fail
      console.warn(
        '[Vultisig SDK] WebSocket not available in Node.js. ' +
          'Some chains (like Ripple) may not work correctly. ' +
          'Install "ws" package to enable WebSocket support: npm install ws'
      )
    }
  }
}

// Self-register Node.js polyfill provider
polyfillRegistry.register({
  name: 'node',
  priority: 100,
  isSupported: () => {
    return typeof process !== 'undefined' && process.versions?.node !== undefined && typeof window === 'undefined'
  },
  initialize: initializeNodePolyfills,
})
