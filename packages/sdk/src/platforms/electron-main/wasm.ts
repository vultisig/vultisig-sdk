/**
 * Electron Main process WASM loader
 * Uses Node.js fs (same as Node platform)
 */
import * as fs from 'fs/promises'
import * as path from 'path'
import { dirname } from 'path'
import { fileURLToPath } from 'url'

import type { PlatformWasmLoader } from '../types'

// ESM-compatible __dirname equivalent
const currentDir = dirname(fileURLToPath(import.meta.url))

export class ElectronMainWasmLoader implements PlatformWasmLoader {
  async loadDkls(): Promise<ArrayBuffer> {
    const wasmPath = this.resolvePath('dkls/vs_wasm_bg.wasm')
    return this.loadWasmFile(wasmPath)
  }

  async loadSchnorr(): Promise<ArrayBuffer> {
    const wasmPath = this.resolvePath('schnorr/vs_schnorr_wasm_bg.wasm')
    return this.loadWasmFile(wasmPath)
  }

  resolvePath(filename: string): string {
    // In Electron main process, __dirname points to the bundled location
    return path.join(currentDir, 'lib', filename)
  }

  private async loadWasmFile(filePath: string): Promise<ArrayBuffer> {
    try {
      const buffer = await fs.readFile(filePath)
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        const libMatch = filePath.match(/lib\/(.+)$/)
        const relativeLibPath = libMatch ? libMatch[1] : ''
        const altPath = path.join(currentDir, '../../../lib', relativeLibPath)
        const buffer = await fs.readFile(altPath)
        return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
      }
      throw error
    }
  }
}
