import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConfirmationRequiredError } from './core/errors'
import { resetOutput, setNonInteractive } from './lib/output'
import { confirmSwap, confirmTransaction } from './ui'

afterEach(() => {
  resetOutput()
  vi.restoreAllMocks()
})

// The confirm prompts are the fund-safety gate. In a non-interactive session
// (piped output, or --non-interactive/--ci) they must fail closed with a stable
// CONFIRMATION_REQUIRED error BEFORE any inquirer prompt is drawn. The stdout-spy
// assertion documents that the throw happens ahead of any render; stderr-vs-stdout
// routing of the prompt UI itself is covered in prompt.test.ts.
describe('confirm prompts fail closed in non-interactive mode', () => {
  it('confirmTransaction rejects with ConfirmationRequiredError and never writes to stdout', async () => {
    setNonInteractive(true)
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

    await expect(confirmTransaction()).rejects.toBeInstanceOf(ConfirmationRequiredError)
    expect(stdoutSpy).not.toHaveBeenCalled()
  })

  it('confirmSwap rejects with ConfirmationRequiredError and never writes to stdout', async () => {
    setNonInteractive(true)
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

    await expect(confirmSwap()).rejects.toBeInstanceOf(ConfirmationRequiredError)
    expect(stdoutSpy).not.toHaveBeenCalled()
  })
})
