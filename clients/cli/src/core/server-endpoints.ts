import type { VultisigConfig } from '@vultisig/sdk'

export type ServerEndpointOverrides = {
  serverUrl?: string
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find(value => typeof value === 'string' && value.trim() !== '')
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

function joinEndpoint(baseUrl: string, path: string): string {
  return `${stripTrailingSlash(baseUrl)}${path}`
}

export function resolveServerEndpoints(
  overrides: ServerEndpointOverrides = {}
): VultisigConfig['serverEndpoints'] | undefined {
  const serverUrl = firstNonEmpty(overrides.serverUrl, process.env.VULTISIG_SERVER_URL)
  if (!serverUrl) {
    return undefined
  }

  return {
    fastVault: stripTrailingSlash(joinEndpoint(serverUrl, '/vault')),
    messageRelay: stripTrailingSlash(joinEndpoint(serverUrl, '/router')),
  }
}

export function parseServerEndpointOverridesFromArgv(args: string[]): ServerEndpointOverrides {
  return {
    serverUrl: readArgValue(args, '--server-url'),
  }
}

function readArgValue(args: string[], optionName: string): string | undefined {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === optionName) {
      return args[i + 1]
    }
    if (arg.startsWith(`${optionName}=`)) {
      return arg.slice(optionName.length + 1)
    }
  }

  return undefined
}
