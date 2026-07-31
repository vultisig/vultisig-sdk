// Hidden schema discovery command for machine clients
// Outputs JSON describing all commands, options, arguments, examples, and exit codes

import type { Argument, Command, Option } from 'commander'

import { EXIT_CODE_DESCRIPTIONS } from '../core/errors'
import { getVersion } from '../lib/version'

type CommandWithHidden = {
  _hidden?: boolean
} & Command

const COMMAND_EXAMPLES: Record<string, { enumValues?: Record<string, string[]>; examples: string[] }> = {
  balance: {
    examples: [
      'vultisig balance',
      'vultisig balance Ethereum --tokens',
      'vultisig balance --output json --fields amount,symbol',
    ],
  },
  addresses: {
    examples: ['vultisig addresses', 'vultisig addresses --output json'],
  },
  send: {
    examples: [
      'vultisig send Ethereum 0x... 0.1',
      'vultisig send Bitcoin bc1q... --max --yes',
      'vultisig send Ethereum 0x... 0.5 --dry-run --output json',
    ],
  },
  execute: {
    examples: ['vultisig execute THORChain <contract> \'{"swap":{}}\''],
  },
  'prep.contract-call': {
    examples: [
      'vultisig prep contract-call Ethereum 0xContract approve --sender 0xSender --abi \'[{"type":"function","name":"approve","inputs":[]}]\'',
    ],
  },
  'prep.ibc-transfer': {
    examples: ['vultisig prep ibc-transfer Osmosis osmo1... cosmos1... uosmo 1000000 --to-chain Cosmos'],
  },
  'prep.spl-transfer': {
    examples: ['vultisig prep spl-transfer <mint> <from> <to> 1000000 6'],
  },
  'prep.trc20-transfer': {
    examples: ['vultisig prep trc20-transfer <contract> <from> <to> 1000000'],
  },
  'prep.jetton-transfer': {
    examples: ['vultisig prep jetton-transfer <recipient> <senderJettonWallet> 1000000 5'],
  },
  'prep.sui-token-transfer': {
    examples: ['vultisig prep sui-token-transfer <coinType> <from> <to> 1000000 --decimals 6'],
  },
  'prep.polkadot-asset-send': {
    examples: ['vultisig prep polkadot-asset-send 1984 <from> <to> 1000000'],
  },
  'prep.cosmos-staking': {
    examples: ['vultisig prep cosmos-staking delegate <delegator> <validator> 5000000 uosmo'],
  },
  'prep.cw20-transfer': {
    examples: ['vultisig prep cw20-transfer osmo <contract> <recipient> 1000000 <sender>'],
  },
  'swap-quote': {
    examples: ['vultisig swap-quote Ethereum Bitcoin 0.1 --output json'],
  },
  vaults: {
    examples: ['vultisig vaults', 'vultisig vaults --output json'],
  },
  chains: {
    examples: ['vultisig chains', 'vultisig chains --add Solana'],
  },
  import: {
    examples: ['vultisig import ~/vault.vult', 'vultisig import ~/vault.vult --password secret'],
  },
  export: {
    examples: ['vultisig export ~/backup.vult'],
  },
  'create.fast': {
    examples: ['vultisig create fast --name mywallet --password secret --email me@example.com'],
  },
  'agent.ask': {
    examples: [
      'vultisig agent ask "What is my ETH balance?" --output json',
      'vultisig agent ask "Send 0.1 ETH to 0x..." --session abc123',
    ],
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

function mapArguments(cmd: Command) {
  const args = cmd.registeredArguments as Argument[] | undefined
  if (!args?.length) return undefined
  return args.map((a: any) => ({
    name: a._name ?? a.name?.(),
    required: a.required,
    description: a.description,
  }))
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
        const meta = COMMAND_EXAMPLES[c.name()]
        const args = mapArguments(c)
        return {
          name: c.name(),
          description: c.description(),
          ...(args ? { arguments: args } : {}),
          options: c.options
            .filter((o: Option) => !o.hidden && o.long !== '--help')
            .map((o: Option) => mapOption(o, meta?.enumValues)),
          ...(meta?.examples ? { examples: meta.examples } : {}),
          subcommands: c.commands.length
            ? c.commands.map((sub: Command) => {
                const subMeta = COMMAND_EXAMPLES[`${c.name()}.${sub.name()}`]
                const subArgs = mapArguments(sub)
                return {
                  name: sub.name(),
                  description: sub.description(),
                  ...(subArgs ? { arguments: subArgs } : {}),
                  options: sub.options
                    .filter((o: Option) => !o.hidden && o.long !== '--help')
                    .map((o: Option) => ({
                      flags: o.flags,
                      description: o.description,
                      required: !!o.mandatory,
                    })),
                  ...(subMeta?.examples ? { examples: subMeta.examples } : {}),
                }
              })
            : undefined,
        }
      }),
  }
  process.stdout.write(`${JSON.stringify(schema, null, 2)}\n`)
}
