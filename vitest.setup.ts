/**
 * Global Vitest setup file
 * Sets up WASM file loading for all tests in Node.js environment
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { vi } from 'vitest'

// Mock getCoinBalance to prevent real API calls during testing
vi.mock('@core/chain/coin/balance', () => ({
  getCoinBalance: vi.fn().mockResolvedValue('1000000000'), // Mock balance as string (1 BTC or 10 ETH equivalent)
}))

// Setup global fetch mock for WASM file loading in Node.js environment
const originalFetch = global.fetch

global.fetch = async (url: string | URL | Request) => {
  const urlString = url.toString()
  
  console.log('🔍 Vitest fetch called with URL:', urlString)

  if (urlString.includes('.wasm')) {
    console.log('📦 Loading WASM file:', urlString)
    // Try to load from node_modules or lib directories
    let wasmPath: string

    if (urlString.includes('wallet-core.wasm')) {
      wasmPath = join(
        __dirname,
        'node_modules/@trustwallet/wallet-core/dist/lib/wallet-core.wasm'
      )
    } else if (urlString.includes('vs_wasm_bg.wasm')) {
      wasmPath = join(__dirname, 'lib/dkls/vs_wasm_bg.wasm')
    } else if (urlString.includes('vs_schnorr_wasm_bg.wasm')) {
      wasmPath = join(__dirname, 'lib/schnorr/vs_schnorr_wasm_bg.wasm')
    } else {
      // For any other WASM files, try to load from the filesystem
      const fs = await import('fs')
      const path = await import('path')

      // Extract filename and try common locations
      const filename = urlString.split('/').pop() || ''
      const possiblePaths = [
        path.join(
          __dirname,
          'node_modules/@trustwallet/wallet-core/dist/lib/',
          filename
        ),
        path.join(__dirname, 'lib/dkls/', filename),
        path.join(__dirname, 'lib/schnorr/', filename),
        path.join(
          __dirname,
          'src/node_modules/@trustwallet/wallet-core/dist/lib/',
          filename
        ),
      ]

      for (const testPath of possiblePaths) {
        if (fs.existsSync(testPath)) {
          wasmPath = testPath
          break
        }
      }

      if (!wasmPath) {
        throw new Error(`WASM file not found: ${urlString}`)
      }
    }

    console.log('📁 Trying to load WASM from:', wasmPath)
    try {
      const wasmBuffer = readFileSync(wasmPath)
      console.log('✅ WASM file loaded successfully, size:', wasmBuffer.length, 'bytes')
      const arrayBuffer = wasmBuffer.buffer.slice(
        wasmBuffer.byteOffset,
        wasmBuffer.byteOffset + wasmBuffer.byteLength
      )

      return new Response(arrayBuffer, {
        status: 200,
        statusText: 'OK',
        headers: new Headers({
          'Content-Type': 'application/wasm',
        }),
      })
    } catch (error) {
      // Try fallback paths if primary path fails
      const fallbackPaths = [
        join(__dirname, 'lib/dkls/vs_wasm_bg.wasm'),
        join(__dirname, 'lib/schnorr/vs_schnorr_wasm_bg.wasm'),
        join(
          __dirname,
          'node_modules/@trustwallet/wallet-core/dist/lib/wallet-core.wasm'
        ),
      ]

      for (const fallbackPath of fallbackPaths) {
        if (urlString.includes(fallbackPath.split('/').pop() || '')) {
          try {
            const wasmBuffer = readFileSync(fallbackPath)
            const arrayBuffer = wasmBuffer.buffer.slice(
              wasmBuffer.byteOffset,
              wasmBuffer.byteOffset + wasmBuffer.byteLength
            )
            return new Response(arrayBuffer, {
              status: 200,
              statusText: 'OK',
              headers: new Headers({
                'Content-Type': 'application/wasm',
              }),
            })
          } catch (fallbackError) {
            continue
          }
        }
      }

      throw error
    }
  }

  // For non-WASM requests, use original fetch if available
  if (originalFetch) {
    return originalFetch(url)
  }

  // Fallback for non-WASM requests when no original fetch
  return Promise.resolve({
    ok: false,
    status: 404,
    text: () => Promise.resolve('Not found'),
  } as Response)
}

console.log(
  'Vitest setup: Global WASM loading configured for Node.js environment'
)
