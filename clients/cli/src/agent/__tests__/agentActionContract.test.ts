import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { DOCUMENTED_AGENT_ACTION_TYPES } from '../agentActionContract'
import { CLIENT_SIDE_TOOL_DISPATCH } from '../session'

const agentsMdPath = fileURLToPath(new URL('../../../../../AGENTS.md', import.meta.url))

const getAgentsMdActionNames = () =>
  readFileSync(agentsMdPath, 'utf8')
    .split(/\r?\n/)
    .flatMap(line => {
      const match = line.match(/^\|\s*`([^`]+)`\s*\|/)
      return match ? [match[1]] : []
    })

describe('agent action contract (AGENTS.md curated list)', () => {
  it('has no duplicate entries', () => {
    const sorted = [...DOCUMENTED_AGENT_ACTION_TYPES].sort()
    const unique = [...new Set(DOCUMENTED_AGENT_ACTION_TYPES)].sort()
    expect(sorted).toEqual(unique)
  })

  it('matches the root AGENTS.md Available Actions table', () => {
    expect([...DOCUMENTED_AGENT_ACTION_TYPES].sort()).toEqual(getAgentsMdActionNames().sort())
  })

  it('every CLIENT_SIDE_TOOL_DISPATCH tool is documented', () => {
    const documented = new Set<string>(DOCUMENTED_AGENT_ACTION_TYPES)
    for (const name of Object.keys(CLIENT_SIDE_TOOL_DISPATCH)) {
      expect(documented.has(name), `${name} missing from DOCUMENTED_AGENT_ACTION_TYPES`).toBe(true)
    }
  })

  it('password-gated tools from session are documented', () => {
    const documented = new Set(DOCUMENTED_AGENT_ACTION_TYPES)
    expect(documented.has('sign_typed_data')).toBe(true)
    expect(documented.has('sign_tx')).toBe(true)
  })
})
