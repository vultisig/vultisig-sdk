---
'@vultisig/cli': patch
---

Fix `agent ask` error reporting so a real first-turn backend/stream error is no
longer masked by the initialize-time `SESSION_NOT_FOUND` signal. The
stale-`--session` fallback signal is now kept separately and used only as a
lowest-priority fallback when the turn produced no error of its own, so a
genuine turn error wins while a clean turn after a stale-session fallback still
reports `SESSION_NOT_FOUND` (non-zero exit).
