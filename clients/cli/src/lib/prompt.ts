/**
 * Shared inquirer prompt module.
 *
 * stdout is the CLI's machine-output (JSON) channel; inquirer renders its prompt
 * UI to its output stream, so a prompt on stdout corrupts that channel. Route all
 * interactive prompts to stderr instead — the terminal still shows them, but they
 * can never land on the structured output. Non-interactive sessions fail closed
 * (see `requireInteractive`) before any prompt is reached.
 */
import inquirer from 'inquirer'

export const prompt = inquirer.createPromptModule({ output: process.stderr })
