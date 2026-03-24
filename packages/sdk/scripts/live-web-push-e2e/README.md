# Live Web Push E2E (production notification server)

Manual (or semi-automated) verification against the **real** `https://api.vultisig.com/notification` base URL (same as the iOS app): browser Web Push subscription, production `/notify`, service worker `showNotification()`, and optional notification click.

This is not a Vitest suite; it is an occasional harness similar to “run the app against prod.”

## What “success” means (tiers)

| Tier | What it proves | How |
|------|----------------|-----|
| **A — Web Push to service worker** (default exit) | FCM/web push reached the browser; SW ran `push`; `showNotification()` outcome is recorded | Terminal + `GET /api/verification` → `pushAck`, `lastSwShowNotificationOk` |
| **B — WebSocket signing payload (diagnostic)** | Server streamed the same signing payload Node clients use | Terminal “Diagnostic: production WebSocket…” + `wsReceived` in `/api/verification` |
| **C — Product / extension-style** | User saw a notification and clicked it (OS banner, Notification Centre, or page `Notification()` fallback) | `POST /ack?evt=click` → terminal click line; set `PUSH_E2E_SUCCESS=click` |
| **D — Harness in-page banner** | Push payload reached the tab; independent of macOS hiding toasts for **focused** Chrome | Purple top bar + **Acknowledge** button (same `/ack?evt=click` as a real click) |

**Stakeholder expectation:** tier **C** on **Windows** (and macOS with correct settings + often **Chrome not focused**) matches extension UX. Tier **D** proves the **same Web Push + payload** path when the OS shows nothing. Tier **A** is the best **automatable** proxy without any UI.

**macOS quirk:** with only **Desktop** + **Temporary** alerts and **Notification Centre off**, you may see **no toast while Chrome is the frontmost app** — other apps feel “fine” because they usually notify while in the background. Use **Test system notification only** after register: if that also vanishes, blur Chrome (e.g. switch to Finder) and try again; enable **Notification Centre** + **Persistent** for Chrome.

## What is being tested

1. **Register** — Browser subscribes with the server’s VAPID key and POSTs the Web Push subscription JSON to `/register` (`device_type: web`), with the same `vault_id` as other Vultisig clients.
2. **Notify** — The helper calls `/notify` as another logical party (`sdk-live-e2e-sender`) so your browser is **not** excluded (the server skips the initiating `local_party_id`).
3. **Deliver** — The notification worker sends a Web Push payload shaped like production (`title` / `subtitle` / `body`).
4. **OS / page UI** — The service worker calls `showNotification`. The page shows a **fixed purple banner** when the push is handled, a **`Notification()` fallback**, and an **Acknowledge** button (all wired to the same click ack where applicable).
5. **Optional click** — On click, the service worker, page notification, or in-page button POSTs `/ack?evt=click`.

**Not tested here:** iOS APNs or Android FCM native tokens — only **Web Push** in Chrome/Edge.

## Prerequisites

- Chrome or Edge (Chromium Web Push).
- macOS/Windows/Linux with OS notifications allowed for the browser (see troubleshooting for macOS Chrome).
- Either `TEST_VAULT_PATH` + `TEST_VAULT_PASSWORD` (e.g. in `tests/e2e/.env`), **or** a precomputed `vault_id` / pubkey + chain code (see below).

## Vault id

**Option A — E2E test vault (recommended):** if `packages/sdk/tests/e2e/.env` defines `TEST_VAULT_PATH` and `TEST_VAULT_PASSWORD`, you do **not** need the hex. The helper loads the vault, derives `vault_id`, and uses the vault name in the notification (unless `PUSH_E2E_VAULT_NAME` is set):

```bash
cd packages/sdk
yarn live-push-e2e
```

**Option B — already have the hex `vault_id`:**

```bash
export PUSH_E2E_VAULT_ID='<64 lowercase hex chars>'
```

**Option C — from ECDSA public key + hex chain code** (from vault details / another app):

```bash
export PUSH_E2E_ECDSA_HEX='...'
export PUSH_E2E_HEX_CHAIN_CODE='...'
# Optional: print id only
yarn workspace @vultisig/sdk live-push-e2e:print-vault-id
```

The server loads `packages/sdk/tests/e2e/.env` when present so `TEST_VAULT_*` and other vars apply automatically.

## Run

From the monorepo root:

```bash
cd packages/sdk
# or with env inline:
PUSH_E2E_VAULT_ID='...' yarn live-push-e2e
```

### Environment

- `PUSH_E2E_SUCCESS` — **`push`** (default): exit when the service worker push handler reports success (HTTP push ack). If you click after that, the helper exits on the click **only when `pushAck` is already true** (so a stray `ack?evt=click` cannot finish the run early). **`click`**: exit only when the user clicks a notification (OS or page fallback). **`ws`**: exit when Node receives the WebSocket signing payload (diagnostic only; not a substitute for visible UI sign-off).
- `PUSH_E2E_VAULT_NAME` — subtitle text (default: vault name or `SDK live e2e`).
- `NOTIFICATION_URL` — default `https://api.vultisig.com/notification`.
- `PUSH_E2E_PORT` — fixed port (default: random).
- `PUSH_E2E_WAIT_MS` — max wait (default: 600000).

