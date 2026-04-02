/**
 * @vultisig/mpc-types
 *
 * Shared interfaces for the pluggable MPC engine pattern.
 * Both @vultisig/mpc-wasm and @vultisig/mpc-native implement these.
 */

// ---------------------------------------------------------------------------
// Core message type
// ---------------------------------------------------------------------------

/** A message produced by an MPC session for relay to other parties. */
export interface MpcMessage {
  /** Message body (binary). */
  readonly body: Uint8Array
  /** Party IDs that should receive this message. */
  readonly receivers: string[]
}

// ---------------------------------------------------------------------------
// Session interface
// ---------------------------------------------------------------------------

/**
 * An MPC session that exchanges messages with peers until completion.
 * All MPC operations (keygen, signing, reshare, key import) follow this
 * message-loop pattern: call {@link outputMessage} to get outbound messages,
 * feed inbound messages via {@link inputMessage}, and call {@link finish}
 * once the protocol completes.
 */
export interface MpcSession<TResult> {
  /** Get the next outbound message, or `undefined` if none is pending. */
  outputMessage(): MpcMessage | undefined
  /** Feed an inbound message. Returns `true` if the session is complete. */
  inputMessage(msg: Uint8Array): boolean
  /** Finish the session and return the result. Call only after {@link inputMessage} returns `true`. */
  finish(): TResult | Promise<TResult>
  /** Release native/WASM resources. Optional because some runtimes handle this via GC. */
  free?(): void
}

// ---------------------------------------------------------------------------
// Keyshare
// ---------------------------------------------------------------------------

/** A serializable MPC key share produced by keygen, reshare, or key-import operations. */
export interface MpcKeyshare {
  /** Compressed public key bytes. */
  publicKey(): Uint8Array
  /** Key identifier bytes. */
  keyId(): Uint8Array
  /** Serialize the keyshare to bytes for storage. */
  toBytes(): Uint8Array
  /** Root BIP32 chain code (ECDSA only; EdDSA returns zeroed 32 bytes). */
  rootChainCode(): Uint8Array
  /** Release native/WASM resources. Optional because some runtimes handle this via GC. */
  free?(): void
}

/** Result from a DKLS (ECDSA) keygen finish. */
export interface MpcKeygenResult {
  /** Base64-encoded keyshare bytes. */
  keyshare: string
  /** Hex-encoded compressed public key. */
  publicKey: string
  /** Hex-encoded BIP32 root chain code. */
  chaincode: string
}

/** Result from a Schnorr (EdDSA) keygen finish (no chain code). */
export interface MpcSchnorrKeygenResult {
  /** Base64-encoded keyshare bytes. */
  keyshare: string
  /** Hex-encoded compressed public key. */
  publicKey: string
}

// ---------------------------------------------------------------------------
// Per-algorithm engine interfaces
// ---------------------------------------------------------------------------

/** DKLS (ECDSA) MPC engine — handles keygen, signing, reshare, refresh, and key import. */
export interface DklsEngine {
  // --- Keygen ---

  /** Create a keygen setup message to distribute to all parties. */
  keygenSetup(
    keyId: Uint8Array | null | undefined,
    threshold: number,
    partyIds: string[]
  ): Uint8Array

  /**
   * Create a keygen session from a setup message.
   * May return a Promise in native implementations that require async initialization.
   */
  createKeygenSession(
    setup: Uint8Array,
    localPartyId: string
  ): MpcSession<MpcKeyshare> | Promise<MpcSession<MpcKeyshare>>

  /**
   * Create a keygen session for key refresh (rotating shares without changing the public key).
   * May return a Promise in native implementations that require async initialization.
   */
  createRefreshSession(
    setup: Uint8Array,
    localPartyId: string,
    oldKeyshare: MpcKeyshare
  ): MpcSession<MpcKeyshare> | Promise<MpcSession<MpcKeyshare>>

  /**
   * Create a keygen session for migrating a key from a legacy format.
   * May return a Promise in native implementations that require async initialization.
   */
  createMigrateSession(
    setup: Uint8Array,
    localPartyId: string,
    localUI: Uint8Array,
    publicKey: Uint8Array,
    rootChainCode: Uint8Array
  ): MpcSession<MpcKeyshare> | Promise<MpcSession<MpcKeyshare>>

  // --- Signing ---

  /** Create a sign setup message to distribute to signing parties. */
  signSetup(
    keyId: Uint8Array,
    chainPath: string,
    messageHash: Uint8Array | null | undefined,
    partyIds: string[]
  ): Uint8Array

  /** Extract the message hash from a sign setup message. */
  signSetupMessageHash(setupMsg: Uint8Array): Uint8Array | undefined

  /** Extract the key ID from a sign setup message. */
  signSetupKeyId(setupMsg: Uint8Array): Uint8Array | undefined

  /**
   * Create a signing session.
   * May return a Promise in native implementations that require async initialization.
   */
  createSignSession(
    setup: Uint8Array,
    localPartyId: string,
    keyshare: MpcKeyshare
  ): MpcSession<Uint8Array> | Promise<MpcSession<Uint8Array>>

  // --- Keyshare ---

  /** Deserialize a keyshare from bytes (inverse of {@link MpcKeyshare.toBytes}). */
  keyshareFromBytes(bytes: Uint8Array): MpcKeyshare

  // --- Reshare ---

  /** Create a reshare (quorum change) setup message. */
  reshareSetup(
    keyshare: MpcKeyshare,
    allPartyIds: string[],
    oldIndices: Uint8Array,
    threshold: number,
    newIndices: Uint8Array
  ): Uint8Array

