import { requireNativeModule } from 'expo-modules-core'

/**
 * TypeScript declarations for the ExpoMpcNative native module.
 *
 * Functions marked as sync (Function) run on the calling thread.
 * Functions marked as async (AsyncFunction) dispatch to a background thread.
 */

interface ExpoMpcNativeModuleType {
  // ---------------------------------------------------------------------------
  // DKLS — Keygen
  // ---------------------------------------------------------------------------

  /** Create a DKLS keygen setup message. Returns base64-encoded setup. */
  dklsKeygenSetup(
    threshold: number,
    keyId: string | null,
    ids: string[]
  ): string

  /**
   * Create a DKLS keygen session from a base64-encoded setup message.
   * Returns a session handle.
   */
  createKeygenSession(
    setupBase64: string,
    localPartyId: string
  ): Promise<number>

  /**
   * Create a DKLS keygen refresh session.
   * Returns a session handle.
   */
  createKeygenRefreshSession(
    setupBase64: string,
    localPartyId: string,
    keyshareHandle: number
  ): number

  /**
   * Create a DKLS keygen migration session.
   * Returns a session handle.
   */
  createKeygenMigrationSession(
    setupBase64: string,
    localPartyId: string,
    publicKeyBase64: string,
    rootChainCodeBase64: string,
    secretCoefficientBase64: string
  ): number

  // ---------------------------------------------------------------------------
  // DKLS — Keygen session I/O
  // ---------------------------------------------------------------------------

  /** Get the next output message from a keygen session. Returns base64 or null. */
  keygenSessionOutputMessage(sessionHandle: number): string | null

  /** Get the receiver for a keygen message at the given index. Returns the party ID. */
  keygenSessionMessageReceiver(
    sessionHandle: number,
    messageBase64: string,
    index: number
  ): string

  /** Feed an input message to a keygen session. Returns true if the session is complete. */
  keygenSessionInputMessage(
    sessionHandle: number,
    messageBase64: string
  ): boolean

  /**
   * Finish a keygen session and return the keyshare data.
   * Returns { publicKey, chainCode, keyshare } as base64 strings.
   */
  finishKeygen(sessionHandle: number): Promise<{ publicKey: string; chainCode: string; keyshare: string }>

  /** Free a keygen session handle. */
  freeKeygenSession(sessionHandle: number): void

  // ---------------------------------------------------------------------------
  // DKLS — Signing
  // ---------------------------------------------------------------------------

  /** Create a DKLS sign setup message. Returns base64-encoded setup. */
  dklsSignSetup(
    keyIdBase64: string,
    chainPath: string,
    messageHashBase64: string | null,
    ids: string[]
  ): string

  /** Decode the message hash from a DKLS sign setup message. Returns base64 or null. */
  dklsDecodeMessage(setupBase64: string): string | null

  /** Decode the key ID from a DKLS sign/keygen setup message. Returns base64 or null. */
  dklsDecodeKeyId(setupBase64: string): string | null

  /** Create a DKLS sign session. Returns a session handle. */
  createSignSession(
    setupBase64: string,
    localPartyId: string,
    keyshareHandle: number
  ): number

  /** Get the next output message from a sign session. Returns base64 or null. */
  signSessionOutputMessage(sessionHandle: number): string | null

  /** Get the receiver for a sign message at the given index. Returns the party ID. */
  signSessionMessageReceiver(
    sessionHandle: number,
    messageBase64: string,
    index: number
  ): string

  /** Feed an input message to a sign session. Returns true if the session is complete. */
  signSessionInputMessage(
    sessionHandle: number,
    messageBase64: string
  ): boolean

  /** Finish a sign session and return the signature as base64. */
  finishSign(sessionHandle: number): string

  /** Free a sign session handle. */
  freeSignSession(sessionHandle: number): void

  // ---------------------------------------------------------------------------
  // DKLS — Keyshare
  // ---------------------------------------------------------------------------

  /** Create a keyshare from base64-encoded bytes. Returns a keyshare handle. */
  dklsKeyshareFromBytes(base64: string): number

  /** Serialize a keyshare to base64. */
  dklsKeyshareToBytes(handle: number): string

  /** Get the public key from a keyshare. Returns base64. */
  dklsKeysharePublicKey(handle: number): string

