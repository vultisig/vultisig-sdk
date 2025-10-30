/**
 * NFT transaction parser
 *
 * Handles parsing of NFT transfers:
 * - ERC-721 transfers (transferFrom, safeTransferFrom)
 * - ERC-1155 transfers (safeTransferFrom, safeBatchTransferFrom)
 */

import { ERC721_SELECTORS, ERC1155_SELECTORS } from '../config'

export interface Erc721TransferParams {
  from: string
  to: string
  tokenId: string
  standard: 'ERC-721'
}

export interface Erc1155TransferParams {
  from: string
  to: string
  tokenId: string
  amount: bigint
  standard: 'ERC-1155'
}

export interface Erc1155BatchTransferParams {
  from: string
  to: string
  tokenIds: string[]
  amounts: bigint[]
  standard: 'ERC-1155'
}

export type NftTransferParams =
  | Erc721TransferParams
  | Erc1155TransferParams
  | Erc1155BatchTransferParams

/**
 * NFT transaction parser utility class
 */
export class NftParser {
  /**
   * Check if transaction is an NFT transfer
   */
  static isNftTransaction(data: string): boolean {
    if (!data || data.length < 10) {
      return false
    }

    const selector = data.slice(0, 10).toLowerCase()
    return (
      selector === ERC721_SELECTORS.TRANSFER_FROM ||
      selector === ERC721_SELECTORS.SAFE_TRANSFER_FROM ||
      selector === ERC721_SELECTORS.SAFE_TRANSFER_FROM_DATA ||
      selector === ERC1155_SELECTORS.SAFE_TRANSFER_FROM ||
      selector === ERC1155_SELECTORS.SAFE_BATCH_TRANSFER
    )
  }

  /**
   * Check if transaction is ERC-721
   */
  static isErc721(data: string): boolean {
    const selector = data.slice(0, 10).toLowerCase()
    return (
      selector === ERC721_SELECTORS.TRANSFER_FROM ||
      selector === ERC721_SELECTORS.SAFE_TRANSFER_FROM ||
      selector === ERC721_SELECTORS.SAFE_TRANSFER_FROM_DATA
    )
  }

  /**
   * Check if transaction is ERC-1155
   */
  static isErc1155(data: string): boolean {
    const selector = data.slice(0, 10).toLowerCase()
    return (
      selector === ERC1155_SELECTORS.SAFE_TRANSFER_FROM ||
      selector === ERC1155_SELECTORS.SAFE_BATCH_TRANSFER
    )
  }

  /**
   * Parse ERC-721 transfer
   * transferFrom(address from, address to, uint256 tokenId)
   * safeTransferFrom(address from, address to, uint256 tokenId)
   */
  static parseErc721Transfer(data: string): Erc721TransferParams {
    const selector = data.slice(0, 10).toLowerCase()

    if (
      selector !== ERC721_SELECTORS.TRANSFER_FROM &&
      selector !== ERC721_SELECTORS.SAFE_TRANSFER_FROM &&
      selector !== ERC721_SELECTORS.SAFE_TRANSFER_FROM_DATA
    ) {
      throw new Error('Not an ERC-721 transfer')
    }

    if (data.length < 138) {
      throw new Error('Invalid ERC-721 transfer data: insufficient length')
    }

    // Extract from address (bytes 4-36)
    const fromHex = data.slice(34, 74)
    const from = `0x${fromHex.padStart(40, '0')}`

    // Extract to address (bytes 36-68)
    const toHex = data.slice(98, 138)
    const to = `0x${toHex.padStart(40, '0')}`

    // Extract tokenId (bytes 68-100)
    const tokenIdHex = data.slice(138, 202)
    const tokenId = BigInt(`0x${tokenIdHex || '0'}`).toString()

    return {
      from,
      to,
      tokenId,
      standard: 'ERC-721',
    }
  }

  /**
   * Parse ERC-1155 single transfer
   * safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)
   */
  static parseErc1155Transfer(data: string): Erc1155TransferParams {
    if (data.slice(0, 10).toLowerCase() !== ERC1155_SELECTORS.SAFE_TRANSFER_FROM) {
      throw new Error('Not an ERC-1155 safeTransferFrom')
    }

    if (data.length < 266) {
      throw new Error('Invalid ERC-1155 transfer data: insufficient length')
    }

    // Extract from address (bytes 4-36)
    const fromHex = data.slice(34, 74)
    const from = `0x${fromHex.padStart(40, '0')}`

    // Extract to address (bytes 36-68)
    const toHex = data.slice(98, 138)
    const to = `0x${toHex.padStart(40, '0')}`

    // Extract tokenId (bytes 68-100)
    const tokenIdHex = data.slice(138, 202)
    const tokenId = BigInt(`0x${tokenIdHex || '0'}`).toString()

    // Extract amount (bytes 100-132)
    const amountHex = data.slice(202, 266)
    const amount = BigInt(`0x${amountHex || '0'}`)

    return {
      from,
      to,
      tokenId,
      amount,
      standard: 'ERC-1155',
    }
  }

