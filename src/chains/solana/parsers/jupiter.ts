import { BorshCoder } from '@coral-xyz/anchor'
import { NATIVE_MINT } from '@solana/spl-token'
import { Connection, PublicKey } from '@solana/web3.js'
import base58 from 'bs58'

import { solanaRpcUrl } from '../../../core/chain/chains/solana/client'
import { AddressTableLookup, ParsedSolanaSwapParams, PartialInstruction } from '../types'
import { resolveAddressTableKeys } from './transaction'
import { IDL } from '../idl/jupiter'

/**
 * Jupiter V6 instruction parser
 * Extracts swap parameters from Jupiter routing instructions
 */
export class JupiterInstructionParser {
  private coder: BorshCoder
  private programId: PublicKey

  constructor(programId: PublicKey) {
    this.programId = programId
    this.coder = new BorshCoder(IDL)
  }

  /**
   * Parse Jupiter swap instructions and extract relevant data
   *
   * @param instructions - Array of partial instructions from the transaction
   * @param accountKeys - Static account keys from the transaction
   * @param lookups - Address table lookups for v0 transactions
   * @returns Parsed swap parameters including authority, mints, and amounts
   */
  async getInstructionParsedData(
    instructions: PartialInstruction[],
    accountKeys: PublicKey[],
    lookups: AddressTableLookup[]
  ): Promise<ParsedSolanaSwapParams> {
    try {
      // Resolve address lookup tables
      const resolvedLookups = await resolveAddressTableKeys(lookups)
      const allAccountKeys = [...accountKeys, ...resolvedLookups]

      // Find Jupiter instruction
      for (const instruction of instructions) {
        const programIdKey = allAccountKeys[instruction.programId]
        if (!programIdKey || !programIdKey.equals(this.programId)) continue

        // Decode instruction using Borsh coder
        const programDataBuffer = new Uint8Array(
          Object.values(instruction.programData) as any
        )
        const decodedInstruction = this.coder.instruction.decode(
          base58.encode(programDataBuffer),
          'base58'
        )

        if (!decodedInstruction || !this.isRoutingInstruction(decodedInstruction.name)) {
          continue
        }

        // Find the instruction definition in the IDL
        const instructionDef = IDL.instructions.find(
          ins => ins.name === decodedInstruction.name
        )
        if (!instructionDef) continue

        // Extract amounts from instruction data
        const inAmount = (decodedInstruction.data as any).inAmount.toNumber()
        const outAmount = (decodedInstruction.data as any).quotedOutAmount.toNumber()

        // Extract account addresses
        const authority = this.getAccountFromIndex(
          instructionDef,
          instruction,
          allAccountKeys,
          'userTransferAuthority'
        )

        const outputMint = this.getAccountFromIndex(
          instructionDef,
          instruction,
          allAccountKeys,
          'destinationMint'
        )

        // Resolve input mint (more complex, may require on-chain lookup)
        const inputMint = await this.resolveInputMint(
          instructionDef,
          instruction,
          allAccountKeys,
          authority
        )

        return {
          authority,
          inputMint,
          outputMint,
          inAmount,
          outAmount,
        }
      }
    } catch (error) {
      console.error('Error parsing Jupiter instruction:', error)
      return this.getDefaultSwapParams(accountKeys)
    }

    return this.getDefaultSwapParams(accountKeys)
  }

  /**
   * Get account address from instruction by account name
   */
  private getAccountFromIndex(
    instructionDef: any,
    instruction: PartialInstruction,
    accountKeys: PublicKey[],
    accountName: string
  ): string {
    const accountIndex = instructionDef.accounts.findIndex(
      (acc: { name: string }) => acc.name === accountName
    )

    if (accountIndex === -1) {
      return ''
    }

    const actualIndex = instruction.accounts[accountIndex]
    return accountKeys[actualIndex]?.toString() ?? ''
  }

  /**
   * Resolve the input mint address
   * May require fetching account info from the network
   */
  private async resolveInputMint(
    instructionDef: any,
    instruction: PartialInstruction,
    accountKeys: PublicKey[],
    authority: string
  ): Promise<string> {
    // Try to find source account in instruction
    const sourceAccountIndex = instructionDef.accounts.findIndex(
      (acc: { name: string }) =>
        ['sourceMint', 'userSourceTokenAccount', 'sourceTokenAccount'].includes(
          acc.name
        )
    )

    if (sourceAccountIndex === -1) {
      return NATIVE_MINT.toString()
    }

    const accountPubkey = accountKeys[instruction.accounts[sourceAccountIndex]]
    if (!accountPubkey) {
      return NATIVE_MINT.toString()
    }

    // If the source account is the authority itself, it's native SOL
    if (accountPubkey.toString() === authority) {
      return NATIVE_MINT.toString()
    }

    // Fetch account info to get the mint
    try {
      const connection = new Connection(solanaRpcUrl)
      const accountInfo = await connection.getParsedAccountInfo(accountPubkey)

      if (!accountInfo.value) {
        return NATIVE_MINT.toString()
      }

      // Extract mint from parsed account data
      const mint = (accountInfo.value.data as any).parsed?.info?.mint
      return mint ?? NATIVE_MINT.toString()
    } catch (error) {
      console.warn('Error resolving input mint:', error)
      return NATIVE_MINT.toString()
    }
  }

  /**
   * Check if instruction name is a Jupiter routing instruction
   */
  private isRoutingInstruction(name: string): boolean {
    return [
      'route',
      'routeWithTokenLedger',
      'sharedAccountsRoute',
      'sharedAccountsRouteWithTokenLedger',
      'sharedAccountsExactOutRoute',
      'exactOutRoute',
    ].includes(name)
  }

  /**
   * Return default swap params when parsing fails
   */
  private getDefaultSwapParams(accountKeys: PublicKey[]): ParsedSolanaSwapParams {
    return {
      authority: accountKeys[0]?.toString() ?? '',
      inputMint: NATIVE_MINT.toString(),
      outputMint: NATIVE_MINT.toString(),
      inAmount: 0,
      outAmount: 0,
    }
  }
}
