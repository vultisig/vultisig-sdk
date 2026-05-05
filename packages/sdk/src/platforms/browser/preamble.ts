/**
 * Browser preamble — side-effect module that installs globals required by
 * browserified Node dependencies before the rest of the SDK graph evaluates.
 */
import { Buffer } from 'buffer'

if (typeof globalThis !== 'undefined' && !(globalThis as { Buffer?: unknown }).Buffer) {
  ;(globalThis as { Buffer?: unknown }).Buffer = Buffer
}
