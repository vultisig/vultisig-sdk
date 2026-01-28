/**
 * Test helpers for Rujira SDK tests
 */

import { toBech32, fromBech32 } from '@cosmjs/encoding';

/**
 * Valid test addresses with proper bech32 checksums
 * These are deterministically generated from known data for testing purposes
 */

// 20-byte data filled with zeros (standard address)
const ZERO_DATA_20 = new Uint8Array(20);

// 20-byte data with incrementing bytes
const INCREMENTING_DATA_20 = new Uint8Array(20).map((_, i) => i);

// Generate a valid thor1 address from 20 bytes of data
function generateThorAddress(data: Uint8Array): string {
  return toBech32('thor', data);
}

// Generate a valid sthor1 address from 20 bytes of data
function generateSthorAddress(data: Uint8Array): string {
  return toBech32('sthor', data);
}

/**
 * Valid mainnet test address (thor1...)
 * This is a proper bech32-encoded address with valid checksum
 */
export const VALID_THOR_ADDRESS = generateThorAddress(ZERO_DATA_20);

/**
 * Valid stagenet test address (sthor1...)
 */
export const VALID_STHOR_ADDRESS = generateSthorAddress(ZERO_DATA_20);

/**
 * Alternative valid address (different data)
 */
export const VALID_THOR_ADDRESS_2 = generateThorAddress(INCREMENTING_DATA_20);

/**
 * Generate a valid thor address with custom seed
 * @param seed - Number to seed the address data
 */
export function generateValidThorAddress(seed: number = 0): string {
  const data = new Uint8Array(20);
  data[0] = seed & 0xff;
  data[1] = (seed >> 8) & 0xff;
  return toBech32('thor', data);
}

/**
 * Generate a valid sthor address with custom seed
 * @param seed - Number to seed the address data
 */
export function generateValidSthorAddress(seed: number = 0): string {
  const data = new Uint8Array(20);
  data[0] = seed & 0xff;
  data[1] = (seed >> 8) & 0xff;
  return toBech32('sthor', data);
}

// Log addresses for verification (only during test development)
if (process.env.DEBUG_TEST_ADDRESSES) {
  console.log('Test addresses:');
  console.log('  VALID_THOR_ADDRESS:', VALID_THOR_ADDRESS);
  console.log('  VALID_STHOR_ADDRESS:', VALID_STHOR_ADDRESS);
  console.log('  VALID_THOR_ADDRESS_2:', VALID_THOR_ADDRESS_2);
}
