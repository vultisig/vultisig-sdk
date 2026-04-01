import { NativeModule, requireNativeModule } from 'expo'

declare class ExpoMpcModule extends NativeModule {
  // === DKLS (ECDSA) Keygen ===
  isAvailable(): boolean
  createKeygenSetupMessage(
    threshold: number,
    partyIds: string[]
  ): Promise<string>
  createKeygenSession(
    setupBase64: string,
    localPartyId: string
  ): Promise<number>
  getOutboundMessage(handleId: number): string | null
  getMessageReceiver(
    handleId: number,
    messageBase64: string,
    index: number
  ): string | null
  inputMessage(handleId: number, messageBase64: string): boolean
  finishKeygen(
    handleId: number
  ): Promise<{ keyshare: string; publicKey: string; chainCode: string }>
  freeKeygenSession(handleId: number): void
  freeKeyshare(handleId: number): void

  // === DKLS Key Import ===
  createDklsKeyImportSession(
    privateKeyHex: string,
    chainCodeHex: string,
    threshold: number,
    partyIds: string[]
  ): Promise<{ setupMessage: string; sessionHandle: number }>
  createSchnorrKeyImportSession(
    privateKeyHex: string,
    chainCodeHex: string,
    threshold: number,
    partyIds: string[]
  ): Promise<{ setupMessage: string; sessionHandle: number }>

  // === DKLS (ECDSA) Keysign ===
  loadKeyshare(keyshareBase64: string): number
  getKeyshareKeyId(handleId: number): string
  createSignSetupMessage(
    keyIdBase64: string,
    chainPath: string,
    messageHashHex: string,
    partyIds: string[]
  ): string
  createSignSession(
    setupBase64: string,
    localPartyId: string,
    keyshareHandleId: number
  ): number
  getSignOutboundMessage(handleId: number): string | null
  getSignMessageReceiver(
    handleId: number,
    messageBase64: string,
    index: number
  ): string | null
  inputSignMessage(handleId: number, messageBase64: string): boolean
  finishSign(handleId: number): string
  freeSignSession(handleId: number): void

  // === Schnorr (EdDSA) Keygen ===
  createSchnorrKeygenSession(
    setupBase64: string,
    localPartyId: string
  ): Promise<number>
  getSchnorrOutboundMessage(handleId: number): string | null
  getSchnorrMessageReceiver(
    handleId: number,
    messageBase64: string,
    index: number
  ): string | null
  inputSchnorrMessage(handleId: number, messageBase64: string): boolean
  finishSchnorrKeygen(
    handleId: number
  ): Promise<{ keyshare: string; publicKey: string }>
  freeSchnorrSession(handleId: number): void

  // === Schnorr (EdDSA) Keysign ===
  loadSchnorrKeyshare(keyshareBase64: string): number
  getSchnorrKeyshareKeyId(handleId: number): string
  createSchnorrSignSetupMessage(
    keyIdBase64: string,
    chainPath: string,
    messageHashHex: string,
    partyIds: string[]
  ): string
  createSchnorrSignSession(
    setupBase64: string,
    localPartyId: string,
    keyshareHandleId: number
  ): number
  getSchnorrSignOutboundMessage(handleId: number): string | null
  getSchnorrSignMessageReceiver(
    handleId: number,
    messageBase64: string,
    index: number
  ): string | null
  inputSchnorrSignMessage(handleId: number, messageBase64: string): boolean
  finishSchnorrSign(handleId: number): string
  freeSchnorrSignSession(handleId: number): void
}

export default requireNativeModule<ExpoMpcModule>('ExpoMpc')
