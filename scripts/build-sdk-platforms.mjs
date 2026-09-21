import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const configured = process.env.CONCURRENTLY_MAX_PROCESSES ?? '1'
const maxProcesses = Number(configured)
if (!/^[0-9]+$/.test(configured) || !Number.isSafeInteger(maxProcesses) || maxProcesses < 1) {
  console.error('CONCURRENTLY_MAX_PROCESSES must be a positive integer.')
  process.exit(1)
}

// Resolve the SDK's existing dependency, independently of workspace hoisting.
const require = createRequire(new URL('../packages/sdk/package.json', import.meta.url))
const { concurrently } = await import(pathToFileURL(require.resolve('concurrently')).href)
let interrupted
const onSignal = signal => { interrupted ??= signal }
const signals = ['SIGINT', 'SIGTERM', 'SIGHUP']
for (const signal of signals) process.on(signal, onSignal)

const commands = process.argv.slice(2)
try {
  // concurrently loops up to maxProcesses even after its command queue is empty.
  await concurrently(commands, { maxProcesses: Math.min(maxProcesses, commands.length), successCondition: 'all' }).result
  process.exitCode = 0
} catch {
  process.exitCode = 1
} finally {
  for (const signal of signals) process.off(signal, onSignal)
  // concurrently treats Ctrl-C as success. A partial SDK build must not advance
  // to declarations or record a reusable completed build after interruption.
  if (interrupted) process.exitCode = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 }[interrupted]
}
