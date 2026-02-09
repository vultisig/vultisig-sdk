import { describe, it, expect } from 'vitest';
import {
  validateMemoComponent,
  buildExecuteMemo,
  parseExecuteMemo,
  buildSwapMemo,
  buildThorSwapMemo,
  buildSecureMintMemo,
  buildSecureRedeemMemo,
  parseMemoType,
  validateMemoLength,
} from '../utils/memo.js';

describe('validateMemoComponent', () => {
  it('accepts valid strings without colons', () => {
    expect(() => validateMemoComponent('thor1abc123', 'address')).not.toThrow();
    expect(() => validateMemoComponent('BTC.BTC', 'asset')).not.toThrow();
    expect(() => validateMemoComponent('100', 'limit')).not.toThrow();
  });

  it('rejects strings containing colons (injection attack)', () => {
    expect(() => validateMemoComponent('thor1abc:evil', 'address')).toThrow(
      "contains ':'"
    );
    expect(() => validateMemoComponent('secure+:injected', 'destination')).toThrow(
      "contains ':'"
    );
    expect(() => validateMemoComponent('::', 'field')).toThrow("contains ':'");
  });

  it('includes field name in error message', () => {
    expect(() => validateMemoComponent('a:b', 'myField')).toThrow('myField');
  });
});

describe('buildSecureMintMemo', () => {
  it('builds correct secure+ memo', () => {
    const memo = buildSecureMintMemo('thor1abcdef');
    expect(memo).toBe('secure+:thor1abcdef');
  });

  it('rejects address containing colon', () => {
    expect(() => buildSecureMintMemo('thor1:evil')).toThrow("contains ':'");
  });
});

describe('buildSecureRedeemMemo', () => {
  it('builds correct secure- memo', () => {
    const memo = buildSecureRedeemMemo('bc1qxyz');
    expect(memo).toBe('secure-:bc1qxyz');
  });

  it('rejects address containing colon', () => {
    expect(() => buildSecureRedeemMemo('0x:inject')).toThrow("contains ':'");
  });
});

describe('buildExecuteMemo', () => {
  it('encodes message as base64', () => {
    const msg = { swap: { min: { min_return: '100' } } };
    const memo = buildExecuteMemo('thor1contract', msg);

    expect(memo).toMatch(/^x:thor1contract:/);
    const base64Part = memo.split(':')[2];
    const decoded = JSON.parse(Buffer.from(base64Part, 'base64').toString());
    expect(decoded).toEqual(msg);
  });
});

describe('parseExecuteMemo', () => {
  it('round-trips with buildExecuteMemo', () => {
    const msg = { swap: { min: { min_return: '500' } } };
    const memo = buildExecuteMemo('thor1addr', msg);
    const parsed = parseExecuteMemo(memo);

    expect(parsed).not.toBeNull();
    expect(parsed!.contract).toBe('thor1addr');
    expect(parsed!.msg).toEqual(msg);
  });

  it('returns null for non-execute memos', () => {
    expect(parseExecuteMemo('secure+:thor1abc')).toBeNull();
    expect(parseExecuteMemo('=:BTC.BTC:thor1abc')).toBeNull();
    expect(parseExecuteMemo('')).toBeNull();
  });

  it('returns null for malformed execute memos', () => {
    expect(parseExecuteMemo('x:')).toBeNull();
    expect(parseExecuteMemo('x:contract')).toBeNull();
    expect(parseExecuteMemo('x:contract:!!!notbase64')).toBeNull();
  });
});

describe('buildThorSwapMemo', () => {
  it('builds basic swap memo', () => {
    const memo = buildThorSwapMemo('BTC.BTC', 'bc1qxyz');
    expect(memo).toBe('=:BTC.BTC:bc1qxyz');
  });

  it('includes limit', () => {
    const memo = buildThorSwapMemo('BTC.BTC', 'bc1qxyz', '100000');
    expect(memo).toBe('=:BTC.BTC:bc1qxyz:100000');
  });

  it('includes affiliate', () => {
    const memo = buildThorSwapMemo('BTC.BTC', 'bc1qxyz', '100000', 'thor1aff', 30);
    expect(memo).toBe('=:BTC.BTC:bc1qxyz:100000:thor1aff:30');
  });

  it('rejects asset with colon', () => {
    expect(() => buildThorSwapMemo('BTC:BTC', 'bc1q')).toThrow("contains ':'");
  });

  it('rejects destination with colon', () => {
    expect(() => buildThorSwapMemo('BTC.BTC', 'bc1q:evil')).toThrow("contains ':'");
  });
});

describe('parseMemoType', () => {
  it('parses swap memo', () => {
    const result = parseMemoType('=:BTC.BTC:bc1qxyz');
    expect(result.type).toBe('swap');
    if (result.type === 'swap') {
      expect(result.asset).toBe('BTC.BTC');
      expect(result.destination).toBe('bc1qxyz');
    }
  });

  it('parses execute memo', () => {
    const result = parseMemoType('x:thor1contract:abc123');
    expect(result.type).toBe('execute');
    if (result.type === 'execute') {
      expect(result.contract).toBe('thor1contract');
    }
  });

  it('parses secure-mint memo', () => {
    const result = parseMemoType('secure+:thor1abc');
    expect(result.type).toBe('secure-mint');
    if (result.type === 'secure-mint') {
      expect(result.destination).toBe('thor1abc');
    }
  });

  it('parses secure-redeem memo', () => {
    const result = parseMemoType('secure-:bc1qxyz');
    expect(result.type).toBe('secure-redeem');
    if (result.type === 'secure-redeem') {
      expect(result.destination).toBe('bc1qxyz');
    }
  });

  it('returns unknown for unrecognized memo', () => {
    expect(parseMemoType('randomtext')).toEqual({ type: 'unknown' });
  });
});

describe('validateMemoLength', () => {
  it('accepts memos within limit', () => {
    expect(validateMemoLength('short')).toBe(true);
    expect(validateMemoLength('x'.repeat(250))).toBe(true);
  });

  it('rejects memos over limit', () => {
    expect(validateMemoLength('x'.repeat(251))).toBe(false);
  });

  it('respects custom limit', () => {
    expect(validateMemoLength('12345', 5)).toBe(true);
    expect(validateMemoLength('123456', 5)).toBe(false);
  });
});
