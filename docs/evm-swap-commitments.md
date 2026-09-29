# EVM swap preparation commitments

`prepareSwapTxFromKeys` (also used by `SwapService`) checks the transaction's
independently interpretable source asset, gross input amount and deadline after
snapshotting and verifying the bound quote, before public-key or payload work.
A fingerprint computed over an already inconsistent provider response does not
bypass these checks. Amounts and on-chain deadlines remain `bigint`.

This is a partial semantic check, not transaction authentication or a complete
interpreter. Router identity **and** a recognized ABI are required; recognizing
four selector bytes at an arbitrary address is insufficient. Known malformed
outer calldata rejects. Unknown routers, unknown selectors and ambiguous inner
formats retain the existing quote-level protections, including the five-minute
preparation lifetime (or a stricter provider expiry). The presentation refresh
window, structured-clone contract and public `SwapQuoteExpiredError` are unchanged.

## Supported contracts

| Contract / layout                                                                    | Source commitment                                                                                                                | Deadline                                                                        |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1inch V5 `swap`, V6 `swap`                                                           | `desc.amount`, gross before any partial-fill refund; native value must agree, ERC-20 value must be zero                          | None in the outer ABI                                                           |
| V6 `unoswap*` / `unoswapTo*`, first pool V2 or Curve                                 | `amount`, with low 160 bits of packed `token` identifying the debited asset                                                      | None                                                                            |
| V6 `ethUnoswap*` / `ethUnoswapTo*`                                                   | Native transaction value                                                                                                         | None                                                                            |
| Kyber MetaAggregationRouterV2 `swap`, `swapGeneric`, `swapSimpleMode`                | Gross `desc.amount`, before source fees; native value must agree                                                                 | Simple mode's `SimpleSwapData.deadline`; inclusive                              |
| Ethereum THORChain Router v4.1.1 `depositWithExpiry`                                 | ERC-20 encoded amount; native asset uses **transaction value**, ignoring the encoded amount                                      | `expiration`; exclusive                                                         |
| Ethereum Universal Router at `0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad`, `execute` | Single payer-funded V2/V3 exact-input leg; or WRAP_ETH followed by a router-funded WETH exact-input leg, using transaction value | Three-argument outer deadline; inclusive, even when the inner amount is unknown |

1inch and Kyber reuse the existing router allowlist, including chain-specific
1inch deployments. V5 and V6 select separate ABIs. THOR and Universal Router
support is deliberately restricted to the named verified Ethereum deployments;
the same selector on another chain or deployment does not establish semantics.

Authoritative sources inspected for these layouts:

- [1inch V6 verified source and ABI](https://etherscan.io/address/0x111111125421ca6dc452d289314280a0f8842a65#code): `GenericRouter`, `UnoswapRouter`, `ProtocolLib` and callback source.
- [1inch V5 verified source and ABI](https://etherscan.io/address/0x1111111254eeb25477b68fb85ed929f73a960582#code): `GenericRouter.swap` includes a separate permit argument.
- [Kyber verified source and ABI](https://etherscan.io/address/0x6131b5fae19ea4f9d964eac0408e4408b66337b5#code): `SwapDescriptionV2`, `_takeFee`, `_collectExtraETHIfNeeded`, `_swapMultiSequencesWithSimpleMode`.
- [THORChain sending contract](https://dev.thorchain.org/concepts/sending-transactions.html): native deposits use `msg.value`; [verified deployment](https://etherscan.io/address/0xd37bbe5744d730a1d98d8dc97c42f0ca46ad7146#code).
- [Universal Router verified deployment](https://etherscan.io/address/0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad#code): `UniversalRouter`, `Dispatcher`, `Payments`, `V2SwapRouter`, `V3SwapRouter`, `Permit2Payments` and `Constants`.

## Explicit residuals

- 1inch V6 `unoswap*` with a first V3 pool obtains the debit token from the pool,
  **not** the packed token argument. These calls remain amount-unchecked until
  that asset can be established independently; treating an ignored argument as
  authority both rejects valid calls and misattributes units.
- 1inch/Kyber extra-ETH flag routes remain amount-unchecked: the outer value can
  include a separately authorized fee. No arbitrary tolerance is invented.
  A known Kyber simple-mode deadline is still enforced.
- Kyber generic executor deadlines are opaque. Only the router's own simple-mode
  deadline has a verified layout here; output fees are never mistaken for input.
- Universal Router exact-output maxima, split/mixed routes, subplans, allow-revert
  commands, router-funded token balances and unknown inner formats remain
  amount-unchecked. Their known outer deadline is always retained. The numeric
  `CONTRACT_BALANCE` and `ALREADY_PAID` sentinels are never compared as literal
  wallet input amounts. For supported wrapped native calls, the wallet debit is
  `tx.value`, not the router's pre-existing balance. This binds the gross native
  debit; it does not prove that every unit is wrapped or consumed by the swap,
  or that no balance remains in the router. Recognized single unwrapped token
  legs require zero native value, including router-funded and sentinel legs
  whose token amount remains unknown.
- Direct Uniswap V2/V3 routers, newer Universal Router deployments, 1inch Clipper,
  limit-order/permit wrappers, LI.FI and other SwapKit wrappers remain outside
  this decoder. Existing router/reputation, quote-binding and expiry safeguards
  continue to apply; this change does not claim complete EVM calldata coverage.
- This checks preparation consistency, not actual execution or co-signer intent
  display. Signing-time display reuse requires its own integration and proof.

Regression coverage constructs inconsistent calldata **before** calculating a
valid quote fingerprint. Unsigned live quote/preparation checks establish current
provider compatibility; no signing, approval or broadcast is required to test
this preparation boundary.
