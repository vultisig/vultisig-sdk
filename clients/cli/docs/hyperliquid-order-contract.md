# Hyperliquid signed-order backend contract

The CLI recognizes the client-side tool `hl_order`. Its SSE input contains only
`order_ref`, `conversation_id`, and the expected order `digest`; no raw action or
signature is sent through chat.

All three calls require the normal vault JWT and bind `public_key`,
`conversation_id`, and the opaque `order_ref`:

- `POST /agent/hyperliquid/orders/:order_ref/signing-payload`
- `POST /agent/hyperliquid/orders/:order_ref/submit`
- `POST /agent/hyperliquid/orders/:order_ref/status`

Retrieve request:

```json
{ "conversation_id": "<uuid>", "public_key": "<ecdsa-pubkey>" }
```

Retrieve response:

```json
{
  "order_ref": "<opaque one-use reference>",
  "conversation_id": "<uuid>",
  "owner_public_key": "<ecdsa-pubkey>",
  "vault_address": "0x...",
  "expires_at": "<RFC3339, no more than 10 minutes ahead>",
  "summary": {
    "operation": "open",
    "coin": "BTC",
    "asset_index": 0,
    "side": "long",
    "size": "0.001",
    "notional_usd": "30",
    "order_type": "limit",
    "limit_price": "30000.0",
    "tif": "Gtc",
    "reduce_only": false,
    "leverage": 3,
    "margin_mode": "cross"
  },
  "steps": [
    {
      "kind": "update_leverage",
      "action": {
        "type": "updateLeverage",
        "asset": 0,
        "isCross": true,
        "leverage": 3
      },
      "nonce": 1,
      "is_mainnet": true,
      "digest": "0x..."
    },
    {
      "kind": "order",
      "action": {
        "type": "order",
        "orders": [
          {
            "a": 0,
            "b": true,
            "p": "30000.0",
            "r": false,
            "s": "0.001",
            "t": { "limit": { "tif": "Gtc" } }
          }
        ],
        "grouping": "na"
      },
      "nonce": 2,
      "is_mainnet": true,
      "digest": "0x..."
    }
  ]
}
```

The CLI recomputes every phantom-agent digest byte-for-byte from msgpack action,
nonce, vault marker, network source, and the Exchange EIP-712 domain. It refuses
owner/conversation/address/reference drift, expired or overlong leases, digest
tampering, missing leverage updates, non-reduce-only closes, or any drift in the
explicit asset index, exact decimal size, signed price, derived decimal notional,
order type, limit price, or TIF. Leverage update must precede the order.

After explicit high-distrust confirmation, the CLI MPC-signs each digest locally
and sends signatures only to the submit endpoint:

```json
{
  "conversation_id": "<uuid>",
  "public_key": "<ecdsa-pubkey>",
  "signatures": [
    {
      "kind": "update_leverage",
      "digest": "0x...",
      "r": "0x...",
      "s": "0x...",
      "v": 27
    },
    { "kind": "order", "digest": "0x...", "r": "0x...", "s": "0x...", "v": 28 }
  ]
}
```

Submit/status response:

```json
{
  "state": "submitting|accepted|resting|filled|rejected|cancelled",
  "order_id": "...",
  "filled_size": "...",
  "average_price": "...",
  "reason": "..."
}
```

HTTP 200 alone is not success. The CLI polls a `submitting` or `accepted` result until the
backend reports a venue state; `rejected` and `cancelled` become failed actions.
The backend must apply the leverage step first and must not submit the order if
that step fails. Backend submission state is durable: an ambiguous leverage update
may resume only after its lease, while an ambiguous order submission requires
reconciliation and is never retried automatically. The CLI reports only safe status fields through
`recent_actions`. Raw actions and signatures never enter chat, stdout, or verbose
logs. The backend must make retrieval and submission replay-safe and idempotent,
and must keep `HL_PERPS_ENABLED` off by default until review and no-broadcast QA
finish.
