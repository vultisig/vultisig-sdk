/**
 * Perpetual futures module for Levana perps on Rujira
 * @module modules/perps
 */

import type { Coin } from '@cosmjs/proto-signing'

import type { RujiraClient } from '../client.js'
import { RujiraError, RujiraErrorCode, wrapError } from '../errors.js'

// GraphQL endpoint
const RUJIRA_GRAPHQL_URL = 'https://api.rujira.network/api/graphql'

// Types

export type PerpsMarket = {
  /** Market contract address */
  address: string
  /** Market name (e.g. 'BTC_USDC') */
  name: string
  /** Base asset (e.g. 'BTC.BTC') */
  baseAsset: string
  /** Quote asset (e.g. 'ETH-USDC-...') */
  quoteAsset: string
}

export type PerpsTransactionParams = {
  contractAddress: string
  executeMsg: object
  funds: Coin[]
}

const PERPS_MARKETS_QUERY = `
  {
    perps {
      id
      name
      address
      baseAsset { asset }
      quoteAsset { asset }
    }
  }
`

/**
 * Levana perpetual futures module.
 *
 * @example
 * ```typescript
 * const client = new RujiraClient();
 * await client.connect();
 *
 * // List markets
 * const markets = await client.perps.getMarkets();
 *
 * // Build open position
 * const tx = client.perps.buildOpenPosition({
 *   market: 'thor1cyd6...',
 *   direction: 'long',
 *   leverage: '10',
 *   collateralDenom: 'eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
 *   collateralAmount: '100000000',
 * });
 * ```
 */
export class RujiraPerps {
  private readonly client: RujiraClient

  constructor(client: RujiraClient) {
    this.client = client
  }

  // --- Market Discovery ---

  /**
   * Get available perps markets from GraphQL.
   */
  async getMarkets(): Promise<PerpsMarket[]> {
    try {
      const response = await fetch(RUJIRA_GRAPHQL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: PERPS_MARKETS_QUERY }),
      })

      if (!response.ok) {
        throw new RujiraError(RujiraErrorCode.NETWORK_ERROR, `GraphQL request failed: ${response.status}`)
      }

      const json = (await response.json()) as {
        data: {
          perps: Array<{
            address: string
            name: string
            baseAsset: { asset: string }
            quoteAsset: { asset: string }
            stats?: Record<string, unknown>
            liquidity?: Record<string, unknown>
          }>
        }
      }

      return (json.data?.perps ?? []).map(m => ({
        address: m.address,
        name: m.name,
        baseAsset: m.baseAsset.asset,
        quoteAsset: m.quoteAsset.asset,
      }))
    } catch (error) {
      throw wrapError(error)
    }
  }

  // --- Market Queries ---

  /**
   * Query market status from the Levana contract.
   */
  async getMarketStatus(marketAddress: string): Promise<Record<string, unknown>> {
    try {
      return await this.client.queryContract<Record<string, unknown>>(marketAddress, { status: { price: null } })
    } catch (error) {
      throw wrapError(error)
    }
  }

  /**
   * Query positions for an owner on a market.
   */
  async getPositions(marketAddress: string, owner: string): Promise<Record<string, unknown>> {
    try {
      return await this.client.queryContract<Record<string, unknown>>(marketAddress, {
        positions: { owner, start_after: null, limit: 50 },
      })
    } catch (error) {
      throw wrapError(error)
    }
  }

  /**
   * Query limit orders for an owner on a market.
   */
  async getLimitOrders(marketAddress: string, owner: string): Promise<Record<string, unknown>> {
    try {
      return await this.client.queryContract<Record<string, unknown>>(marketAddress, {
        limit_orders: { owner, start_after: null, limit: 50 },
      })
    } catch (error) {
      throw wrapError(error)
    }
  }

  // --- Position Management ---

  /**
   * Build open position transaction.
   */
  buildOpenPosition(params: {
    market: string
    direction: 'long' | 'short'
    leverage: string
    collateralDenom: string
    collateralAmount: string
    takeProfit?: string
    stopLoss?: string
  }): PerpsTransactionParams {
    if (!params.collateralAmount || BigInt(params.collateralAmount) <= 0n) {
      throw new RujiraError(RujiraErrorCode.INVALID_AMOUNT, 'Collateral amount must be positive')
    }

    return {
      contractAddress: params.market,
      executeMsg: {
        open_position: {
          slippage_assert: null,
          leverage: params.leverage,
          direction: params.direction,
          stop_loss_override: params.stopLoss ?? null,
          take_profit: params.takeProfit ?? null,
        },
      },
      funds: [{ denom: params.collateralDenom, amount: params.collateralAmount }],
    }
  }

  /**
   * Build close position transaction.
   */
  buildClosePosition(params: { market: string; positionId: string }): PerpsTransactionParams {
    return {
      contractAddress: params.market,
      executeMsg: { close_position: { id: params.positionId, slippage_assert: null } },
      funds: [],
    }
  }

  /**
   * Build update take profit transaction.
   */
  buildUpdateTakeProfit(params: { market: string; positionId: string; price: string }): PerpsTransactionParams {
    return {
      contractAddress: params.market,
      executeMsg: { update_position_take_profit_price: { id: params.positionId, price: params.price } },
      funds: [],
    }
  }

  /**
   * Build update stop loss transaction.
   */
  buildUpdateStopLoss(params: {
    market: string
    positionId: string
    stopLoss: string | 'remove'
  }): PerpsTransactionParams {
    return {
      contractAddress: params.market,
      executeMsg: { update_position_stop_loss_price: { id: params.positionId, stop_loss: params.stopLoss } },
      funds: [],
    }
  }

  /**
   * Build add collateral transaction.
   */
  buildAddCollateral(params: {
    market: string
    positionId: string
    denom: string
    amount: string
  }): PerpsTransactionParams {
    return {
      contractAddress: params.market,
      executeMsg: { update_position_add_collateral_impact_leverage: { id: params.positionId } },
      funds: [{ denom: params.denom, amount: params.amount }],
    }
  }

  /**
   * Build place limit order transaction.
   */
  buildPlaceLimitOrder(params: {
    market: string
    direction: 'long' | 'short'
    leverage: string
    triggerPrice: string
    collateralDenom: string
    collateralAmount: string
    takeProfit?: string
    stopLoss?: string
  }): PerpsTransactionParams {
    return {
      contractAddress: params.market,
      executeMsg: {
        place_limit_order: {
          trigger_price: params.triggerPrice,
          leverage: params.leverage,
          direction: params.direction,
          stop_loss_override: params.stopLoss ?? null,
          take_profit: params.takeProfit ?? null,
        },
      },
      funds: [{ denom: params.collateralDenom, amount: params.collateralAmount }],
    }
  }

  /**
   * Build cancel limit order transaction.
   */
  buildCancelLimitOrder(params: { market: string; orderId: string }): PerpsTransactionParams {
    return {
      contractAddress: params.market,
      executeMsg: { cancel_limit_order: { order_id: params.orderId } },
      funds: [],
    }
  }
}
