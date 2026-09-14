import { spawnSync } from 'node:child_process'

const auditArgs = ['npm', 'audit', '--recursive', '--all', '--severity', 'high']
const maxAttempts = 3
const retryDelaysMs = [5_000, 15_000]
const transientErrorPattern =
  /RequestError|Timeout awaiting 'socket'|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|socket hang up/i

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

const runAudit = () =>
  spawnSync(process.platform === 'win32' ? 'yarn.cmd' : 'yarn', auditArgs, {
    encoding: 'utf8',
    env: process.env,
  })

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  const result = runAudit()
  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''

  process.stdout.write(stdout)
  process.stderr.write(stderr)

  if (result.status === 0) {
    process.exit(0)
  }

  const output = `${stdout}\n${stderr}`
  const canRetry = attempt < maxAttempts && transientErrorPattern.test(output)

  if (!canRetry) {
    process.exit(result.status ?? 1)
  }

  const delayMs = retryDelaysMs[attempt - 1]
  process.stderr.write(
    `npm audit hit a transient network error; retrying in ${delayMs / 1_000}s (${attempt}/${maxAttempts}).\n`
  )
  await sleep(delayMs)
}
