/**
 * Test setup for CLI tests
 * Sets up the same environment as the CLI launcher
 */

const path = require('path')
const fs = require('fs')

// File polyfill for Node.js - working version
if (typeof globalThis.File === 'undefined') {
  globalThis.File = function File(chunks, name, options) {
    this.chunks = chunks
    this.name = name
    this.options = options
    const buffer = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)))
    this.buffer = buffer
    this._buffer = buffer
    this.arrayBuffer = function () {
      return Promise.resolve(
        buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength
        )
      )
    }
  }
}

// Setup fetch polyfill for WASM file loading (from vitest.setup.ts)
const originalFetch = globalThis.fetch

globalThis.fetch = async function (url) {
  const urlString = url.toString()

  if (urlString.includes('.wasm')) {
    const fs = require('fs')
    // Get the correct project root (vultisig-sdk directory)
    const projectRoot = path.resolve(__dirname, '../../../..')

    // Try to load from filesystem
    let wasmPath

    if (urlString.includes('wallet-core.wasm')) {
      wasmPath = path.join(
        projectRoot,
        'node_modules/@trustwallet/wallet-core/dist/lib/wallet-core.wasm'
      )
    } else if (urlString.includes('vs_wasm_bg.wasm')) {
      wasmPath = path.join(projectRoot, 'lib/dkls/vs_wasm_bg.wasm')
    } else if (urlString.includes('vs_schnorr_wasm_bg.wasm')) {
      wasmPath = path.join(projectRoot, 'lib/schnorr/vs_schnorr_wasm_bg.wasm')
    } else {
      // Extract filename and try common locations
      const filename = urlString.split('/').pop() || ''
      const possiblePaths = [
        path.join(
          projectRoot,
          'node_modules/@trustwallet/wallet-core/dist/lib/',
          filename
        ),
        path.join(projectRoot, 'lib/dkls/', filename),
        path.join(projectRoot, 'lib/schnorr/', filename),
        path.join(projectRoot, 'src/dist/wasm/', filename),
        path.join(projectRoot, 'src/dist/', filename),
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

    try {
      const wasmBuffer = fs.readFileSync(wasmPath)
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
      throw new Error(`Failed to load WASM file ${wasmPath}: ${error.message}`)
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
  })
}

// Load SDK globally for tests
const sdkPath = path.resolve(__dirname, '../../../../src')
const { Vultisig: VultisigSDK } = require(
  path.resolve(sdkPath, 'dist/index.node.cjs')
)
globalThis.VultisigSDK = VultisigSDK

console.log('✅ CLI test environment setup complete')

// Load vault details from JSON files
const testFastVaultDetails = require('../../vaults/vault-details-TestFastVault-44fd-share2of2-Password123!.json')
const testSecureVaultDetails = require('../../vaults/vault-details-TestSecureVault-cfa0-share2of2-Nopassword.json')

module.exports = {
  VultisigSDK,
  projectRoot: path.resolve(__dirname, '../../../..'),
  vaultsDir: path.resolve(__dirname, '../../vaults'),
  expectedAddresses: {
    'TestFastVault-44fd-share2of2-Password123!.vult':
      testFastVaultDetails.addresses,
    'TestSecureVault-cfa0-share2of2-NoPassword.vult':
      testSecureVaultDetails.addresses,
  },
  expectedVaultData: {
    'TestFastVault-44fd-share2of2-Password123!.vult':
      testFastVaultDetails.vault,
    'TestSecureVault-cfa0-share2of2-NoPassword.vult':
      testSecureVaultDetails.vault,
  },
}
