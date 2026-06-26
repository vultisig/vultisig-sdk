---
'@vultisig/cli': patch
---

Harden agent conversation auth across every path. A revoked-but-unexpired
cached token now recovers uniformly: a new `withAuthRetry` helper does
clear→reauth→retry-once and wraps the fresh-conversation `createConversation`
(previously unguarded — it hard-threw `Authentication failed`), the resume
`getConversation`, the send-message stream, and the `agent sessions
list`/`delete` commands.

A `--session-id` resume whose 401 survives the single retry — or that fails for
any other reason — now falls back to a fresh conversation instead of throwing
uncaught, and emits a typed, non-fatal `SESSION_NOT_FOUND` signal carrying the
new conversation id so a headless caller knows prior context was dropped.

Models the backend's `refresh_token`/`access_token` in `AuthTokenResponse` and
persists the refresh token in the token cache (0o600) for a future
`POST /auth/refresh` exchange; the retry path re-auths via MPC re-sign today.
The retry preserves a previously cached refresh token when the re-auth response
omits one, and the cache directory is chmod'd to 0o700 on every write (not only
on create) so a pre-existing `~/.vultisig` can't retain looser perms on upgrade.

Adds the first `auth.ts` unit tests (EIP-191 hash cross-checked against viem,
DER→65-byte formatting, signing-retry classification) plus session
auth-retry/fallback coverage.
