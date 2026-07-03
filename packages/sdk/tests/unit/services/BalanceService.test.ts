import { Chain } from "@vultisig/core-chain/Chain";
import { getCoinBalance } from "@vultisig/core-chain/coin/balance";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CacheService } from "../../../src/services/CacheService";
import { MemoryStorage } from "../../../src/storage/MemoryStorage";
import type { Token } from "../../../src/types";
import { BalanceService } from "../../../src/vault/services/BalanceService";

vi.mock("@vultisig/core-chain/coin/balance", () => ({
  getCoinBalance: vi.fn(),
}));

const token: Token = {
  id: "0x00000000000000000000000000000000000000aa",
  symbol: "USDC",
  name: "USD Coin",
  decimals: 6,
  chainId: Chain.Ethereum,
};

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("BalanceService", () => {
  let cacheService: CacheService;

  beforeEach(() => {
    cacheService = new CacheService(
      new MemoryStorage(),
      "balance-service-test",
    );
    vi.clearAllMocks();
  });

  it("fetches native and token balances across chains in parallel", async () => {
    const pending: Array<{ resolve: (value: bigint) => void }> = [];
    vi.mocked(getCoinBalance).mockImplementation(
      () =>
        new Promise<bigint>((resolve) => {
          pending.push({ resolve });
        }),
    );

    const service = new BalanceService(
      cacheService,
      vi.fn(),
      vi.fn(),
      async (chain) => `${chain}-address`,
      (chain) => (chain === Chain.Ethereum ? [token] : []),
      () => ({ [Chain.Ethereum]: [token] }),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
    );

    const resultPromise = service.getBalances({
      chains: [Chain.Ethereum, Chain.Bitcoin],
      includeTokens: true,
    });

    await flushMicrotasks();

    expect(getCoinBalance).toHaveBeenCalledTimes(3);
    expect(
      vi
        .mocked(getCoinBalance)
        .mock.calls.map(([input]) => [input.chain, input.id]),
    ).toEqual([
      [Chain.Ethereum, undefined],
      [Chain.Ethereum, token.id],
      [Chain.Bitcoin, undefined],
    ]);

    pending[0].resolve(1_000_000_000_000_000_000n);
    pending[1].resolve(5_000_000n);
    pending[2].resolve(100_000_000n);

    const result = await resultPromise;

    expect(result[Chain.Ethereum]?.formattedAmount).toBe("1");
    expect(result[`${Chain.Ethereum}:${token.id}`]?.formattedAmount).toBe("5");
    expect(result[Chain.Bitcoin]?.formattedAmount).toBe("1");
  });
});
