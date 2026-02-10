import type { GraphQLMarketsResponse } from './types.js'

export type GraphQLClientOptions = {
  wsEndpoint?: string
  httpEndpoint?: string
  apiKey?: string
  timeout?: number
  /** Max retries on transient (5xx/network) errors. Default: 3 */
  maxRetries?: number
}

export class GraphQLClient {
  private httpEndpoint: string
  private wsEndpoint: string
  private apiKey?: string
  private timeout: number
  private maxRetries: number

  /** Backoff schedule in ms for each retry attempt */
  private static readonly RETRY_BACKOFF_MS = [500, 1000, 2000]

  constructor(options: GraphQLClientOptions = {}) {
    this.httpEndpoint = options.httpEndpoint || 'https://api.rujira.network/api/graphql'
    this.wsEndpoint = options.wsEndpoint || 'wss://api.rujira.network/socket'
    this.apiKey = options.apiKey
    this.timeout = options.timeout || 30000
    this.maxRetries = options.maxRetries ?? 3
  }

  static GraphQLError = class extends Error {
    constructor(
      message: string,
      public readonly type: 'network' | 'server' | 'graphql' | 'timeout' | 'auth' | 'unknown',
      public readonly status?: number,
      public readonly graphqlErrors?: Array<{ message: string; extensions?: Record<string, unknown> }>
    ) {
      super(message)
      this.name = 'GraphQLError'
    }
  }

  /** Returns true if the error type is eligible for retry (transient failures only). */
  private static isRetryable(error: InstanceType<typeof GraphQLClient.GraphQLError>): boolean {
    return error.type === 'server' || (error.type === 'network' && error.status !== 429)
  }

  async query<T = unknown>(query: string, variables?: Record<string, unknown>): Promise<T> {
    let lastError: InstanceType<typeof GraphQLClient.GraphQLError> | undefined

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0 && lastError) {
        const backoff = GraphQLClient.RETRY_BACKOFF_MS[attempt - 1] ?? 2000
        await new Promise(resolve => setTimeout(resolve, backoff))
      }

      try {
        return await this.executeQuery<T>(query, variables)
      } catch (error) {
        if (!(error instanceof GraphQLClient.GraphQLError)) throw error
        lastError = error

        // Only retry on transient (5xx / network) failures
        if (!GraphQLClient.isRetryable(error) || attempt === this.maxRetries) {
          throw error
        }
      }
    }

    // Unreachable, but satisfies TypeScript
    throw lastError
  }

  private async executeQuery<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }

      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`
      }

      const response = await fetch(this.httpEndpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      })

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new GraphQLClient.GraphQLError(
            `Authentication failed: ${response.status} ${response.statusText}`,
            'auth',
            response.status
          )
        }

        if (response.status === 429) {
          throw new GraphQLClient.GraphQLError(
            `Rate limited by Rujira API: ${response.status} ${response.statusText}. ` +
              'Provide an API token (RujiraClientOptions.apiKey / GraphQLClientOptions.apiKey) to increase limits.',
            'network',
            response.status
          )
        }

        if (response.status >= 500) {
          throw new GraphQLClient.GraphQLError(
            `Server error: ${response.status} ${response.statusText}`,
            'server',
            response.status
          )
        }

        throw new GraphQLClient.GraphQLError(
          `GraphQL request failed: ${response.status} ${response.statusText}`,
          'network',
          response.status
        )
      }

      const result = (await response.json()) as {
        data?: T
        errors?: Array<{
          message: string
          extensions?: Record<string, unknown>
          locations?: Array<{ line: number; column: number }>
          path?: Array<string | number>
        }>
      }

      if (result.errors && result.errors.length > 0) {
        throw new GraphQLClient.GraphQLError(
          `GraphQL errors: ${result.errors.map(e => e.message).join(', ')}`,
          'graphql',
          undefined,
          result.errors
        )
      }

      return result.data as T
    } catch (error) {
      if (error instanceof GraphQLClient.GraphQLError) {
        throw error
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new GraphQLClient.GraphQLError(`GraphQL request timed out after ${this.timeout}ms`, 'timeout')
      }

      throw new GraphQLClient.GraphQLError(
        `GraphQL request failed: ${error instanceof Error ? error.message : String(error)}`,
        'unknown'
      )
    } finally {
      clearTimeout(timeoutId)
    }
  }

  async getMarkets(): Promise<GraphQLMarketsResponse> {
    const query = `
      query FinMarkets {
        fin {
          address
          assetBase {
            asset
          }
          assetQuote {
            asset
          }
          tick
          feeTaker
          feeMaker
        }
      }
    `

    const result = await this.query<{
      fin: Array<{
        address: string
        assetBase: { asset: string }
        assetQuote: { asset: string }
        tick: string
        feeTaker: string
        feeMaker: string
      }>
    }>(query)

    return {
      markets: result.fin.map(m => ({
        address: m.address,
        denoms: {
          base: m.assetBase.asset.toLowerCase(),
          quote: m.assetQuote.asset.toLowerCase(),
        },
        config: {
          tick: m.tick,
          fee_taker: m.feeTaker,
          fee_maker: m.feeMaker,
        },
      })),
    }
  }

  async getMarket(baseAsset: string, quoteAsset: string): Promise<GraphQLMarketsResponse['markets'][0] | null> {
    const allMarkets = await this.getMarkets()

    const market = allMarkets.markets.find(
      m =>
        (m.denoms.base === baseAsset && m.denoms.quote === quoteAsset) ||
        (m.denoms.base === quoteAsset && m.denoms.quote === baseAsset)
    )

    return market || null
  }

  getWsEndpoint(): string {
    return this.wsEndpoint
  }
}
