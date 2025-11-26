/**
 * Node.js WASM loader implementation
 * Direct implementation using fs for loading WASM files
 */
import * as fs from "fs/promises";
import * as path from "path";

import type { PlatformWasmLoader } from "../types";

export class NodeWasmLoader implements PlatformWasmLoader {
  async loadDkls(): Promise<ArrayBuffer> {
    const wasmPath = this.resolvePath("dkls/vs_wasm_bg.wasm");
    return this.loadWasmFile(wasmPath);
  }

  async loadSchnorr(): Promise<ArrayBuffer> {
    const wasmPath = this.resolvePath("schnorr/vs_schnorr_wasm_bg.wasm");
    return this.loadWasmFile(wasmPath);
  }

  resolvePath(filename: string): string {
    // Resolve relative to dist/lib directory
    // __dirname will be dist/ after build, so lib/ is at ./lib/
    return path.join(__dirname, "lib", filename);
  }

  private async loadWasmFile(filePath: string): Promise<ArrayBuffer> {
    try {
      const buffer = await fs.readFile(filePath);
      // Convert Node Buffer to ArrayBuffer
      return buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ) as ArrayBuffer;
    } catch (error) {
      // Fallback: try alternate path for dev/test environments
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        const libMatch = filePath.match(/lib\/(.+)$/);
        const relativeLibPath = libMatch ? libMatch[1] : "";

        // Try package root relative path
        const altPath = path.join(__dirname, "../../../lib", relativeLibPath);
        const buffer = await fs.readFile(altPath);
        return buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength,
        ) as ArrayBuffer;
      }
      throw error;
    }
  }
}
