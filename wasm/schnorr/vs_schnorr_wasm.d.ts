/* tslint:disable */
/* eslint-disable */
export class KeyExportSession {
  private constructor();
  free(): void;
  static new(share: Keyshare, ids: string[]): KeyExportSession;
  /**
   * Handle an input message. If processing of the input message moves the
   * session into some final state then it will return `true`.
   *
   * Passing messages out of order is OK.
   *
   * Invalid messages will be silently ignored.
   */
  inputMessage(msg: Uint8Array): boolean;
  /**
   * Finish the session and return resulting secret key.
   */
  finish(): Uint8Array;
  /**
   * Return encrypted secret material from passed key share.
   */
  static exportShare(setup: Uint8Array, id: string, share: Keyshare): Message;
  /**
   * Setup message for the session.
   */
  readonly setup: Uint8Array;
}
export class KeyImportInitiator {
  free(): void;
  /**
   * Create session for key import initiator and setup message for
   * rest of parties.
   *
   * # Arguments
   *
   * * `private_key` - Private key to import
   *
   * * `threshold` - Signature threshold
   *
   * * `ids` - List of human readable identifiers.
   *   The initiator is first in the list
   */
  constructor(private_key: Uint8Array, threshold: number, ids: string[]);
  /**
   * Get next output message. If no pending output message available,
   * `undefined` will be returned.
   *
   * Messages are authenticated and encrypted if required.
   */
  outputMessage(): Message | undefined;
  /**
   * Handle an input message. If processing of the input message moves the
   * session into some final state then it will return `true`.
   *
   * Passing messages out of order is OK.
   *
   * Invalid messages will be silently ignored.
   */
  inputMessage(msg: Uint8Array): boolean;
  /**
   * Finish the session and return resulting key share.
   */
  finish(): Keyshare;
  /**
   * Setup message for the key importers.
   */
  readonly setup: Uint8Array;
}
export class KeyImporterSession {
  private constructor();
  free(): void;
}
export class KeygenSession {
  free(): void;
  /**
   * Allocate new key generation session
   *
   * # Arguments
   *
   * * `setup` - A setup message created by `KeygenSession.setup`
   *
   * * `id`    - A human readable party identifier
   */
  constructor(setup: Uint8Array, id: string);
  /**
   * Allocate new key refresh session
   *
   * # Arguments
   *
   * * `setup`     - A setup message created by `KeygenSession.setup`
   *
   * * `id`        - A human readable party identifier
   *
   * * `old_Share` - Old key share
   */
  static refresh(setup: Uint8Array, id: string, old_keyshare: Keyshare): KeygenSession;
  /**
   * Create a new DKG setup message.
   *
   * # Arguments
   *
   * * `key_id`    - Optional array of 32 bytes to identify an existing
   *                 key share for key refresh.
   *
   * * `threshold` - Threshold parameter.
   *
   * * `ids`       - Array of party identities.
   */
  static setup(key_id: Uint8Array | null | undefined, threshold: number, ids: string[]): Uint8Array;
  /**
   * Extract key ID from a setup message.
   */
  static setupKeyId(setup_msg: Uint8Array): Uint8Array | undefined;
  /**
   * Get next output message. If no pending output message available,
   * `undefined` will be returned.
   *
   * Messages are authenticated and encrypted if required.
   */
  outputMessage(): Message | undefined;
  /**
   * Handle an input message. If processing of the input message moves the
   * session into some final state then it will return `true`.
   *
   * Passing messages out of order is OK.
   *
   * Invalid messages will be silently ignored.
   */
  inputMessage(msg: Uint8Array): boolean;
  /**
   * Finish the session and return resulting key share.
   */
  finish(): Keyshare;
}
export class Keyshare {
  private constructor();
  free(): void;
  /**
   * Return public key as compressed encoding of the public key.
   */
  publicKey(): Uint8Array;
  /**
   * Return key Id.
   */
  keyId(): Uint8Array;
  /**
   * Serialize the keyshare into array of bytes.
   */
  toBytes(): Uint8Array;
  /**
   * Deserialize keyshare from the array of bytes.
   */
  static fromBytes(bytes: Uint8Array): Keyshare;
  /**
   * Returns the common  chaincode that has been computed at keygen
   */
  rootChainCode(): Uint8Array;
}
export class Message {
  private constructor();
  free(): void;
  /**
   * Body of the message
   */
  readonly body: Uint8Array;
  /**
   * A list of message receviers.
   */
  readonly receivers: string[];
}
export class QcSession {
  free(): void;
  /**
   * Allocate new QC session
   *
   * # Arguments
   *
   * * `setup` - A setup message created by `QcSession.setup`
   *
   * * `id`    - A human readable party identifier
   *
   * * `keyshare` - Optional keyshare, passed to "old" parties
   */
  constructor(setup: Uint8Array, id: string, keyshare?: Keyshare | null);
  /**
   * Create a new QC setup message.
   *
   * # Arguments
   *
   * * `keyshare`  - keyshare.
   *
   * * `ids`       - Array of party identities.
   *
   * * `olds`      - Array of indices of old parties.
   *
   * * `threshold` - New threshold parameter.
   *
   * * `news`      - Array of indices of new parties.
   */
  static setup(keyshare: Keyshare, ids: string[], olds: Uint8Array, threshold: number, news: Uint8Array): Uint8Array;
  /**
   * Extract key ID from a setup message.
   */
  static setupKeyId(setup_msg: Uint8Array): Uint8Array | undefined;
  /**
   * Get next output message. If no pending output message available,
   * `undefined` will be returned.
   *
   * Messages are authenticated and encrypted if required.
   */
  outputMessage(): Message | undefined;
  /**
   * Handle an input message. If processing of the input message moves the
   * session into some final state then it will return `true`.
   *
   * Passing messages out of order is OK.
   *
   * Invalid messages will be silently ignored.
   */
  inputMessage(msg: Uint8Array): boolean;
  /**
   * Finish the session and return resulting keyshare for new
   * parties or `undefined` for old parties.
   */
  finish(): Keyshare | undefined;
}
export class SignSession {
  free(): void;
  /**
   * Allocate a signature generation session
   *
   * # Arguments
   *
   * * `setup` - Setup message created by `SignSession.setup()`
   *
   * * `id`    - Party identifier
   *
   * * `share` - Key share object
   */
  constructor(setup: Uint8Array, id: string, share: Keyshare);
  /**
   * Generate a setup message for signature generation session.
   *
   * # Arguments
   *
   * * `key_id`       - 32 bytes array identifing a distributed key
   *
   * * `chain_path`   - Key derivation path
   *
   * * `message`      - message to sign.
   *
   * * `ids`          - Array of party identifiers
   */
  static setup(key_id: Uint8Array, chain_path: string, message: Uint8Array, ids: string[]): Uint8Array;
  /**
   * Extract message hash form the setup message.
   */
  static setupMessageHash(setup_msg: Uint8Array): Uint8Array | undefined;
  /**
   * Extract key ID from a setup message.
   */
  static setupKeyId(setup_msg: Uint8Array): Uint8Array | undefined;
  /**
   * Get next output message. If no pending output message available,
   * `undefined` will be returned.
   *
   * Messages are authenticated and encrypted if required.
   */
  outputMessage(): Message | undefined;
  /**
   * Handle an input message. If processing of the input message moves the
   * session into some final state then it will return `true`.
   *
   * Passing messages out of order is OK.
   *
   * Invalid messages will be silently ignored.
   */
  inputMessage(msg: Uint8Array): boolean;
  /**
   * Finish the session and return resulting signature or pre-sign object.
   */
  finish(): Uint8Array;
}
