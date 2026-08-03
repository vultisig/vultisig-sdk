/**
 * Shared inquirer prompt module — the single chokepoint every interactive prompt
 * in the CLI flows through. Two invariants are enforced here so no caller (current
 * or future) can forget them:
 *
 * 1. Output routing: stdout is the CLI's machine-output (JSON) channel; inquirer
 *    renders its prompt UI to its output stream, so a prompt on stdout corrupts
 *    that channel. Every prompt renders to stderr instead — the terminal still
 *    shows it, but it can never land on the structured output.
 *
 * 2. Fail closed in non-interactive sessions: when the session is non-interactive
 *    (piped/redirected stdout or stdin, or --non-interactive/--ci) we THROW a typed
 *    `ConfirmationRequiredError` (exit 12) BEFORE inquirer renders anything, so a
 *    headless run can never hang waiting on a prompt or leak prompt bytes onto
 *    stdout. Per-command guards may still call `requireInteractive` first with a
 *    more specific hint; this chokepoint is the backstop that covers every caller.
 */
import inquirer from 'inquirer'

import { requireInteractive } from './output'

// Exported so a test can assert prompts are bound to stderr (never stdout). Input
// stays process.stdin — only the rendered prompt UI is redirected off stdout.
export const promptOutput: NodeJS.WritableStream = process.stderr

const promptModule = inquirer.createPromptModule({ output: promptOutput })

/**
 * Derive a fail-closed hint from the questions so a headless caller learns the
 * escape hatch even when the command installed no guard of its own: a password
 * question points at the credential flags; anything else at the generic
 * "supply the value via a flag" hatch.
 */
function deriveHint(questions: unknown): string {
  const list = Array.isArray(questions) ? questions : [questions]
  const needsPassword = list.some(
    q => q != null && typeof q === 'object' && (q as { type?: string }).type === 'password'
  )
  return needsPassword
    ? 'Provide the password via --password, the VAULT_PASSWORD env var, or "vsig auth setup" (keyring).'
    : 'Supply the required value(s) via flags (e.g. --yes/--confirm, --code, --chain/--address/--name) so no prompt is needed.'
}

/**
 * The single entry point for interactive prompts. Fails closed in non-interactive
 * sessions (before any prompt renders); otherwise delegates to the stderr-bound
 * inquirer module. A Proxy preserves inquirer's exact type — the overloaded
 * generic call signature, its return type (including the `.ui` handle), and the
 * registerPrompt/restoreDefaultPrompts helpers — so existing callers are wholly
 * unaffected while every call inherits the guard.
 */
export const prompt: typeof promptModule = new Proxy(promptModule, {
  apply(target, thisArg, argArray: Parameters<typeof promptModule>) {
    requireInteractive(deriveHint(argArray[0]))
    return Reflect.apply(target, thisArg, argArray)
  },
})
