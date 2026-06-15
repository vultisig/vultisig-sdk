/**
 * AgentMail OTP fetcher — polls an AgentMail inbox for the fast-vault
 * verification code so `verify --auto-verify` can run fully headless (no
 * human pasting the OTP). Mirrors the logic the mobile maestro test harness
 * already uses (vultiagent-app/maestro/scripts/fetch-otp.js): list the inbox,
 * match the message to the vault name, extract the 4-6 digit code.
 *
 * Opt-in only: requires AGENTMAIL_API_KEY + the inbox email. Never reads or
 * logs the key. Intended for automated/CI vault-creation flows, not prod.
 */

const AGENTMAIL_BASE = 'https://api.agentmail.to/v0/inboxes'
const OTP_CODE_RE = /\b(\d{4,6})\b/

export interface AgentMailOtpOptions {
  /** AgentMail inbox address the verification email is sent to. */
  inboxEmail: string
  /** AgentMail API key (Bearer). */
  apiKey: string
  /** Vault name to match the message against (subject/preview contains it). */
  vaultName: string
  /** Max poll attempts (default 30). */
  maxAttempts?: number
  /** Delay between attempts in ms (default 3000). */
  intervalMs?: number
  /** Abort signal to cancel polling. */
  signal?: AbortSignal
}

interface AgentMailMessage {
  message_id: string
  subject?: string
  preview?: string
}

async function getJson(url: string, apiKey: string, signal?: AbortSignal): Promise<any> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  })
  if (!res.ok) {
    throw new Error(`AgentMail request failed: ${res.status} ${res.statusText}`)
  }
  return res.json()
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Operation cancelled'))
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(new Error('Operation cancelled'))
      },
      { once: true }
    )
  })
}

/**
 * Poll the AgentMail inbox until a verification message matching `vaultName`
 * arrives, then return its extracted OTP code. Throws on timeout / abort.
 */
export async function fetchVaultOtp(opts: AgentMailOtpOptions): Promise<string> {
  const { inboxEmail, apiKey, vaultName } = opts
  const maxAttempts = opts.maxAttempts ?? 30
  const intervalMs = opts.intervalMs ?? 3000
  const listUrl = `${AGENTMAIL_BASE}/${encodeURIComponent(inboxEmail)}/messages`

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (opts.signal?.aborted) throw new Error('Operation cancelled')
    try {
      const list = await getJson(listUrl, apiKey, opts.signal)
      const messages: AgentMailMessage[] = list?.messages ?? []
      const matched = messages.find(m => (m.preview ?? '').includes(vaultName) || (m.subject ?? '').includes(vaultName))
      if (matched) {
        const msg = await getJson(`${listUrl}/${matched.message_id}`, apiKey, opts.signal)
        const text: string = msg?.text ?? msg?.extracted_text ?? ''
        const code = text.match(OTP_CODE_RE)
        if (code) return code[1]
      }
    } catch (err) {
      // Transient list/read failure — keep polling unless it was an abort.
      if (err instanceof Error && /cancelled/i.test(err.message)) throw err
    }
    if (attempt < maxAttempts) await sleep(intervalMs, opts.signal)
  }
  throw new Error(`Timed out after ${maxAttempts} attempts waiting for the AgentMail OTP for vault "${vaultName}".`)
}
