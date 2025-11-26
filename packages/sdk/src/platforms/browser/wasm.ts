/**
 * Browser WASM loader implementation
 * Uses fetch to load WASM files
 */
import type { PlatformWasmLoader } from "../types";

export class BrowserWasmLoader implements PlatformWasmLoader {
  async loadDkls(): Promise<ArrayBuffer> {
    const wasmPath = this.resolvePath("dkls/vs_wasm_bg.wasm");
    return this.loadWasmFile(wasmPath);
  }

  async loadSchnorr(): Promise<ArrayBuffer> {
    const wasmPath = this.resolvePath("schnorr/vs_schnorr_wasm_bg.wasm");
    return this.loadWasmFile(wasmPath);
  }

  resolvePath(filename: string): string {
    // Try to load from public/lib first (for examples and apps)
    // Falls back to relative path for bundled distributions
    if (typeof window !== "undefined" && window.location) {
      // In browser environment, try loading from /lib/ path (public directory)
      return `${window.location.origin}/lib/${filename}`;
    }
    // Fallback: resolve relative to the current script/module location
    return new URL(`./lib/${filename}`, import.meta.url).href;
  }

  private async loadWasmFile(url: string): Promise<ArrayBuffer> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch WASM from ${url}: ${response.statusText}`,
      );
    }
    return await response.arrayBuffer();
  }
}
