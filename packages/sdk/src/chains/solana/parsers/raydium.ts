import { NATIVE_MINT } from '@solana/spl-token'
import { address, type Address } from '@solana/web3.js'

import { getSolanaClient } from '@core/chain/chains/solana/client'
import { AddressTableLookup, ParsedSolanaSwapParams, PartialInstruction } from '../types'
import { resolveAddressTableKeys } from './transaction'

/**
 * Raydium AMM instruction parser
 * Extracts swap parameters from Raydium routing instructions
 */
export class RaydiumInstructionParser {
  private programId: Address

  constructor(programId: Address) {
    this.programId = programId
  }

  /**
   * Parse Raydium swap instructions and extract relevant data
   *
   * @param instructions - Array of partial instructions from the transaction
   * @param accountKeys - Static account keys from the transaction
   * @param lookups - Address table lookups for v0 transactions
   * @returns Parsed swap parameters including authority, mints, and amounts
   */
  async getInstructionParsedData(
    instructions: PartialInstruction[],
    accountKeys: Address[],
    lookups: AddressTableLookup[]
  ): Promise<ParsedSolanaSwapParams> {
    try {
      // Resolve address lookup tables
      const resolvedLookups = await resolveAddressTableKeys(lookups)
      const allAccountKeys = [...accountKeys, ...resolvedLookups]

      // Find Raydium routing instruction
      for (const instruction of instructions) {
        const programIdKey = allAccountKeys[instruction.programId]
        if (!programIdKey || programIdKey !== this.programId) continue

        // Check if this is a routing instruction (opcode 0)
        if (!this.isRoutingInstruction(instruction.programData)) continue

        // Extract mint addresses from token accounts
        const inputMint = await this.getMintFromAccount(
          allAccountKeys,
          instruction.accounts[5] // Input token account index
        )
        const outputMint = await this.getMintFromAccount(
          allAccountKeys,
          instruction.accounts[6] // Output token account index
        )

        // Parse amounts from instruction data
        const buffer = Buffer.from(
          Uint8Array.from(Object.values(instruction.programData))
        )

        if (buffer.length < 17) {
          console.warn('Raydium instruction data too short')
          continue
        }

        // Raydium instruction layout:
        // u8 opcode (0 for routing)
        // u64 input amount (bytes 1-8)
        // u64 minimum output amount (bytes 9-16)
        const authority = allAccountKeys[0] ?? ''
        const inAmount = Number(buffer.readBigUInt64LE(1))
        const outAmount = Number(buffer.readBigUInt64LE(9))

        return {
          authority,
          inputMint,
          outputMint,
          inAmount,
          outAmount,
        }
      }
    } catch (error) {
      console.error('Error parsing Raydium instruction:', error)
      return this.getDefaultSwapParams(accountKeys)
    }

    return this.getDefaultSwapParams(accountKeys)
  }

  /**
   * Check if instruction is a Raydium routing instruction
   * Routing instructions have opcode 0
   */
  private isRoutingInstruction(programData: Uint8Array): boolean {
    return programData[0] === 0
  }

  /**
   * Fetch the mint address from a token account
   * Requires on-chain lookup to get the account's mint
   */
  private async getMintFromAccount(
    accountKeys: Address[],
    accountIndex: number
  ): Promise<string> {
    const accountAddress = accountKeys[accountIndex]
    if (!accountAddress) {
      return NATIVE_MINT.toString()
    }

    try {
      const rpc = getSolanaClient()
      const accountInfo = await rpc.getAccountInfo(address(accountAddress), {
        encoding: 'jsonParsed'
      }).send()

      if (!accountInfo.value) {
        return NATIVE_MINT.toString()
      }

      // Extract mint from parsed token account data
      const mint = (accountInfo.value.data as any).parsed?.info?.mint
      return mint ?? NATIVE_MINT.toString()
    } catch (error) {
      console.warn(`Failed to resolve mint for account index ${accountIndex}:`, error)
      return NATIVE_MINT.toString()
    }
  }

  /**
   * Return default swap params when parsing fails
   */
  private getDefaultSwapParams(accountKeys: Address[]): ParsedSolanaSwapParams {
    return {
      authority: accountKeys[0] ?? '',
      inputMint: NATIVE_MINT.toString(),
      outputMint: NATIVE_MINT.toString(),
      inAmount: 0,
      outAmount: 0,
    }
  }
}
