import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

type RecipeSchema = {
  supported_resources?: unknown[]
  examples?: unknown[]
  [key: string]: unknown
}

type PolicySuggestion = {
  rules?: unknown[]
  constraints?: unknown[]
  [key: string]: unknown
}

type PluginInstallStatus = {
  installed: boolean
  [key: string]: unknown
}

type BillingStatus = {
  active: boolean
  trial?: boolean
  [key: string]: unknown
}

/**
 * REST client for the Vultisig Verifier API.
 * Handles plugin management, policy validation, and billing checks.
 *
 * @example
 * ```ts
 * const verifier = new VerifierClient('http://localhost:8080')
 * const schema = await verifier.getRecipeSchema('my-plugin')
 * const installed = await verifier.checkPluginInstalled('my-plugin', '04abc...')
 * ```
 */
export class VerifierClient {
  constructor(private readonly baseUrl: string = 'https://api.vultisig.com/verifier') {}

  /**
   * Fetch plugin configuration schema (supported resources, examples).
   */
  async getRecipeSchema(pluginId: string): Promise<RecipeSchema> {
    const result = await queryUrl<RecipeSchema>(`${this.baseUrl}/plugins/${pluginId}/recipe-specification`)
    if (!result || typeof result === 'string') {
      throw new Error(`Failed to fetch recipe schema for plugin: ${pluginId}`)
    }
    return result
  }

  /**
   * Validate plugin configuration and get policy rules.
   */
  async suggestPolicy(pluginId: string, configuration: Record<string, unknown>): Promise<PolicySuggestion> {
    const result = await queryUrl<PolicySuggestion>(
      `${this.baseUrl}/plugins/${pluginId}/recipe-specification/suggest`,
      { body: configuration }
    )
    if (!result || typeof result === 'string') {
      throw new Error(`Failed to suggest policy for plugin: ${pluginId}`)
    }
    return result
  }

  /**
   * Check if a plugin is installed for a given vault public key.
   */
  async checkPluginInstalled(pluginId: string, publicKeyECDSA: string): Promise<PluginInstallStatus> {
    const result = await queryUrl<PluginInstallStatus>(
      `${this.baseUrl}/service/plugins/installed?public_key=${encodeURIComponent(publicKeyECDSA)}&plugin_id=${encodeURIComponent(pluginId)}`,
      { headers: { 'X-Service-Key': 'sdk' } }
    )
    if (!result || typeof result === 'string') {
      throw new Error(`Failed to check plugin install status: ${pluginId}`)
    }
    return result
  }

  /**
   * Check if a vault has active billing/trial.
   */
  async checkBillingStatus(publicKeyECDSA: string): Promise<BillingStatus> {
    const result = await queryUrl<BillingStatus>(
      `${this.baseUrl}/service/fee/status?public_key=${encodeURIComponent(publicKeyECDSA)}`,
      { headers: { 'X-Service-Key': 'sdk' } }
    )
    if (!result || typeof result === 'string') {
      throw new Error(`Failed to check billing status`)
    }
    return result
  }
}
