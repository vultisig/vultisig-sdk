import { base64Encode } from './base64Encode';

describe('base64Encode', () => {
  it('should correctly encode a string', () => {
    const input = 'Hello, world!';
    const expected = 'SGVsbG8sIHdvcmxkIQ==';
    expect(base64Encode(input)).toBe(expected);
  });

  it('should correctly encode a number as string', () => {
    const input = '12345';
    const expected = 'MTIzNDU=';
    expect(base64Encode(input)).toBe(expected);
  });

  it('should correctly encode an object', () => {
    const input = { key: 'value' };
    const expected = 'eyJrZXkiOiJ2YWx1ZSJ9';
    expect(base64Encode(JSON.stringify(input))).toBe(expected);
  });

  it('should correctly encode an array', () => {
    const input = [1, 2, 3];
    const expected = 'WzEsMiwzXQ==';
    expect(base64Encode(JSON.stringify(input))).toBe(expected);
  });

  it('should handle empty strings', () => {
    const input = '';
    const expected = '';
    expect(base64Encode(input)).toBe(expected);
  });
}); 