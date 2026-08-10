# Signable transaction contract v1

The SDK owns a versioned boundary between transaction construction, user-visible review, approval, and signing. Version 1 binds the exact unsigned payload to canonical decoded actions and to the exact material fields shown to the user.

## Contract flow

1. A chain-family adapter decodes the unsigned payload and normalizes it to the v1 action union.
2. `createSignableTransactionEnvelopeV1` rejects unknown or incomplete semantics, checks action context and explicit fee/slippage bounds, and builds the material display fields.
3. The envelope records the exact payload and the SHA-256 digest of its decoded bytes, canonical actions, the display and its canonical policy digest, expiry, and a one-time approval binding. The display digest binds material fields and explicit fee/slippage bounds; the current bounded values are validated against the candidate decode.
4. The approval store persists the full `envelope.approval` receipt independently of the candidate envelope. A consumer renders `envelope.display` with its action-specific UI. Immediately before signing it calls `verifySignableTransactionEnvelopeV1` with the candidate payload, that same rendered display, the trusted approval receipt, current time, and an atomic approval-binding reservation callback.
5. The verifier calls that callback only after every semantic and equality fence passes, and returns valid only when the store atomically reserves the previously unused `approvalBindingKey`. The reservation happens before dispatching a sign request. A failed sign attempt does not release it; retry requires a fresh approval. Concurrent or repeated attempts must fail with `approval-replay`.

The verifier re-decodes the candidate payload and compares the independently loaded approval binding digest. It does not trust an envelope merely because its hashes are internally consistent.

## Exact and bounded fields

The normalized action schemas make chain, source account, recipient, asset, base-unit amount, memo, spender/allowance, swap minimum output, and action count exact. Expiry is exact at the envelope level. Any change is a rejection.

Decoded fee and slippage values are exact for the bound unsigned payload. A builder may declare an explicit displayed minimum and maximum when the value is created; the actual decoded value must remain inside those bounds. Missing bounds default to `min = value = max`. Bounds never authorize mutation of the already-bound unsigned payload.

Amounts, limits, fees, and basis points are base-10 integer strings. This avoids floating-point and bigint serialization drift. Unsigned payload encodings are canonical (`hex` is lowercase, even-length and prefix-free; `base64` is padded).

## Decoder rule

Each adapter implements both `decode` and `normalize`. `decode` may return a chain-native AST. `normalize` must return either:

- `status: "decoded"` with complete canonical actions and any fee/slippage observation; or
- `status: "unknown"` with a reason.

Never coerce an unknown selector, hidden batch member, partial instruction, unrecognized message, or incomplete nested call into an ordinary approved action. Existing chain-specific guards remain in force during migration.

## Consumer migration owners

Migration is deliberately outside issue #1447. Owners should adopt v1 without deleting their current chain-specific fences:

| Surface       | Owner                                            | Adoption responsibility                                                                                                                |
| ------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Shared app    | `vultisig-app` transaction-review owner          | Render the v1 material fields with action-specific UI and pass the exact rendered display to verification.                             |
| Agent backend | `agent-backend-ts` execution owner               | Create/persist envelopes, allocate approval id/nonces, and atomically reserve approval binding keys before dispatching a sign request. |
| iOS           | `vultisig-app` iOS transaction-signing owner     | Add family decoders/normalizers and keep current iOS chain-specific confirmation guards until parity fixtures pass.                    |
| Android       | `vultisig-app` Android transaction-signing owner | Add family decoders/normalizers and keep current Android chain-specific confirmation guards until parity fixtures pass.                |
| Desktop       | `vultisig-app` desktop transaction-signing owner | Carry the envelope across desktop/extension boundaries without re-parsing or reprioritizing material fields.                           |

Every consumer should run the shared `SignableTransactionFixtureV1` format. The fixture candidate contains the unsigned payload, normalized decode result, rendered display, approval state, time, consumed bindings, and expected issue codes, so implementations in other languages can replay the same pass/reject cases.
