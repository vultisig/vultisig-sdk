/**
 * Electron Renderer process crypto implementation
 * Re-exports Browser crypto (same environment)
 */

export { BrowserCrypto as ElectronRendererCrypto } from "../browser/crypto";