  /**
   * Create a reshare session. Pass `null` for keyshare when joining as a new party.
   * May return a Promise in native implementations that require async initialization.
   */
  createReshareSession(
    setup: Uint8Array,
    localPartyId: string,
    keyshare: MpcKeyshare | null
  ): MpcSession<MpcKeyshare | undefined> | Promise<MpcSession<MpcKeyshare | undefined>>

  // --- Key Import ---

  /**
   * Create a key import initiator session. Returns the session and setup message to
   * distribute to other parties. Only the initiator calls this method.
   * May return a Promise in native implementations that require async initialization.
   */
  createKeyImportInitiator(
    privateKey: Uint8Array,
    rootChainCode: Uint8Array | null | undefined,
    threshold: number,
    partyIds: string[]
  ): { session: MpcSession<MpcKeyshare>; setup: Uint8Array } | Promise<{ session: MpcSession<MpcKeyshare>; setup: Uint8Array }>

  /**
   * Create a key import session (non-initiator party).
   * May return a Promise in native implementations that require async initialization.
   */
  createKeyImportSession(
    setup: Uint8Array,
    localPartyId: string
  ): MpcSession<MpcKeyshare> | Promise<MpcSession<MpcKeyshare>>
}

/**
 * Schnorr (EdDSA) MPC engine — handles keygen, signing, reshare, and key import.
 * Structurally similar to {@link DklsEngine} but lacks key refresh and makes
 * migration optional (not all EdDSA implementations support it).
 */
export interface SchnorrEngine {
  // --- Keygen ---

  /** Create a keygen setup message to distribute to all parties. */
  keygenSetup(
    keyId: Uint8Array | null | undefined,
    threshold: number,
    partyIds: string[]
  ): Uint8Array

  /**
   * Create a keygen session from a setup message.
   * May return a Promise in native implementations that require async initialization.
   */
  createKeygenSession(
    setup: Uint8Array,
    localPartyId: string
  ): MpcSession<MpcKeyshare> | Promise<MpcSession<MpcKeyshare>>

  /**
   * Create a keygen session for migrating a key from a legacy format.
   * Optional — not all Schnorr implementations support migration.
   * May return a Promise in native implementations that require async initialization.
   */
  createMigrateSession?(
    setup: Uint8Array,
    localPartyId: string,
    localUI: Uint8Array,
    publicKey: Uint8Array,
    rootChainCode: Uint8Array
  ): MpcSession<MpcKeyshare> | Promise<MpcSession<MpcKeyshare>>

  // --- Signing ---

  /** Create a sign setup message to distribute to signing parties. */
  signSetup(
    keyId: Uint8Array,
    chainPath: string,
    messageHash: Uint8Array | null | undefined,
    partyIds: string[]
  ): Uint8Array

  /** Extract the message hash from a sign setup message. */
  signSetupMessageHash(setupMsg: Uint8Array): Uint8Array | undefined

  /** Extract the key ID from a sign setup message. */
  signSetupKeyId(setupMsg: Uint8Array): Uint8Array | undefined

  /**
   * Create a signing session.
   * May return a Promise in native implementations that require async initialization.
   */
  createSignSession(
    setup: Uint8Array,
    localPartyId: string,
    keyshare: MpcKeyshare
  ): MpcSession<Uint8Array> | Promise<MpcSession<Uint8Array>>

  // --- Keyshare ---

  /** Deserialize a keyshare from bytes (inverse of {@link MpcKeyshare.toBytes}). */
  keyshareFromBytes(bytes: Uint8Array): MpcKeyshare

  // --- Reshare ---

  /** Create a reshare (quorum change) setup message. */
  reshareSetup(
    keyshare: MpcKeyshare,
    allPartyIds: string[],
    oldIndices: Uint8Array,
    threshold: number,
    newIndices: Uint8Array
  ): Uint8Array

  /**
   * Create a reshare session. Pass `null` for keyshare when joining as a new party.
   * May return a Promise in native implementations that require async initialization.
   */
  createReshareSession(
    setup: Uint8Array,
    localPartyId: string,
    keyshare: MpcKeyshare | null
  ): MpcSession<MpcKeyshare | undefined> | Promise<MpcSession<MpcKeyshare | undefined>>

  // --- Key Import ---

  /**
   * Create a key import initiator session. Returns the session and setup message to
   * distribute to other parties. Only the initiator calls this method.
   * May return a Promise in native implementations that require async initialization.
   */
  createKeyImportInitiator(
    privateKey: Uint8Array,
    rootChainCode: Uint8Array | null | undefined,
    threshold: number,
    partyIds: string[]
  ): { session: MpcSession<MpcKeyshare>; setup: Uint8Array } | Promise<{ session: MpcSession<MpcKeyshare>; setup: Uint8Array }>

  /**
   * Create a key import session (non-initiator party).
   * May return a Promise in native implementations that require async initialization.
   */
  createKeyImportSession(
    setup: Uint8Array,
    localPartyId: string
  ): MpcSession<MpcKeyshare> | Promise<MpcSession<MpcKeyshare>>
}

// ---------------------------------------------------------------------------
// Top-level engine
// ---------------------------------------------------------------------------

/** The pluggable MPC engine. Each platform provides its own implementation. */
export interface MpcEngine {
  /** Initialize the engine (load WASM, verify native module, etc.). Must be called before any operations. */
  initialize(): Promise<void>
  /** DKLS (ECDSA) operations. */
  readonly dkls: DklsEngine
  /** Schnorr (EdDSA) operations. */
  readonly schnorr: SchnorrEngine
}

// Runtime configuration
export { configureMpc, getMpcEngine } from './runtime'
