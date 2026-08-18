import { homedir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getCredentialsPath } from '../../core/credential-store'
import { journalPath } from '../broadcastJournal'
import { getTokenCachePath } from '../session'

describe('agent/shared config-dir path policy', () => {
  const ENV_KEY = 'VULTISIG_CONFIG_DIR'
  const JOURNAL_ENV_KEY = 'VULTISIG_BROADCAST_JOURNAL_PATH'
  let savedConfigDir: string | undefined
  let savedJournalPath: string | undefined

  beforeEach(() => {
    savedConfigDir = process.env[ENV_KEY]
    savedJournalPath = process.env[JOURNAL_ENV_KEY]
    delete process.env[JOURNAL_ENV_KEY]
  })

  afterEach(() => {
    if (savedConfigDir === undefined) delete process.env[ENV_KEY]
    else process.env[ENV_KEY] = savedConfigDir

    if (savedJournalPath === undefined) delete process.env[JOURNAL_ENV_KEY]
    else process.env[JOURNAL_ENV_KEY] = savedJournalPath
  })

  it('co-locates token cache, credentials, and journal under VULTISIG_CONFIG_DIR', () => {
    const overrideDir = join(homedir(), '.tmp-vultisig-shared-config-test')
    process.env[ENV_KEY] = overrideDir

    expect(getTokenCachePath()).toBe(join(overrideDir, 'agent-tokens.json'))
    expect(getCredentialsPath()).toBe(join(overrideDir, 'credentials.enc'))
    expect(journalPath()).toBe(join(overrideDir, 'broadcasts.jsonl'))
  })

  it('treats an empty/whitespace config-dir override as unset across agent surfaces', () => {
    const fallbackDir = join(homedir(), '.vultisig')

    process.env[ENV_KEY] = ''
    expect(getTokenCachePath()).toBe(join(fallbackDir, 'agent-tokens.json'))
    expect(getCredentialsPath()).toBe(join(fallbackDir, 'credentials.enc'))
    expect(journalPath()).toBe(join(fallbackDir, 'broadcasts.jsonl'))

    process.env[ENV_KEY] = '   '
    expect(getTokenCachePath()).toBe(join(fallbackDir, 'agent-tokens.json'))
    expect(getCredentialsPath()).toBe(join(fallbackDir, 'credentials.enc'))
    expect(journalPath()).toBe(join(fallbackDir, 'broadcasts.jsonl'))
  })

  it('still lets an explicit journal path override the shared config dir', () => {
    process.env[ENV_KEY] = '/tmp/vultisig-config'
    process.env[JOURNAL_ENV_KEY] = '   /tmp/custom-broadcasts.jsonl   '

    expect(journalPath()).toBe('   /tmp/custom-broadcasts.jsonl   ')
  })
})