## Steps (human, visible notification)

1. Start the command above; note the printed `http://127.0.0.1:PORT` URL.
2. Open that URL in Chrome or Edge (**use the same host as printed**, usually `127.0.0.1`).
3. Click **Register service worker & Web Push** and allow notifications.
4. (Recommended) Click **Test system notification only** — if no OS toast appears, switch to **Finder** and click again; adjust Chrome notification settings per the yellow callout.
5. Click **Send test notification**.
6. You should always see the **purple top bar** when a push is handled (delivery proof in the tab). For the **OS** toast: enable **Notification Centre** + **Persistent** for Chrome (see on-page callout); if you still see nothing, **blur Chrome** (e.g. switch to Finder) — macOS often skips Desktop banners for the focused browser.
7. Complete the flow by clicking the **system** notification, the **page `Notification()`**, or **Acknowledge** on the purple bar (all post `/ack?evt=click` where applicable).
8. With `PUSH_E2E_SUCCESS=click`, the terminal prints the click ack and exits. With default `push`, the helper may exit as soon as the SW reports the push — click is still recommended for tier C.

Press Ctrl+C to stop early; the script attempts to **unregister** this browser from the live server.

## Verification API (for agents)

While the helper is running:

```http
GET http://127.0.0.1:PORT/api/verification
```

JSON fields include: `pushAck`, `clickAck`, `wsReceived`, `lastPushTitle`, `lastSwShowNotificationOk`, `successMode`, `wsConnectionState`.

Poll helper (no `jq` required):

```bash
node packages/sdk/scripts/live-web-push-e2e/poll-harness-verification.mjs <port> pushAck 120000
```

## Automation, Playwright, and “real browser QA”

- **Native OS notifications** (Notification Centre, Windows toast) are **outside** the page. Chrome DevTools Protocol and Playwright **do not** expose a stable selector or event for “system notification appeared” or “user clicked banner.”
- **What you can automate end-to-end:** open the harness URL (extension mode with your Chrome profile, or headed Chromium with `grantPermissions` for notifications if the profile allows), click Register and Send, then poll **`/api/verification`** until `pushAck` is true. That matches **tier A**.
- **Playwright CLI / fresh profile:** Chromium often denies notification permission without a prompt, so Web Push may fail; prefer **normal Chrome/Edge** for tier C, or extension-mode Playwright with a profile that allows notifications.
- **MetaMask-style CDP helpers** in `real-browser-qa` drive **page** tabs only — same limitation for OS notifications. Extend automation via **this HTTP API**, not by expecting CDP to “see” the toast.

Paste terminal lines **and/or** the JSON from `/api/verification` when reporting results.

## Windows extension parity (reference)

Compare Web Push registration, subscription JSON shape, and service worker handling with `../windows/clients/extension/` when that repo is checked out beside this one (search for Web Push / `showNotification` / service worker). This SDK harness uses the same production notification base path as iOS (`/notification`, not `/push`).

## Server deduplication

Production `/notify` deduplicates by `vault_id` for about **30 seconds**. If you send twice quickly, the second request may return 200 without a new push. Wait ~30s or restart the helper (a new browser party name is generated each run unless you set `PUSH_E2E_BROWSER_PARTY`).

## Troubleshooting

- **`Failed to fetch` right after “Service worker active”:** the production notification base URL must be **`https://api.vultisig.com/notification`** (paths `/vapid-public-key`, `/register`), not `/push`. VAPID is loaded same-origin via **`/api/vapid-public-key`** on the helper.
- **“Send test notification” stays disabled:** usually **notification permission denied** (automation browsers often deny by default) or an earlier step failed. Use your **normal Chrome/Edge profile**, click **Allow**, then Register again.
- **Origin:** stay consistent with the printed URL (`127.0.0.1` vs `localhost` — different origins for the service worker).
- **401/403 from push service:** subscription or VAPID mismatch — retry registration from a clean profile.

### No banner but `ack?evt=push` in Network (or `pushAck` true)

The push **did** reach your machine. On **macOS**, open **System Settings → Notifications → Google Chrome**:

- If **Notification Centre** is **off**, the sidebar stays **empty** — you may only get a very short **Desktop** banner (**Temporary** style).
- For testing, turn **on** Notification Centre, consider **Persistent** alerts, and optionally enable sound.

The test page also shows a **page-level `Notification()`** after each push; clicking **either** notification sends `POST /ack?evt=click`.

After pulling updates, reload so the new service worker installs (`/sw.js?v=…` bumps the script URL).

### CLI / headless Node and “system notifications”

The SDK in **plain Node** cannot draw macOS/Windows toast UI. Real OS notifications need a **host** (browser service worker, Electron `Notification`, etc.). Use this harness for Web Push; use **`/api/verification`** or `sdk.notifications.connect` for machine-verifiable signals.
