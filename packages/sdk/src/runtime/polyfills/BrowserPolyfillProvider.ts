import { polyfillRegistry } from './registry'

/**
 * Browser polyfills.
 *
 * Browser environments have all required globals, so no polyfills needed.
 * This provider exists for completeness and future extensibility.
 */
async function initializeBrowserPolyfills(): Promise<void> {
  // No polyfills needed for browser
}

// Self-register browser polyfill provider
polyfillRegistry.register({
  name: 'browser',
  priority: 90,
  isSupported: () => {
    return typeof window !== 'undefined' && typeof document !== 'undefined'
  },
  initialize: initializeBrowserPolyfills,
})
