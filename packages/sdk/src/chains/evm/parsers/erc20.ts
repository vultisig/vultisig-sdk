/**
 * ERC-20 token transaction parser
 *
 * Handles parsing of standard ERC-20 token operations:
 * - transfer(address,uint256)
 * - transferFrom(address,address,uint256)
 * - approve(address,uint256)
 */

import { ERC20_SELECTORS } from '../config'

export interface Erc20TransferParams {
  recipient: string
  amount: bigint
}

export interface Erc20TransferFromParams {
  from: string
  to: string
  amount: bigint
}

export interface Erc20ApproveParams {
  spender: string
  amount: bigint
}

/**
 * ERC-20 transaction parser utility class
 */
export class Erc20Parser {
  /**
   * Check if transaction is an ERC-20 operation
   */
  static isErc20Transaction(data: string): boolean {
    if (!data || data.length < 10) {
      return false
    }

    const selector = data.slice(0, 10).toLowerCase()
    return (
      selector === ERC20_SELECTORS.TRANSFER ||
      selector === ERC20_SELECTORS.TRANSFER_FROM ||
      selector === ERC20_SELECTORS.APPROVE
    )
  }

  /**
   * Check if transaction is an ERC-20 transfer
   */
  static isTransfer(data: string): boolean {
    const selector = data.slice(0, 10).toLowerCase()
    return selector === ERC20_SELECTORS.TRANSFER
  }

  /**
   * Check if transaction is an ERC-20 transferFrom
   */
  static isTransferFrom(data: string): boolean {
    const selector = data.slice(0, 10).toLowerCase()
    return selector === ERC20_SELECTORS.TRANSFER_FROM
  }

  /**
   * Check if transaction is an ERC-20 approve
   */
  static isApprove(data: string): boolean {
    const selector = data.slice(0, 10).toLowerCase()
    return selector === ERC20_SELECTORS.APPROVE
  }

  /**
   * Parse ERC-20 transfer calldata
   * transfer(address recipient, uint256 amount)
   */
  static parseTransfer(data: string): Erc20TransferParams {
    if (!this.isTransfer(data)) {
      throw new Error('Not an ERC-20 transfer transaction')
    }

    if (data.length < 74) {
      throw new Error('Invalid ERC-20 transfer data: insufficient length')
    }

    // Extract recipient (bytes 4-36, padded to 32 bytes)
    const recipientHex = data.slice(34, 74)
    const recipient = `0x${recipientHex.padStart(40, '0')}`

    // Extract amount (bytes 36-68)
    const amountHex = data.slice(74, 138)
    const amount = BigInt(`0x${amountHex || '0'}`)

    return {
      recipient,
      amount,
    }
  }

  /**
   * Parse ERC-20 transferFrom calldata
   * transferFrom(address from, address to, uint256 amount)
   */
  static parseTransferFrom(data: string): Erc20TransferFromParams {
    if (!this.isTransferFrom(data)) {
      throw new Error('Not an ERC-20 transferFrom transaction')
    }

    if (data.length < 138) {
      throw new Error('Invalid ERC-20 transferFrom data: insufficient length')
    }

    // Extract from address (bytes 4-36)
    const fromHex = data.slice(34, 74)
    const from = `0x${fromHex.padStart(40, '0')}`

    // Extract to address (bytes 36-68)
    const toHex = data.slice(98, 138)
    const to = `0x${toHex.padStart(40, '0')}`

    // Extract amount (bytes 68-100)
    const amountHex = data.slice(138, 202)
    const amount = BigInt(`0x${amountHex || '0'}`)

    return {
      from,
      to,
      amount,
    }
  }

  /**
   * Parse ERC-20 approve calldata
   * approve(address spender, uint256 amount)
   */
  static parseApprove(data: string): Erc20ApproveParams {
    if (!this.isApprove(data)) {
      throw new Error('Not an ERC-20 approve transaction')
    }

    if (data.length < 74) {
      throw new Error('Invalid ERC-20 approve data: insufficient length')
    }

    // Extract spender address (bytes 4-36)
    const spenderHex = data.slice(34, 74)
    const spender = `0x${spenderHex.padStart(40, '0')}`

    // Extract amount (bytes 36-68)
    const amountHex = data.slice(74, 138)
    const amount = BigInt(`0x${amountHex || '0'}`)

    return {
      spender,
      amount,
    }
  }

  /**
   * Parse any ERC-20 transaction
   * Automatically detects the function and parses accordingly
   */
  static parse(
    data: string
  ): Erc20TransferParams | Erc20TransferFromParams | Erc20ApproveParams {
    if (this.isTransfer(data)) {
      return this.parseTransfer(data)
    }
    if (this.isTransferFrom(data)) {
      return this.parseTransferFrom(data)
    }
    if (this.isApprove(data)) {
      return this.parseApprove(data)
    }

    throw new Error('Unknown ERC-20 function')
  }
}
