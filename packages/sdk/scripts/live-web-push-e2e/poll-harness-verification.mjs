#!/usr/bin/env node
/**
 * Poll GET /api/verification until a field is true (for agents / CI against a running live-push-e2e server).
 *
 * Usage:
 *   node poll-harness-verification.mjs <port> [field] [timeoutMs]
 *
 * field: pushAck | clickAck | wsReceived (default: pushAck)
 *
 * Example:
 *   yarn live-push-e2e   # note port from "Open in Chrome/Edge: http://127.0.0.1:PORT"
 *   node packages/sdk/scripts/live-web-push-e2e/poll-harness-verification.mjs 54321 pushAck 120000
 */
const allowed = new Set(['pushAck', 'clickAck', 'wsReceived'])
const port = process.argv[2]
const field = process.argv[3] || 'pushAck'
const timeoutMs = Number(process.argv[4] || '120000')

if (!port || !/^\d+$/.test(port) || !allowed.has(field)) {
  console.error('Usage: node poll-harness-verification.mjs <port> [pushAck|clickAck|wsReceived] [timeoutMs]')
  process.exit(2)
}

const url = `http://127.0.0.1:${port}/api/verification`
const deadline = Date.now() + timeoutMs

while (Date.now() < deadline) {
  try {
    const r = await fetch(url)
    if (r.ok) {
      const v = await r.json()
      if (v[field] === true) {
        console.log(JSON.stringify(v, null, 2))
        process.exit(0)
      }
    }
  } catch {
    /* server not up yet */
  }
  await new Promise(res => setTimeout(res, 400))
}

console.error(`Timeout waiting for ${field} on ${url}`)
process.exit(1)
