import { Chain } from "@vultisig/core-chain/Chain";
import { describe, expect, it, vi } from "vitest";

import type { Balance } from "../../../src/types";
import { VaultBase } from "../../../src/vault/VaultBase";

describe("VaultBase balancesWithPrices", () => {
  it("batches native price fetches and prices token balances separately", async () => {
    const tokenId = "0x00000000000000000000000000000000000000aa";
    const balances: Record<string, Balance> = {
      [Chain.Ethereum]: {
        amount: "1000000000000000000",
        formattedAmount: "1",
        decimals: 18,
        symbol: "ETH",
        chainId: Chain.Ethereum,
      },
      [`${Chain.Ethereum}:${tokenId}`]: {
        amount: "5000000",
        formattedAmount: "5",
        decimals: 6,
        symbol: "USDC",
        chainId: Chain.Ethereum,
        tokenId,
      },
      [Chain.Bitcoin]: {
        amount: "100000000",
        formattedAmount: "1",
        decimals: 8,
        symbol: "BTC",
        chainId: Chain.Bitcoin,
      },
    };

    const getPrices = vi.fn().mockResolvedValue({
      [Chain.Ethereum]: 3000,
      [Chain.Bitcoin]: 50000,
    });
    const getPrice = vi.fn().mockResolvedValue(1);

    const vault = {
      _currency: "usd",
      balances: vi.fn().mockResolvedValue(balances),
      fiatValueService: {
        getPrices,
        getPrice,
      },
    };

    const result = await VaultBase.prototype.balancesWithPrices.call(
      vault as never,
      [Chain.Ethereum, Chain.Bitcoin],
      true,
      "usd",
    );

    expect(vault.balances).toHaveBeenCalledWith(
      [Chain.Ethereum, Chain.Bitcoin],
      true,
    );
    expect(getPrices).toHaveBeenCalledWith(
      [Chain.Ethereum, Chain.Bitcoin],
      "usd",
    );
    expect(getPrice).toHaveBeenCalledTimes(1);
    expect(getPrice).toHaveBeenCalledWith(Chain.Ethereum, tokenId, "usd");
    expect(result[Chain.Ethereum]).toMatchObject({
      value: 3000,
      fiatValue: 3000,
      fiatCurrency: "usd",
    });
    expect(result[`${Chain.Ethereum}:${tokenId}`]).toMatchObject({
      value: 1,
      fiatValue: 5,
      fiatCurrency: "usd",
    });
    expect(result[Chain.Bitcoin]).toMatchObject({
      value: 50000,
      fiatValue: 50000,
      fiatCurrency: "usd",
    });
  });
});
