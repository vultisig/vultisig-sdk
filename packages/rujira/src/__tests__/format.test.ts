import { describe, it, expect } from 'vitest';
import {
  toBaseUnits,
  fromBaseUnits,
  formatFee,
  calculateMinReturn,
  calculateSlippage,
  generateQuoteId,
  percentToBps,
  bpsToPercent,
} from '../utils/format.js';

describe('toBaseUnits', () => {
  it('converts whole numbers', () => {
    expect(toBaseUnits('1', 8)).toBe('100000000');
    expect(toBaseUnits('10', 8)).toBe('1000000000');
  });

  it('converts fractional amounts', () => {
    expect(toBaseUnits('1.5', 8)).toBe('150000000');
    expect(toBaseUnits('0.001', 18)).toBe('1000000000000000');
  });

  it('pads short fractions', () => {
    expect(toBaseUnits('1.1', 8)).toBe('110000000');
  });

  it('truncates excess fraction', () => {
    expect(toBaseUnits('1.123456789', 8)).toBe('112345678');
  });

  it('handles zero', () => {
    expect(toBaseUnits('0', 8)).toBe('0');
    expect(toBaseUnits('0.0', 8)).toBe('0');
  });

  it('accepts numbers', () => {
    expect(toBaseUnits(1.5, 8)).toBe('150000000');
  });
});

describe('fromBaseUnits', () => {
  it('converts to human-readable', () => {
    expect(fromBaseUnits('150000000', 8)).toBe('1.5');
    expect(fromBaseUnits('1000000000000000', 18)).toBe('0.001');
  });

  it('handles whole units', () => {
    expect(fromBaseUnits('100000000', 8)).toBe('1');
  });

  it('handles zero', () => {
    expect(fromBaseUnits('0', 8)).toBe('0');
  });

  it('handles bigint input', () => {
    expect(fromBaseUnits(150000000n, 8)).toBe('1.5');
  });

  it('strips trailing zeros', () => {
    expect(fromBaseUnits('100000000', 8)).toBe('1');
    expect(fromBaseUnits('110000000', 8)).toBe('1.1');
  });
});

describe('formatFee', () => {
  // formatFee depends on @vultisig/assets to resolve decimals.
  // For unknown assets, it returns baseUnits.toString() as fallback.
  it('returns raw value for unknown asset', () => {
    expect(formatFee('12345', 'UNKNOWN.ASSET')).toBe('12345');
  });

  // Test the rounding logic via calculateMinReturn as a proxy,
  // or test directly if we can craft inputs where asset is known.
  // The key behavior: formatFee rounds UP when truncating.
});

describe('calculateMinReturn', () => {
  it('calculates correctly for 1% slippage', () => {
    // 100 bps = 1%
    expect(calculateMinReturn('10000', 100)).toBe('9900');
  });

  it('calculates correctly for 0.5% slippage', () => {
    expect(calculateMinReturn('10000', 50)).toBe('9950');
  });

  it('handles zero slippage', () => {
    expect(calculateMinReturn('10000', 0)).toBe('10000');
  });

  it('handles large amounts', () => {
    const result = calculateMinReturn('1000000000000', 100);
    expect(result).toBe('990000000000');
  });

  it('accepts bigint input', () => {
    expect(calculateMinReturn(10000n, 100)).toBe('9900');
  });
});

describe('calculateSlippage', () => {
  it('returns 0 for equal values', () => {
    expect(calculateSlippage('10000', '10000')).toBe('0.00');
  });

  it('returns negative for worse outcome', () => {
    const result = parseFloat(calculateSlippage('10000', '9900'));
    expect(result).toBe(-1);
  });

  it('returns positive for better outcome', () => {
    const result = parseFloat(calculateSlippage('10000', '10100'));
    expect(result).toBe(1);
  });

  it('handles zero expected', () => {
    expect(calculateSlippage('0', '100')).toBe('0');
  });
});

describe('generateQuoteId', () => {
  it('starts with "quote-"', () => {
    const id = generateQuoteId();
    expect(id).toMatch(/^quote-/);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateQuoteId()));
    expect(ids.size).toBe(100);
  });

  it('contains timestamp component', () => {
    const id = generateQuoteId();
    const parts = id.split('-');
    // parts[0] = "quote", parts[1] = base36 timestamp
    expect(parts.length).toBeGreaterThanOrEqual(3);
    expect(parts[1]).toBeTruthy();
  });
});

describe('bpsToPercent', () => {
  it('converts basis points to percentage string', () => {
    expect(bpsToPercent(100)).toBe('1.00%');
    expect(bpsToPercent(50)).toBe('0.50%');
    expect(bpsToPercent(1000)).toBe('10.00%');
  });
});

describe('percentToBps', () => {
  it('converts percentage to basis points', () => {
    expect(percentToBps(1)).toBe(100);
    expect(percentToBps(0.5)).toBe(50);
    expect(percentToBps(10)).toBe(1000);
  });

  it('rounds to nearest integer', () => {
    expect(percentToBps(1.555)).toBe(156);
  });
});
