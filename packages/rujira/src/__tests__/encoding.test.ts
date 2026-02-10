import { describe, expect, it } from 'vitest';

import {
  base64Decode,
  base64Encode,
  bytesToBase64,
  hexDecode,
  hexEncode,
  stringToBytes,
} from '../utils/encoding.js';

describe('base64Encode / base64Decode', () => {
  it('round-trips a simple string', () => {
    const input = 'hello world';
    expect(base64Decode(base64Encode(input))).toBe(input);
  });

  it('encodes to the expected base64 value', () => {
    expect(base64Encode('hello')).toBe('aGVsbG8=');
  });

  it('decodes a known base64 value', () => {
    expect(base64Decode('aGVsbG8=')).toBe('hello');
  });

  it('handles empty string', () => {
    expect(base64Encode('')).toBe('');
    expect(base64Decode('')).toBe('');
  });

  it('round-trips JSON', () => {
    const json = JSON.stringify({ swap: { min: { min_return: '1000' } } });
    expect(base64Decode(base64Encode(json))).toBe(json);
  });

  it('handles unicode characters', () => {
    const input = 'cafe\u0301';
    expect(base64Decode(base64Encode(input))).toBe(input);
  });
});

describe('hexEncode / hexDecode', () => {
  it('round-trips bytes', () => {
    const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    expect(hexDecode(hexEncode(bytes))).toEqual(bytes);
  });

  it('encodes to expected hex', () => {
    expect(hexEncode(new Uint8Array([0, 1, 255]))).toBe('0001ff');
  });

  it('decodes hex with 0x prefix', () => {
    expect(hexDecode('0xdeadbeef')).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });

  it('decodes hex without prefix', () => {
    expect(hexDecode('deadbeef')).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });

  it('handles empty input', () => {
    expect(hexEncode(new Uint8Array([]))).toBe('');
    expect(hexDecode('')).toEqual(new Uint8Array([]));
  });
});

describe('bytesToBase64', () => {
  it('encodes bytes to base64', () => {
    const bytes = new Uint8Array([104, 101, 108, 108, 111]); // "hello"
    expect(bytesToBase64(bytes)).toBe('aGVsbG8=');
  });

  it('handles empty array', () => {
    expect(bytesToBase64(new Uint8Array([]))).toBe('');
  });
});

describe('stringToBytes', () => {
  it('converts ASCII string to bytes', () => {
    const bytes = stringToBytes('hello');
    expect(bytes).toEqual(new Uint8Array([104, 101, 108, 108, 111]));
  });

  it('handles empty string', () => {
    expect(stringToBytes('')).toEqual(new Uint8Array([]));
  });
});