  /** Get the key ID from a keyshare. Returns base64. */
  dklsKeyshareKeyId(handle: number): string

  /** Get the chain code from a keyshare. Returns base64. */
  dklsKeyshareChainCode(handle: number): string

  /** Free a keyshare handle. */
  freeKeyshare(handle: number): void

  // ---------------------------------------------------------------------------
  // DKLS — QC (Reshare)
  // ---------------------------------------------------------------------------

  /** Create a DKLS QC setup message. Returns base64-encoded setup. */
  dklsQcSetup(
    keyshareHandle: number,
    ids: string[],
    oldPartiesBase64: string,
    newThreshold: number,
    newPartiesBase64: string
  ): string

  /** Create a DKLS QC session. Returns a session handle. */
  createQcSession(
    setupBase64: string,
    localPartyId: string,
    keyshareHandle: number | null
  ): number

  /** Get the next output message from a QC session. Returns base64 or null. */
  qcSessionOutputMessage(sessionHandle: number): string | null

  /** Get the receiver for a QC message at the given index. Returns the party ID. */
  qcSessionMessageReceiver(
    sessionHandle: number,
    messageBase64: string,
    index: number
  ): string

  /** Feed an input message to a QC session. Returns true if the session is complete. */
  qcSessionInputMessage(
    sessionHandle: number,
    messageBase64: string
  ): boolean

  /** Finish a QC session and return the keyshare handle (or -1 if none). */
  finishQc(sessionHandle: number): number

  /** Free a QC session handle. */
  freeQcSession(sessionHandle: number): void

  // ---------------------------------------------------------------------------
  // DKLS — Key Import
  // ---------------------------------------------------------------------------

  /**
   * Create a DKLS key import initiator session.
   * Private key and chain code are hex-encoded.
   * Returns { sessionHandle, setupMessage }.
   */
  createDklsKeyImportInitiator(
    privateKeyHex: string,
    rootChainCodeHex: string | null,
    threshold: number,
    ids: string[]
  ): { sessionHandle: number; setupMessage: string }

  /**
   * Create a DKLS key import session (non-initiator).
   * Returns a session handle.
   */
  createDklsKeyImportSession(
    setupBase64: string,
    localPartyId: string
  ): Promise<number>

  // ---------------------------------------------------------------------------
  // Schnorr — Keygen
  // ---------------------------------------------------------------------------

  /** Create a Schnorr keygen setup message. Returns base64-encoded setup. */
  schnorrKeygenSetup(
    threshold: number,
    keyId: string | null,
    ids: string[]
  ): string

  /**
   * Create a Schnorr keygen session from a base64-encoded setup message.
   * Returns a session handle.
   */
  createSchnorrKeygenSession(
    setupBase64: string,
    localPartyId: string
  ): Promise<number>

  // ---------------------------------------------------------------------------
  // Schnorr — Keygen session I/O
  // ---------------------------------------------------------------------------

  /** Get the next output message from a Schnorr keygen session. Returns base64 or null. */
  schnorrKeygenSessionOutputMessage(sessionHandle: number): string | null

  /** Get the receiver for a Schnorr keygen message at the given index. */
  schnorrKeygenSessionMessageReceiver(
    sessionHandle: number,
    messageBase64: string,
    index: number
  ): string

  /** Feed an input message to a Schnorr keygen session. Returns true if complete. */
  schnorrKeygenSessionInputMessage(
    sessionHandle: number,
    messageBase64: string
  ): boolean

  /**
   * Finish a Schnorr keygen session and return the keyshare data.
   * Returns { publicKey, keyshare } as base64 strings.
   */
  finishSchnorrKeygen(sessionHandle: number): Promise<{ publicKey: string; chainCode: string; keyshare: string }>

  /** Free a Schnorr keygen session handle. */
  freeSchnorrKeygenSession(sessionHandle: number): void

  // ---------------------------------------------------------------------------
  // Schnorr — Signing
  // ---------------------------------------------------------------------------

  /** Create a Schnorr sign setup message. Returns base64-encoded setup. */
  schnorrSignSetup(
    keyIdBase64: string,
    chainPath: string,
    messageHashBase64: string,
    ids: string[]
  ): string

