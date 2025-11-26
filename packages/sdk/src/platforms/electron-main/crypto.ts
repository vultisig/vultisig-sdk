/**
 * Electron Main process crypto implementation
 * Re-exports Node.js crypto (same environment)
 */

export { NodeCrypto as ElectronMainCrypto } from "../node/crypto";
