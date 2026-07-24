/**
 * Tests for getTrc20TransferFee - correct endpoint, response-shape validation,
 * non-positive energy guard, full-energy feeLimit margin/cap, and the separate
 * user-displayed fee after sender staked energy is applied.
 *
 * Mirrors iOS TronService.swift:117-126 intent.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vultisig/lib-utils/query/queryUrl", () => ({
  queryUrl: vi.fn(),
}));

vi.mock(
  "@vultisig/core-chain/chains/tron/resources/getTronAccountResources",
  () => ({
    getTronAccountResources: vi.fn(),
  }),
);

vi.mock("./energyPrice", () => ({
  getEnergyPrice: vi.fn(),
}));

import { OtherChain } from "@vultisig/core-chain/Chain";
import { queryUrl } from "@vultisig/lib-utils/query/queryUrl";
import { getTronAccountResources } from "@vultisig/core-chain/chains/tron/resources/getTronAccountResources";
import { getEnergyPrice } from "./energyPrice";
import { getTrc20TransferFee, getTrc20TransferFeeAmount } from "./fee";

const mockQueryUrl = vi.mocked(queryUrl);
const mockGetTronAccountResources = vi.mocked(getTronAccountResources);
const mockGetEnergyPrice = vi.mocked(getEnergyPrice);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ENERGY_PRICE = 280n;

// feeLimit is a ceiling, not the expected cost - mirrors the +50% margin /
// 100 TRX cap applied in fee.ts.
const FEE_LIMIT_MARGIN_BPS = 5_000n;
const FEE_LIMIT_CAP_SUN = 100_000_000n;
function withMargin(exactSun: bigint): bigint {
  const padded = exactSun + (exactSun * FEE_LIMIT_MARGIN_BPS) / 10_000n;
  return padded > FEE_LIMIT_CAP_SUN ? FEE_LIMIT_CAP_SUN : padded;
}

// triggerconstantcontract successful-simulation envelope. Real TronGrid
// responses nest energy_used/energy_penalty alongside a result.result flag.
function successResult(
  overrides: { energy_used?: number; energy_penalty?: number } = {},
) {
  return {
    result: { result: true },
    energy_used: 0,
    energy_penalty: 0,
    ...overrides,
  };
}

function makeResources(available: number) {
  return {
    bandwidth: { available: 5000, total: 5000, used: 0 },
    energy: { available, total: available, used: 0 },
    frozenForBandwidthSun: 0n,
    frozenForEnergySun: 0n,
    unfreezingEntries: [],
  };
}

const coin = {
  address: "TJDENsfBJs4RFETt1X1W8wMDc8M5XnJhd",
  id: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
  chain: OtherChain.Tron,
};

const baseInput = {
  coin,
  amount: 1_000_000n,
  receiver: "TJDENsfBJs4RFETt1X1W8wMDc8M5XnJhd",
};

// triggerconstantcontract response: 65k energy_used, 0 penalty (active destination)
const CONTRACT_ENERGY_USED = 65_000;
const CONTRACT_ENERGY_PENALTY = 0;
const TOTAL_ENERGY = BigInt(CONTRACT_ENERGY_USED + CONTRACT_ENERGY_PENALTY);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getTrc20TransferFee", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEnergyPrice.mockResolvedValue(ENERGY_PRICE);
    // default: no staked energy
    mockGetTronAccountResources.mockResolvedValue(makeResources(0));
  });

  it("calls /wallet/triggerconstantcontract, not /walletsolidity/...", async () => {
    mockQueryUrl.mockResolvedValue(
      successResult({ energy_used: 100, energy_penalty: 0 }),
    );

    await getTrc20TransferFee(baseInput);

    const calledUrl = mockQueryUrl.mock.calls[0][0] as string;
    expect(calledUrl).toMatch(/\/wallet\/triggerconstantcontract$/);
    expect(calledUrl).not.toMatch(/walletsolidity/);
  });

  it("returns (energy_used + energy_penalty) * energyPrice with the feeLimit margin applied", async () => {
    mockQueryUrl.mockResolvedValue(
      successResult({ energy_used: 30000, energy_penalty: 5000 }),
    );
    mockGetTronAccountResources.mockResolvedValue(makeResources(0));

    const fee = await getTrc20TransferFee(baseInput);

    // (30000 + 5000) * 280 = 9_800_000 exact estimate, +50% margin, under the 100 TRX cap
    const exact = 9_800_000n;
    expect(fee).toBe(withMargin(exact));
    expect(fee).toBeGreaterThan(exact);
    expect(fee).toBeLessThanOrEqual(FEE_LIMIT_CAP_SUN);
  });

  it("throws when triggerconstantcontract returns an empty/malformed response (no result field)", async () => {
    mockQueryUrl.mockResolvedValue({});

    await expect(getTrc20TransferFee(baseInput)).rejects.toThrow(
      /did not return a successful estimate/,
    );
  });

  it("throws when triggerconstantcontract simulation reverts (result.result === false)", async () => {
    mockQueryUrl.mockResolvedValue({
      result: { result: false, message: "REVERT opcode executed" },
      energy_used: 0,
      energy_penalty: 0,
    });

    await expect(getTrc20TransferFee(baseInput)).rejects.toThrow(
      "REVERT opcode executed",
    );
  });

  it("throws for the live revert shape (result.result === true with a revert message)", async () => {
    mockQueryUrl.mockResolvedValue({
      result: { result: true, message: "REVERT opcode executed" },
      energy_used: 8624,
      energy_penalty: 6640,
    });

    await expect(getTrc20TransferFee(baseInput)).rejects.toThrow(
      "REVERT opcode executed",
    );
  });

  it("throws when triggerconstantcontract returns an error code despite result.result === true", async () => {
    mockQueryUrl.mockResolvedValue({
      result: { result: true, code: "CONTRACT_VALIDATE_ERROR" },
      energy_used: 100,
      energy_penalty: 0,
    });

    await expect(getTrc20TransferFee(baseInput)).rejects.toThrow(
      "CONTRACT_VALIDATE_ERROR",
    );
  });

  it("propagates queryUrl errors (throw-bubbling contract)", async () => {
    mockQueryUrl.mockRejectedValue(new Error("network error"));

    await expect(getTrc20TransferFee(baseInput)).rejects.toThrow(
      "network error",
    );
  });

  it("rejects negative energy totals instead of producing a negative feeLimit", async () => {
    mockQueryUrl.mockResolvedValue(
      successResult({ energy_used: -5000, energy_penalty: -1000 }),
    );

    await expect(getTrc20TransferFee(baseInput)).rejects.toThrow(
      /non-positive energy estimate/,
    );
  });

  it("rejects zero energy totals instead of producing feeLimit=0", async () => {
    mockQueryUrl.mockResolvedValue(successResult());

    await expect(getTrc20TransferFee(baseInput)).rejects.toThrow(
      /non-positive energy estimate/,
    );
  });

  it("caps feeLimit at 100 TRX for pathological estimates", async () => {
    // 1_000_000 energy * 280 sun = 280_000_000 exact; +50% margin would be
    // 420_000_000, well past the 100 TRX (100_000_000 sun) ceiling.
    mockQueryUrl.mockResolvedValue(
      successResult({ energy_used: 1_000_000, energy_penalty: 0 }),
    );
    mockGetTronAccountResources.mockResolvedValue(makeResources(0));

    const fee = await getTrc20TransferFee(baseInput);

    expect(fee).toBe(FEE_LIMIT_CAP_SUN);
  });

  describe("feeLimit and displayed fee separation", () => {
    beforeEach(() => {
      mockQueryUrl.mockResolvedValue(
        successResult({
          energy_used: CONTRACT_ENERGY_USED,
          energy_penalty: CONTRACT_ENERGY_PENALTY,
        }),
      );
    });

    it("keeps a full-energy feeLimit but displays 0 when staked energy fully covers the call", async () => {
      mockGetTronAccountResources.mockResolvedValue(makeResources(100_000));

      const feeLimit = await getTrc20TransferFee(baseInput);
      const feeAmount = await getTrc20TransferFeeAmount({
        feeLimit,
        fromAddress: coin.address,
      });

      expect(feeLimit).toBe(withMargin(TOTAL_ENERGY * ENERGY_PRICE));
      expect(feeAmount).toBe(0n);
    });

    it("keeps a full-energy feeLimit but displays 0 at the staked-energy boundary", async () => {
      mockGetTronAccountResources.mockResolvedValue(makeResources(65_000));

      const feeLimit = await getTrc20TransferFee(baseInput);
      const feeAmount = await getTrc20TransferFeeAmount({
        feeLimit,
        fromAddress: coin.address,
      });

      expect(feeLimit).toBe(withMargin(TOTAL_ENERGY * ENERGY_PRICE));
      expect(feeAmount).toBe(0n);
    });

    it("displays only the expected partial burn when sender has some staked energy", async () => {
      mockGetTronAccountResources.mockResolvedValue(makeResources(30_000));

      const feeLimit = await getTrc20TransferFee(baseInput);
      const feeAmount = await getTrc20TransferFeeAmount({
        feeLimit,
        fromAddress: coin.address,
      });

      expect(feeLimit).toBe(withMargin(TOTAL_ENERGY * ENERGY_PRICE));
      expect(feeAmount).toBe(35_000n * ENERGY_PRICE);
    });

    it("displays the unpadded full burn when sender has zero staked energy", async () => {
      mockGetTronAccountResources.mockResolvedValue(makeResources(0));

      const feeLimit = await getTrc20TransferFee(baseInput);
      const feeAmount = await getTrc20TransferFeeAmount({
        feeLimit,
        fromAddress: coin.address,
      });

      expect(feeLimit).toBe(withMargin(TOTAL_ENERGY * ENERGY_PRICE));
      expect(feeAmount).toBe(TOTAL_ENERGY * ENERGY_PRICE);
    });

    it("displays the unpadded full burn when resources fetch throws", async () => {
      const feeLimit = await getTrc20TransferFee(baseInput);
      mockGetTronAccountResources.mockRejectedValue(new Error("network error"));

      const feeAmount = await getTrc20TransferFeeAmount({
        feeLimit,
        fromAddress: coin.address,
      });

      expect(feeAmount).toBe(TOTAL_ENERGY * ENERGY_PRICE);
    });

    it("accounts for energy_penalty in both the ceiling and expected burn", async () => {
      mockQueryUrl.mockResolvedValue(
        successResult({
          energy_used: 65_000,
          energy_penalty: 10_000,
        }),
      );
      // 50k available, 75k needed -> 25k burned
      mockGetTronAccountResources.mockResolvedValue(makeResources(50_000));

      const feeLimit = await getTrc20TransferFee(baseInput);
      const feeAmount = await getTrc20TransferFeeAmount({
        feeLimit,
        fromAddress: coin.address,
      });

      expect(feeLimit).toBe(withMargin(75_000n * ENERGY_PRICE));
      expect(feeAmount).toBe(25_000n * ENERGY_PRICE);
    });
  });
});
