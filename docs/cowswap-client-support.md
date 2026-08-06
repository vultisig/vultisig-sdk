# CowSwap client support

CowSwap is an available SDK quote provider, not a promise that every Vultisig
client can execute CowSwap orders. Clients must exclude it unless their complete
transaction path can approve the sell token when required, produce the CowSwap
EIP-712 order signature, submit the order, and track its off-chain lifecycle.

## First-party client matrix

| Client            | CowSwap quote eligibility | Current support | Reason                                                                                                                                                           |
| ----------------- | ------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iOS               | Not integrated            | Unsupported     | The native iOS swap stack does not call this SDK quote resolver or implement the CowSwap order-signing flow.                                                     |
| Android           | Not integrated            | Unsupported     | The native Android swap stack recognizes the CowSwap settlement contract for transaction safety, but does not call this SDK provider or implement order signing. |
| Windows           | Explicitly excluded       | Unsupported     | The desktop client shares the Windows quote and MPC path described below; CowSwap is removed before quote fetch and ranking.                                     |
| Browser extension | Explicitly excluded       | Unsupported     | The extension consumes the same shared quote and MPC code as Windows, so the same pre-ranking exclusion applies.                                                 |

“Not integrated” and “explicitly excluded” are both fail-closed states: CowSwap
cannot win a quote that the client cannot execute. They differ only because the
native mobile clients do not use this TypeScript provider path, while Windows
and the extension do.

## Windows and extension verification

A real extension test on Ethereum selected a CowSwap quote for a funded 5 USDC
to VULT swap and continued through review into the Fast Vault MPC signing
screen. The signing operation timed out without producing a CowSwap order UID
or an asset transfer. This confirms a late failure, not end-to-end client
support.

Windows and the extension therefore pass `excludeProviders: ['CowSwap']` on
every shared product quote entry point. The SDK applies exclusions before
provider fetch and ranking, so the client falls through to a provider whose
transaction shape it can execute.

## SDK default policy

The SDK keeps CowSwap available by default. The library can build CowSwap quote
and order data, but it cannot infer whether a caller's signing runtime supports
the required EIP-712 and order-submission lifecycle. Flipping the global default
to opt-in would silently change quote behavior for independent SDK consumers
that may already provide that capability.

Capability belongs at the client boundary instead:

- A caller with a proven complete CowSwap execution path may use the default.
- A caller without that proof must pass `excludeProviders: ['CowSwap']`.
- Exclusion must be supplied before calling `findSwapQuote`; filtering a winning
  quote afterward is too late.

The provider registration is defined in
[`GeneralSwapProvider.ts`](../packages/core/chain/swap/general/GeneralSwapProvider.ts),
and the typed exclusion contract and pre-fetch behavior are defined in
[`findSwapQuote.ts`](../packages/core/chain/swap/quote/findSwapQuote.ts).
