import { initWasm } from "@trustwallet/wallet-core";

import { memoizeAsync } from "../utils/memoizeAsync";
import type { WasmConfig } from "./types";

/**
 * WasmManager coordinates WASM module initialization.
 * Platform bundles configure this with their WASM loaders.
 * Thread-safe: Uses memoizeAsync to prevent race conditions.
 */
export class WasmManager {
  private static config?: WasmConfig;
  private static walletCoreInstance?: any;
  private static dklsInitialized = false;
  private static schnorrInitialized = false;

  // Race-safe memoized initialization functions
  private static memoizedInitWalletCore = memoizeAsync(async () => {
    if (this.config?.wasmPaths?.walletCore) {
      console.warn(
        "Custom WASM path for wallet-core is not supported. Using default path.",
      );
    }
    const instance = await initWasm();
    this.walletCoreInstance = instance;
    return instance;
  });

  private static memoizedInitDkls = memoizeAsync(async () => {
    const wasmLoader = this.config?.wasmPaths?.dkls;

    if (!wasmLoader) {
      throw new Error(
        "DKLS WASM loader not configured. " +
          "This should be configured automatically by platform bundles. " +
          "Ensure you are importing from the correct platform entry point.",
      );
    }

    const arrayBuffer = await wasmLoader();
    const { default: initializeDkls } = await import(
      "../../../lib/dkls/vs_wasm.js"
    );
    await initializeDkls(arrayBuffer);

    this.dklsInitialized = true;
  });

  private static memoizedInitSchnorr = memoizeAsync(async () => {
    const wasmLoader = this.config?.wasmPaths?.schnorr;

    if (!wasmLoader) {
      throw new Error(
        "Schnorr WASM loader not configured. " +
          "This should be configured automatically by platform bundles. " +
          "Ensure you are importing from the correct platform entry point.",
      );
    }

    const arrayBuffer = await wasmLoader();
    const { default: initializeSchnorr } = await import(
      "../../../lib/schnorr/vs_schnorr_wasm.js"
    );
    await initializeSchnorr(arrayBuffer);

    this.schnorrInitialized = true;
  });

  /**
   * Configure WASM loading.
   * Called automatically by platform bundles at module load time.
   */
  static configure(config: WasmConfig): void {
    if (
      this.walletCoreInstance ||
      this.dklsInitialized ||
      this.schnorrInitialized
    ) {
      console.warn(
        "WASM modules already initialized, configuration may not take effect",
      );
    }
    this.config = config;
  }

  /**
   * Get WalletCore instance for address derivation and operations.
   * Lazy loads on first access.
   * Thread-safe: Concurrent calls will wait for same initialization promise.
   */
  static async getWalletCore() {
    try {
      if (this.walletCoreInstance) {
        return this.walletCoreInstance;
      }

      return await this.memoizedInitWalletCore();
    } catch (error) {
      throw new Error(`Failed to initialize WalletCore WASM: ${error}`);
    }
  }

  /**
   * Initialize DKLS WASM module (ECDSA).
   * Thread-safe: Concurrent calls wait for same initialization promise.
   */
  static async initializeDkls(): Promise<void> {
    try {
      if (this.dklsInitialized) {
        return;
      }

      await this.memoizedInitDkls();
    } catch (error) {
      throw new Error(`Failed to initialize DKLS WASM: ${error}`);
    }
  }

  /**
   * Initialize Schnorr WASM module (EdDSA).
   * Thread-safe: Concurrent calls wait for same initialization promise.
   */
  static async initializeSchnorr(): Promise<void> {
    try {
      if (this.schnorrInitialized) {
        return;
      }

      await this.memoizedInitSchnorr();
    } catch (error) {
      throw new Error(`Failed to initialize Schnorr WASM: ${error}`);
    }
  }

  /**
   * Pre-load all WASM modules.
   * Initializes in parallel for better performance.
   */
  static async initialize(): Promise<void> {
    try {
      await Promise.all([
        this.getWalletCore(),
        this.initializeDkls(),
        this.initializeSchnorr(),
      ]);
    } catch (error) {
      throw new Error(`Failed to initialize WASM modules: ${error}`);
    }
  }

  /**
   * Get initialization status for all modules.
   */
  static getStatus() {
    return {
      walletCore: this.walletCoreInstance !== undefined,
      dkls: this.dklsInitialized,
      schnorr: this.schnorrInitialized,
    };
  }

  /**
   * Reset all WASM state (mainly for testing).
   * Recreates memoized functions to clear their internal caches.
   */
  static reset(): void {
    this.config = undefined;
    this.walletCoreInstance = undefined;
    this.dklsInitialized = false;
    this.schnorrInitialized = false;

    // Recreate memoized functions to clear their caches
    this.memoizedInitWalletCore = memoizeAsync(async () => {
      if (this.config?.wasmPaths?.walletCore) {
        console.warn(
          "Custom WASM path for wallet-core is not supported. Using default path.",
        );
      }
      const instance = await initWasm();
      this.walletCoreInstance = instance;
      return instance;
    });

    this.memoizedInitDkls = memoizeAsync(async () => {
      const wasmLoader = this.config?.wasmPaths?.dkls;

      if (!wasmLoader) {
        throw new Error(
          "DKLS WASM loader not configured. " +
            "This should be configured automatically by platform bundles. " +
            "Ensure you are importing from the correct platform entry point.",
        );
      }

      const arrayBuffer = await wasmLoader();
      const { default: initializeDkls } = await import(
        "../../../lib/dkls/vs_wasm.js"
      );
      await initializeDkls(arrayBuffer);

      this.dklsInitialized = true;
    });

    this.memoizedInitSchnorr = memoizeAsync(async () => {
      const wasmLoader = this.config?.wasmPaths?.schnorr;

      if (!wasmLoader) {
        throw new Error(
          "Schnorr WASM loader not configured. " +
            "This should be configured automatically by platform bundles. " +
            "Ensure you are importing from the correct platform entry point.",
        );
      }

      const arrayBuffer = await wasmLoader();
      const { default: initializeSchnorr } = await import(
        "../../../lib/schnorr/vs_schnorr_wasm.js"
      );
      await initializeSchnorr(arrayBuffer);

      this.schnorrInitialized = true;
    });
  }
}