  /** Decode the message hash from a Schnorr sign setup message. Returns base64 or null. */
  schnorrDecodeMessage(setupBase64: string): string | null

  /** Decode the key ID from a Schnorr setup message. Returns base64 or null. */
  schnorrDecodeKeyId(setupBase64: string): string | null

  /** Create a Schnorr sign session. Returns a session handle. */
  createSchnorrSignSession(
    setupBase64: string,
    localPartyId: string,
    keyshareHandle: number
  ): number

  /** Get the next output message from a Schnorr sign session. Returns base64 or null. */
  schnorrSignSessionOutputMessage(sessionHandle: number): string | null

  /** Get the receiver for a Schnorr sign message at the given index. */
  schnorrSignSessionMessageReceiver(
    sessionHandle: number,
    messageBase64: string,
    index: number
  ): string

  /** Feed an input message to a Schnorr sign session. Returns true if complete. */
  schnorrSignSessionInputMessage(
    sessionHandle: number,
    messageBase64: string
  ): boolean

  /** Finish a Schnorr sign session and return the signature as base64. */
  finishSchnorrSign(sessionHandle: number): string

  /** Free a Schnorr sign session handle. */
  freeSchnorrSignSession(sessionHandle: number): void

  // ---------------------------------------------------------------------------
  // Schnorr — Keyshare
  // ---------------------------------------------------------------------------

  /** Create a Schnorr keyshare from base64-encoded bytes. Returns a keyshare handle. */
  schnorrKeyshareFromBytes(base64: string): number

  /** Serialize a Schnorr keyshare to base64. */
  schnorrKeyshareToBytes(handle: number): string

  /** Get the public key from a Schnorr keyshare. Returns base64. */
  schnorrKeysharePublicKey(handle: number): string

  /** Get the key ID from a Schnorr keyshare. Returns base64. */
  schnorrKeyshareKeyId(handle: number): string

  /** Get the chain code from a Schnorr keyshare. Returns base64. */
  schnorrKeyshareChainCode(handle: number): string

  /** Free a Schnorr keyshare handle. */
  freeSchnorrKeyshare(handle: number): void

  // ---------------------------------------------------------------------------
  // Schnorr — QC (Reshare)
  // ---------------------------------------------------------------------------

  /** Create a Schnorr QC setup message. Returns base64-encoded setup. */
  schnorrQcSetup(
    keyshareHandle: number,
    ids: string[],
    oldPartiesBase64: string,
    newThreshold: number,
    newPartiesBase64: string
  ): string

  /** Create a Schnorr QC session. Returns a session handle. */
  createSchnorrQcSession(
    setupBase64: string,
    localPartyId: string,
    keyshareHandle: number | null
  ): number

  /** Get the next output message from a Schnorr QC session. */
  schnorrQcSessionOutputMessage(sessionHandle: number): string | null

  /** Get the receiver for a Schnorr QC message at the given index. */
  schnorrQcSessionMessageReceiver(
    sessionHandle: number,
    messageBase64: string,
    index: number
  ): string

  /** Feed an input message to a Schnorr QC session. Returns true if complete. */
  schnorrQcSessionInputMessage(
    sessionHandle: number,
    messageBase64: string
  ): boolean

  /** Finish a Schnorr QC session and return the keyshare handle (or -1 if none). */
  finishSchnorrQc(sessionHandle: number): number

  /** Free a Schnorr QC session handle. */
  freeSchnorrQcSession(sessionHandle: number): void

  // ---------------------------------------------------------------------------
  // Schnorr — Key Import
  // ---------------------------------------------------------------------------

  /**
   * Create a Schnorr key import initiator session.
   * Private key and chain code are hex-encoded.
   * Returns { sessionHandle, setupMessage }.
   */
  createSchnorrKeyImportInitiator(
    privateKeyHex: string,
    rootChainCodeHex: string | null,
    threshold: number,
    ids: string[]
  ): { sessionHandle: number; setupMessage: string }

  /**
   * Create a Schnorr key import session (non-initiator).
   * Returns a session handle.
   */
  createSchnorrKeyImportSession(
    setupBase64: string,
    localPartyId: string
  ): Promise<number>
}

export default requireNativeModule<ExpoMpcNativeModuleType>('ExpoMpcNative')
