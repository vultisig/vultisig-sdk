import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  detectEnvironment,
  getEnvironmentInfo,
  isBrowser,
  isChromeExtension,
  isChromeExtensionPage,
  isChromeExtensionServiceWorker,
  isElectron,
  isElectronMain,
  isElectronRenderer,
  isNode,
  isWorker,
} from '@/runtime/environment'

describe('Environment Detection', () => {
  // Store original values
  let originalWindow: any
  let originalDocument: any
  let originalProcess: any
  let originalChrome: any
  let originalNavigator: any
  let originalSelf: any
  let originalGlobal: any
  let originalServiceWorkerGlobalScope: any
  let originalWorkerGlobalScope: any

  beforeEach(() => {
    // Store originals
    originalWindow = (globalThis as any).window
    originalDocument = (globalThis as any).document
    originalProcess = (globalThis as any).process
    originalChrome = (globalThis as any).chrome
    originalNavigator = (globalThis as any).navigator
    originalSelf = (globalThis as any).self
    originalGlobal = (globalThis as any).global
    originalServiceWorkerGlobalScope = (globalThis as any).ServiceWorkerGlobalScope
    originalWorkerGlobalScope = (globalThis as any).WorkerGlobalScope

    // Clean slate for each test
    delete (globalThis as any).window
    delete (globalThis as any).document
    delete (globalThis as any).process
    delete (globalThis as any).chrome
    delete (globalThis as any).navigator
    delete (globalThis as any).ServiceWorkerGlobalScope
    delete (globalThis as any).WorkerGlobalScope
  })

  afterEach(() => {
    // Restore originals
    ;(globalThis as any).window = originalWindow
    ;(globalThis as any).document = originalDocument
    ;(globalThis as any).process = originalProcess
    ;(globalThis as any).chrome = originalChrome
    ;(globalThis as any).navigator = originalNavigator
    ;(globalThis as any).self = originalSelf
    ;(globalThis as any).global = originalGlobal
    ;(globalThis as any).ServiceWorkerGlobalScope = originalServiceWorkerGlobalScope
    ;(globalThis as any).WorkerGlobalScope = originalWorkerGlobalScope
  })

  describe('detectEnvironment()', () => {
    describe('Node.js environment', () => {
      it('should detect Node.js environment', () => {
        ;(globalThis as any).process = {
          versions: { node: '18.0.0' },
        }

        const env = detectEnvironment()
        expect(env).toBe('node')
      })

      it('should detect Node.js even without window', () => {
        ;(globalThis as any).process = {
          versions: { node: '16.0.0' },
        }
        delete (globalThis as any).window

        const env = detectEnvironment()
        expect(env).toBe('node')
      })
    })

    describe('Browser environment', () => {
      it('should detect browser environment', () => {
        ;(globalThis as any).window = { location: { href: 'http://localhost' } }
        ;(globalThis as any).document = { createElement: vi.fn() }

        const env = detectEnvironment()
        expect(env).toBe('browser')
      })

      it('should detect browser with all typical browser APIs', () => {
        ;(globalThis as any).window = {}
        ;(globalThis as any).document = {}
        ;(globalThis as any).navigator = { userAgent: 'Mozilla/5.0...' }

        const env = detectEnvironment()
        expect(env).toBe('browser')
      })
    })

    describe('Electron environment', () => {
      it('should detect Electron main process', () => {
        ;(globalThis as any).process = {
          versions: {
            node: '16.0.0',
            electron: '22.0.0',
          },
          type: 'browser', // Main process type
        }

        const env = detectEnvironment()
        expect(env).toBe('electron-main')
      })

      it('should detect Electron renderer process', () => {
        ;(globalThis as any).process = {
          versions: {
            node: '16.0.0',
            electron: '22.0.0',
          },
          type: 'renderer',
        }
        ;(globalThis as any).window = {}

        const env = detectEnvironment()
        expect(env).toBe('electron-renderer')
      })

      it('should fallback to renderer when window exists but type is not set', () => {
        ;(globalThis as any).process = {
          versions: {
            node: '16.0.0',
            electron: '22.0.0',
          },
          // No type property
        }
        ;(globalThis as any).window = {}

        const env = detectEnvironment()
        expect(env).toBe('electron-renderer')
      })

      it('should fallback to main when no window and type is not set', () => {
        ;(globalThis as any).process = {
          versions: {
            node: '16.0.0',
            electron: '22.0.0',
          },
          // No type property and no window
        }

        const env = detectEnvironment()
        expect(env).toBe('electron-main')
      })
    })

    describe('Chrome Extension environment', () => {
      it('should detect chrome extension page', () => {
        ;(globalThis as any).chrome = {
          runtime: { id: 'test-extension-id' },
        }

        const env = detectEnvironment()
        expect(env).toBe('chrome-extension')
      })

      it('should detect chrome extension service worker', () => {
        // Mock ServiceWorkerGlobalScope
        class MockServiceWorkerGlobalScope {}
        ;(globalThis as any).ServiceWorkerGlobalScope = MockServiceWorkerGlobalScope
        ;(globalThis as any).self = new MockServiceWorkerGlobalScope()
        ;(globalThis as any).chrome = {
          runtime: { id: 'test-extension-id' },
        }

        const env = detectEnvironment()
        expect(env).toBe('chrome-extension-sw')
      })

      it('should prioritize chrome extension detection over browser', () => {
        ;(globalThis as any).chrome = {
          runtime: { id: 'test-extension-id' },
        }
        ;(globalThis as any).window = {}
        ;(globalThis as any).document = {}

        const env = detectEnvironment()
        expect(env).toBe('chrome-extension')
      })

      it('should not detect as chrome extension without runtime.id', () => {
        ;(globalThis as any).chrome = {
          runtime: {}, // No id
        }
        ;(globalThis as any).window = {}
        ;(globalThis as any).document = {}

        const env = detectEnvironment()
        expect(env).toBe('browser')
      })
    })

    describe('Worker environment', () => {
      it('should detect web worker', () => {
        class MockWorkerGlobalScope {}
        ;(globalThis as any).WorkerGlobalScope = MockWorkerGlobalScope
        ;(globalThis as any).self = new MockWorkerGlobalScope()

        const env = detectEnvironment()
        expect(env).toBe('worker')
      })

      it('should prioritize chrome extension SW over regular worker', () => {
        class MockServiceWorkerGlobalScope {}
        ;(globalThis as any).ServiceWorkerGlobalScope = MockServiceWorkerGlobalScope
        ;(globalThis as any).self = new MockServiceWorkerGlobalScope()
        ;(globalThis as any).chrome = {
          runtime: { id: 'test-extension-id' },
        }

        const env = detectEnvironment()
        expect(env).toBe('chrome-extension-sw')
      })
    })

    describe('Unknown environment', () => {
      it('should return unknown when no environment is detected', () => {
        // All globals undefined
        const env = detectEnvironment()
        expect(env).toBe('unknown')
      })
    })
  })

  describe('Helper functions', () => {
    describe('isBrowser()', () => {
      it('should return true for browser environment', () => {
        ;(globalThis as any).window = {}
        ;(globalThis as any).document = {}

        expect(isBrowser()).toBe(true)
      })

      it('should return true for electron renderer (has browser APIs)', () => {
        ;(globalThis as any).process = {
          versions: { node: '16.0.0', electron: '22.0.0' },
          type: 'renderer',
        }
        ;(globalThis as any).window = {}

        expect(isBrowser()).toBe(true)
      })

      it('should return false for Node.js', () => {
        ;(globalThis as any).process = {
          versions: { node: '16.0.0' },
        }

        expect(isBrowser()).toBe(false)
      })

      it('should return false for chrome extension', () => {
        ;(globalThis as any).chrome = {
          runtime: { id: 'test' },
        }

        expect(isBrowser()).toBe(false)
      })
    })

    describe('isNode()', () => {
      it('should return true for Node.js environment', () => {
        ;(globalThis as any).process = {
          versions: { node: '18.0.0' },
        }

        expect(isNode()).toBe(true)
      })

      it('should return true for electron main (has Node.js APIs)', () => {
        ;(globalThis as any).process = {
          versions: { node: '16.0.0', electron: '22.0.0' },
          type: 'browser',
        }

        expect(isNode()).toBe(true)
      })

      it('should return false for browser', () => {
        ;(globalThis as any).window = {}
        ;(globalThis as any).document = {}

        expect(isNode()).toBe(false)
      })

      it('should return false for electron renderer', () => {
        ;(globalThis as any).process = {
          versions: { node: '16.0.0', electron: '22.0.0' },
          type: 'renderer',
        }
        ;(globalThis as any).window = {}

        expect(isNode()).toBe(false)
      })
    })

    describe('isElectron()', () => {
      it('should return true when electron version exists', () => {
        ;(globalThis as any).process = {
          versions: { electron: '22.0.0' },
        }

        expect(isElectron()).toBe(true)
      })

      it('should return false when not in electron', () => {
        ;(globalThis as any).process = {
          versions: { node: '18.0.0' },
        }

        expect(isElectron()).toBe(false)
      })

      it('should return false when process is undefined', () => {
        expect(isElectron()).toBe(false)
      })
    })

    describe('isElectronMain()', () => {
      it('should return true for electron main process', () => {
        ;(globalThis as any).process = {
          versions: { electron: '22.0.0' },
          type: 'browser',
        }

        expect(isElectronMain()).toBe(true)
      })

      it('should return false for electron renderer', () => {
        ;(globalThis as any).process = {
          versions: { electron: '22.0.0' },
          type: 'renderer',
        }
        ;(globalThis as any).window = {}

        expect(isElectronMain()).toBe(false)
      })
    })

    describe('isElectronRenderer()', () => {
      it('should return true for electron renderer process', () => {
        ;(globalThis as any).process = {
          versions: { electron: '22.0.0' },
          type: 'renderer',
        }
        ;(globalThis as any).window = {}

        expect(isElectronRenderer()).toBe(true)
      })

      it('should return false for electron main', () => {
        ;(globalThis as any).process = {
          versions: { electron: '22.0.0' },
          type: 'browser',
        }

        expect(isElectronRenderer()).toBe(false)
      })
    })

    describe('isWorker()', () => {
      it('should return true for web worker', () => {
        class MockWorkerGlobalScope {}
        ;(globalThis as any).WorkerGlobalScope = MockWorkerGlobalScope
        ;(globalThis as any).self = new MockWorkerGlobalScope()

        expect(isWorker()).toBe(true)
      })

      it('should return false for browser', () => {
        ;(globalThis as any).window = {}
        ;(globalThis as any).document = {}

        expect(isWorker()).toBe(false)
      })
    })

    describe('isChromeExtension()', () => {
      it('should return true for chrome extension page', () => {
        ;(globalThis as any).chrome = {
          runtime: { id: 'test' },
        }

        expect(isChromeExtension()).toBe(true)
      })

      it('should return true for chrome extension service worker', () => {
        class MockServiceWorkerGlobalScope {}
        ;(globalThis as any).ServiceWorkerGlobalScope = MockServiceWorkerGlobalScope
        ;(globalThis as any).self = new MockServiceWorkerGlobalScope()
        ;(globalThis as any).chrome = {
          runtime: { id: 'test' },
        }

        expect(isChromeExtension()).toBe(true)
      })

      it('should return false for browser', () => {
        ;(globalThis as any).window = {}
        ;(globalThis as any).document = {}

        expect(isChromeExtension()).toBe(false)
      })
    })

    describe('isChromeExtensionServiceWorker()', () => {
      it('should return true for chrome extension service worker', () => {
        class MockServiceWorkerGlobalScope {}
        ;(globalThis as any).ServiceWorkerGlobalScope = MockServiceWorkerGlobalScope
        ;(globalThis as any).self = new MockServiceWorkerGlobalScope()
        ;(globalThis as any).chrome = {
          runtime: { id: 'test' },
        }

        expect(isChromeExtensionServiceWorker()).toBe(true)
      })

      it('should return false for chrome extension page', () => {
        ;(globalThis as any).chrome = {
          runtime: { id: 'test' },
        }

        expect(isChromeExtensionServiceWorker()).toBe(false)
      })
    })

    describe('isChromeExtensionPage()', () => {
      it('should return true for chrome extension page', () => {
        ;(globalThis as any).chrome = {
          runtime: { id: 'test' },
        }

        expect(isChromeExtensionPage()).toBe(true)
      })

      it('should return false for chrome extension service worker', () => {
        class MockServiceWorkerGlobalScope {}
        ;(globalThis as any).ServiceWorkerGlobalScope = MockServiceWorkerGlobalScope
        ;(globalThis as any).self = new MockServiceWorkerGlobalScope()
        ;(globalThis as any).chrome = {
          runtime: { id: 'test' },
        }

        expect(isChromeExtensionPage()).toBe(false)
      })
    })

    describe('getEnvironmentInfo()', () => {
      it('should return comprehensive environment info for Node.js', () => {
        ;(globalThis as any).process = {
          versions: { node: '18.0.0' },
        }

        const info = getEnvironmentInfo()

        expect(info.environment).toBe('node')
        expect(info.hasWindow).toBe(false)
        expect(info.hasDocument).toBe(false)
        expect(info.hasProcess).toBe(true)
        expect(info.isElectron).toBe(false)
        expect(info.isChromeExtension).toBe(false)
        expect(info.nodeVersion).toBe('18.0.0')
        expect(info.electronVersion).toBeUndefined()
        expect(info.chromeExtensionId).toBeUndefined()
      })

      it('should return comprehensive environment info for browser', () => {
        ;(globalThis as any).window = {}
        ;(globalThis as any).document = {}
        ;(globalThis as any).navigator = {
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        }

        const info = getEnvironmentInfo()

        expect(info.environment).toBe('browser')
        expect(info.hasWindow).toBe(true)
        expect(info.hasDocument).toBe(true)
        expect(info.hasNavigator).toBe(true)
        expect(info.isElectron).toBe(false)
        expect(info.isChromeExtension).toBe(false)
        expect(info.userAgent).toContain('Mozilla')
      })

      it('should return comprehensive environment info for Electron', () => {
        ;(globalThis as any).process = {
          versions: {
            node: '16.0.0',
            electron: '22.0.0',
          },
          type: 'renderer',
        }
        ;(globalThis as any).window = {}

        const info = getEnvironmentInfo()

        expect(info.environment).toBe('electron-renderer')
        expect(info.isElectron).toBe(true)
        expect(info.nodeVersion).toBe('16.0.0')
        expect(info.electronVersion).toBe('22.0.0')
      })

      it('should return comprehensive environment info for Chrome Extension', () => {
        ;(globalThis as any).chrome = {
          runtime: { id: 'abcdefghijklmnop' },
        }

        const info = getEnvironmentInfo()

        expect(info.environment).toBe('chrome-extension')
        expect(info.isChromeExtension).toBe(true)
        expect(info.chromeExtensionId).toBe('abcdefghijklmnop')
      })
    })
  })

  describe('Detection priority', () => {
    it('should detect Electron before Node.js', () => {
      ;(globalThis as any).process = {
        versions: {
          node: '16.0.0',
          electron: '22.0.0',
        },
        type: 'browser',
      }

      const env = detectEnvironment()
      expect(env).toBe('electron-main')
    })

    it('should detect Chrome Extension before browser', () => {
      ;(globalThis as any).chrome = {
        runtime: { id: 'test' },
      }
      ;(globalThis as any).window = {}
      ;(globalThis as any).document = {}

      const env = detectEnvironment()
      expect(env).toBe('chrome-extension')
    })

    it('should detect Chrome Extension SW before worker', () => {
      class MockServiceWorkerGlobalScope {}
      ;(globalThis as any).ServiceWorkerGlobalScope = MockServiceWorkerGlobalScope
      ;(globalThis as any).self = new MockServiceWorkerGlobalScope()
      ;(globalThis as any).chrome = {
        runtime: { id: 'test' },
      }

      const env = detectEnvironment()
      expect(env).toBe('chrome-extension-sw')
    })
  })
})