  /**
   * Parse ERC-1155 batch transfer
   * safeBatchTransferFrom(address from, address to, uint256[] ids, uint256[] amounts, bytes data)
   */
  static parseErc1155BatchTransfer(data: string): Erc1155BatchTransferParams {
    if (data.slice(0, 10).toLowerCase() !== ERC1155_SELECTORS.SAFE_BATCH_TRANSFER) {
      throw new Error('Not an ERC-1155 safeBatchTransferFrom')
    }

    if (data.length < 330) {
      throw new Error('Invalid ERC-1155 batch transfer data: insufficient length')
    }

    // Extract from address (bytes 4-36)
    const fromHex = data.slice(34, 74)
    const from = `0x${fromHex.padStart(40, '0')}`

    // Extract to address (bytes 36-68)
    const toHex = data.slice(98, 138)
    const to = `0x${toHex.padStart(40, '0')}`

    // Extract ids array offset (bytes 68-100)
    const idsOffset = parseInt(data.slice(138, 202), 16) * 2 + 10

    // Extract amounts array offset (bytes 100-132)
    const amountsOffset = parseInt(data.slice(202, 266), 16) * 2 + 10

    // Parse ids array
    const idsLength = parseInt(data.slice(idsOffset, idsOffset + 64), 16)
    const tokenIds: string[] = []
    for (let i = 0; i < idsLength; i++) {
      const offset = idsOffset + 64 + i * 64
      const tokenIdHex = data.slice(offset, offset + 64)
      const tokenId = BigInt(`0x${tokenIdHex || '0'}`).toString()
      tokenIds.push(tokenId)
    }

    // Parse amounts array
    const amountsLength = parseInt(data.slice(amountsOffset, amountsOffset + 64), 16)
    const amounts: bigint[] = []
    for (let i = 0; i < amountsLength; i++) {
      const offset = amountsOffset + 64 + i * 64
      const amountHex = data.slice(offset, offset + 64)
      const amount = BigInt(`0x${amountHex || '0'}`)
      amounts.push(amount)
    }

    return {
      from,
      to,
      tokenIds,
      amounts,
      standard: 'ERC-1155',
    }
  }

  /**
   * Parse any NFT transfer
   * Automatically detects standard and function
   */
  static parse(data: string): NftTransferParams {
    const selector = data.slice(0, 10).toLowerCase()

    // ERC-721
    if (
      selector === ERC721_SELECTORS.TRANSFER_FROM ||
      selector === ERC721_SELECTORS.SAFE_TRANSFER_FROM ||
      selector === ERC721_SELECTORS.SAFE_TRANSFER_FROM_DATA
    ) {
      return this.parseErc721Transfer(data)
    }

    // ERC-1155 single
    if (selector === ERC1155_SELECTORS.SAFE_TRANSFER_FROM) {
      return this.parseErc1155Transfer(data)
    }

    // ERC-1155 batch
    if (selector === ERC1155_SELECTORS.SAFE_BATCH_TRANSFER) {
      return this.parseErc1155BatchTransfer(data)
    }

    throw new Error('Unknown NFT function')
  }

  /**
   * Get transfer summary
   */
  static getTransferSummary(transfer: NftTransferParams): {
    from: string
    to: string
    standard: 'ERC-721' | 'ERC-1155'
    tokenCount: number
    totalAmount: bigint
  } {
    if ('tokenIds' in transfer) {
      // Batch transfer
      return {
        from: transfer.from,
        to: transfer.to,
        standard: transfer.standard,
        tokenCount: transfer.tokenIds.length,
        totalAmount: transfer.amounts.reduce((sum, amt) => sum + amt, 0n),
      }
    } else if ('amount' in transfer) {
      // ERC-1155 single
      return {
        from: transfer.from,
        to: transfer.to,
        standard: transfer.standard,
        tokenCount: 1,
        totalAmount: transfer.amount,
      }
    } else {
      // ERC-721
      return {
        from: transfer.from,
        to: transfer.to,
        standard: transfer.standard,
        tokenCount: 1,
        totalAmount: 1n,
      }
    }
  }
}
