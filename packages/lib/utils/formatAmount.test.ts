import { describe, expect, it } from "vitest";

import { formatAmount } from "./formatAmount";

describe("formatAmount", () => {
  describe("standard currency amounts", () => {
    it("formats whole and sub-dollar amounts with two decimals", () => {
      expect(formatAmount(1.2345, { currency: "usd" })).toBe("$1.23");
      expect(formatAmount(0.5, { currency: "usd" })).toBe("$0.50");
      expect(formatAmount(1234.567, { currency: "usd" })).toBe("$1,234.57");
    });

    it("keeps zero as $0.00", () => {
      expect(formatAmount(0, { currency: "usd" })).toBe("$0.00");
    });

    it("abbreviates millions and billions", () => {
      expect(formatAmount(2_000_000, { currency: "usd" })).toBe("$2.00M");
      expect(formatAmount(3_000_000_000, { currency: "usd" })).toBe("$3.00B");
    });
  });

  describe("tiny currency amounts", () => {
    it("uses subscript notation for many leading zeros (LUNC-style prices)", () => {
      expect(formatAmount(0.00000003, { currency: "usd" })).toBe("$0.0₇3");
      expect(formatAmount(0.0001234, { currency: "usd" })).toBe("$0.0001234");
    });

    it("keeps significant digits instead of rounding to $0.00", () => {
      expect(formatAmount(0.0001, { currency: "usd" })).toBe("$0.0001");
      expect(formatAmount(0.00456, { currency: "usd" })).toBe("$0.00456");
    });

    it("switches to subscript once there are enough leading zeros", () => {
      expect(formatAmount(0.000012345, { currency: "usd" })).toBe("$0.0₄1234");
    });
  });

  describe("non-currency formatting", () => {
    it("respects precision options", () => {
      expect(formatAmount(0.00000003, { precision: "high" })).toBe(
        "0.00000003",
      );
      expect(formatAmount(1.23456, { precision: "medium" })).toBe("1.235");
    });

    it("appends the ticker", () => {
      expect(formatAmount(1.5, { ticker: "BTC" })).toBe("1.5 BTC");
    });
  });
});
