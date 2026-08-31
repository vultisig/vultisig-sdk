import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetCoinBalance,
  mockGetJettonWalletAddress,
  mockGetKeysignCoin,
  mockGetTonAccountInfo,
} = vi.hoisted(() => ({
  mockGetCoinBalance: vi.fn(async () => 0n),
  mockGetJettonWalletAddress: vi.fn(),
  mockGetKeysignCoin: vi.fn(),
  mockGetTonAccountInfo: vi.fn(),
}));

vi.mock("@vultisig/core-chain/chains/ton/account/getTonAccountInfo", () => ({
  getTonAccountInfo: mockGetTonAccountInfo,
}));
vi.mock("@vultisig/core-chain/chains/ton/api", () => ({
  getJettonWalletAddress: mockGetJettonWalletAddress,
  getTonWalletState: vi.fn(async () => "active"),
}));
vi.mock("@vultisig/core-chain/coin/balance", () => ({
  getCoinBalance: mockGetCoinBalance,
}));
vi.mock("../../../fee/resolvers/ton", () => ({ getTonFeeAmount: () => 0n }));
vi.mock("../../../utils/getKeysignCoin", () => ({
  getKeysignCoin: mockGetKeysignCoin,
}));
vi.mock("../../../utils/getKeysignAmount", () => ({
  getKeysignAmount: () => 0n,
}));

import { getTonChainSpecific } from "./index";

type Payload = Parameters<typeof getTonChainSpecific>[0]["keysignPayload"];

const nativeCoin = { address: "srcAddr", ticker: "TON", id: undefined };
const jettonCoin = { address: "srcAddr", ticker: "USDT", id: "EQjettonMaster" };
const senderJettonWallet = "EQCIcjES4cQET0z6nRixZ0MdvTB4u3_8triztLSrIIrDkpgJ";

// Amount sits one nanoton under the balance below, which the removed heuristic read as
// a MAX send.
const payload = {
  toAddress: "EQdest",
  toAmount: "999999999",
} as unknown as Payload;

const resolve = () =>
  getTonChainSpecific({ keysignPayload: payload, walletCore: {} as never });

describe("getTonChainSpecific — seqno on an uninitialized wallet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetKeysignCoin.mockReturnValue(nativeCoin);
  });

  it("does NOT throw and yields seqno 0 when account_state is absent (first send / uninitialized)", async () => {
    // getExtendedAddressInformation returns a result WITHOUT account_state for a
    // wallet that received funds but never sent — the pre-fix direct
    // `account_state.seqno` crashed here.
    mockGetTonAccountInfo.mockResolvedValueOnce({ balance: "1000000000" });
    const res = await resolve();
    expect(res.sequenceNumber).toBe(0n);
  });

  it("reads the seqno from account_state for an initialized wallet", async () => {
    mockGetTonAccountInfo.mockResolvedValueOnce({
      account_state: { wallet_id: "w", seqno: 7 },
    });
    const res = await resolve();
    expect(res.sequenceNumber).toBe(7n);
  });
});

describe("getTonChainSpecific — sendMaxAmount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetKeysignCoin.mockReturnValue(nativeCoin);
    mockGetTonAccountInfo.mockResolvedValue({ account_state: { seqno: 1 } });
    mockGetCoinBalance.mockResolvedValue(1_000_000_000n);
  });

  it("records the flag the caller passed, whatever the amount looks like", async () => {
    const dustSend = { ...payload, toAmount: "1" } as unknown as Payload;

    const res = await getTonChainSpecific({
      keysignPayload: dustSend,
      walletCore: {} as never,
      sendMaxAmount: true,
    });

    expect(res.sendMaxAmount).toBe(true);
  });

  // The removed heuristic flagged any `amount + fee >= balance` send as MAX, so typing
  // an amount near your balance silently relabelled an ordinary send.
  it("leaves a near-balance send unflagged when the caller did not ask for MAX", async () => {
    const res = await getTonChainSpecific({
      keysignPayload: payload,
      walletCore: {} as never,
    });

    expect(res.sendMaxAmount).toBe(false);
  });

  it("does not read the balance at all — nothing is inferred from it", async () => {
    await getTonChainSpecific({
      keysignPayload: payload,
      walletCore: {} as never,
    });

    expect(mockGetCoinBalance).not.toHaveBeenCalled();
  });
});

describe("getTonChainSpecific — jetton wallet resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTonAccountInfo.mockResolvedValue({ account_state: { seqno: 1 } });
    mockGetKeysignCoin.mockReturnValue(jettonCoin);
    mockGetJettonWalletAddress.mockResolvedValue(senderJettonWallet);
  });

  it("records the resolved sender jetton wallet", async () => {
    const res = await resolve();

    expect(res.jettonAddress).toBe(senderJettonWallet);
  });

  // Before this, a failed lookup left jettonAddress as '' and the payload was built
  // anyway — the empty string passed every null/undefined check downstream and became
  // a transfer with no destination.
  it("refuses to build a payload when the lookup fails", async () => {
    mockGetJettonWalletAddress.mockRejectedValue(
      new Error("No jetton wallet found"),
    );

    await expect(resolve()).rejects.toThrow(
      /Unable to resolve the USDT jetton wallet/,
    );
  });

  it("keeps the underlying failure as the cause", async () => {
    const cause = new Error("No jetton wallet found");
    mockGetJettonWalletAddress.mockRejectedValue(cause);

    await expect(resolve()).rejects.toMatchObject({ cause });
  });

  it.each([
    ["an empty string", ""],
    ["blank whitespace", "   "],
  ])(
    "refuses to build a payload when the lookup returns %s",
    async (_, resolved) => {
      mockGetJettonWalletAddress.mockResolvedValue(resolved);

      await expect(resolve()).rejects.toThrow(
        /Unable to resolve the USDT jetton wallet/,
      );
    },
  );

  it("never consults the jetton lookup for a native TON send", async () => {
    mockGetKeysignCoin.mockReturnValue(nativeCoin);

    const res = await resolve();

    expect(mockGetJettonWalletAddress).not.toHaveBeenCalled();
    expect(res.jettonAddress).toBe("");
  });
});
