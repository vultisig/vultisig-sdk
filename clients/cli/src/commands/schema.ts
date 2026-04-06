// Hidden schema discovery command for machine clients
// Outputs JSON describing all commands, options, response schemas, and exit codes

import type { Command, Option } from 'commander'

import { EXIT_CODE_DESCRIPTIONS } from '../core/errors'
import { getVersion } from '../lib/version'

type CommandWithHidden = {
  _hidden?: boolean
} & Command

const COMMAND_META: Record<
  string,
  {
    enumValues?: Record<string, string[]>
    responseSchema?: Record<string, string>
  }
> = {
  balance: {
    responseSchema: {
      chain: 'string',
      symbol: 'string',
      amount: 'string',
      fiatValue: 'number?',
      contractAddress: 'string?',
      decimals: 'number?',
    },
  },
  addresses: {
    responseSchema: { chain: 'string', address: 'string' },
  },
  send: {
    responseSchema: {
      txHash: 'string',
      chain: 'string',
      explorerUrl: 'string',
      amount: 'string',
      to: 'string',
      symbol: 'string',
    },
  },
  'swap.execute': {
    responseSchema: {
      txHash: 'string',
      chain: 'string',
      explorerUrl: 'string',
    },
  },
  'swap-quote': {
    responseSchema: {
      fromChain: 'string',
      fromToken: 'string',
      toChain: 'string',
      toToken: 'string',
      inputAmount: 'string',
      estimatedOutput: 'string',
      provider: 'string',
      estimatedOutputFiat: 'number?',
      requiresApproval: 'boolean?',
    },
  },
  'swap-chains': {
    responseSchema: { chain: 'string' },
  },
  vaults: {
    responseSchema: {
      id: 'string',
      name: 'string',
      type: 'string',
      chains: 'string[]',
      isEncrypted: 'boolean',
      threshold: 'number',
      totalSigners: 'number',
    },
  },
  portfolio: {
    responseSchema: {
      totalValue: 'number',
      currency: 'string',
      chains: 'object[]',
    },
  },
  discount: {
    responseSchema: {
      tier: 'string',
      discount: 'number',
      balance: 'string',
    },
  },
}

const GLOBAL_ENUM_VALUES: Record<string, string[]> = {
  '--output': ['json', 'table'],
}

function mapOption(o: Option, enumValues?: Record<string, string[]>) {
  return {
    flags: o.flags,
    description: o.description,
    required: !!o.mandatory,
    defaultValue: o.defaultValue,
    ...(enumValues?.[o.long!] ? { enumValues: enumValues[o.long!] } : {}),
  }
}

export function executeSchema(prog: Command): void {
  const schema = {
    name: prog.name(),
    version: getVersion(),
    exitCodes: Object.fromEntries(Object.entries(EXIT_CODE_DESCRIPTIONS).map(([k, v]) => [String(k), v])),
    globalOptions: prog.options.filter((o: Option) => !o.hidden).map((o: Option) => mapOption(o, GLOBAL_ENUM_VALUES)),
    commands: prog.commands
      .filter((c: Command) => !(c as CommandWithHidden)._hidden)
      .map((c: Command) => {
        const meta = COMMAND_META[c.name()]
        return {
          name: c.name(),
          description: c.description(),
          options: c.options
            .filter((o: Option) => !o.hidden && o.long !== '--help')
            .map((o: Option) => mapOption(o, meta?.enumValues)),
          ...(meta?.responseSchema ? { responseSchema: meta.responseSchema } : {}),
          subcommands: c.commands.length
            ? c.commands.map((sub: Command) => {
                const subMeta = COMMAND_META[`${c.name()}.${sub.name()}`]
                return {
                  name: sub.name(),
                  description: sub.description(),
                  options: sub.options
                    .filter((o: Option) => !o.hidden && o.long !== '--help')
                    .map((o: Option) => ({
                      flags: o.flags,
                      description: o.description,
                      required: !!o.mandatory,
                    })),
                  ...(subMeta?.responseSchema ? { responseSchema: subMeta.responseSchema } : {}),
                }
              })
            : undefined,
        }
      }),
  }
  process.stdout.write(`${JSON.stringify(schema, null, 2)}\n`)
}
