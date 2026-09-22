/** Read-only production MAX -> prepare -> WalletCore -> RPC proof. Never signs or broadcasts. */
import { HAS_TEST_VAULT_FIXTURE, loadTestVault } from '@helpers/test-vault'
import {
  ComputeBudgetInstruction,
  ComputeBudgetProgram,
  PublicKey,
  SystemInstruction,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import { initWasm, TW } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import { getSolanaClient } from '@vultisig/core-chain/chains/solana/client'
import { getSolanaWalletReserve } from '@vultisig/core-chain/chains/solana/getSolanaWalletReserve'
import { getSolanaSendSigningInput } from '@vultisig/core-mpc/keysign/signingInputs/resolvers/solana/send'
import { describe, expect, it } from 'vitest'

import { getMaxSendAmountFromKeys } from '@/tools/prep/maxSend'

describe.skipIf(!HAS_TEST_VAULT_FIXTURE)('Solana MAX wallet reserve', () => {
  it('retains live rent after the actual unsigned message fee through both SDK entrypoints', async () => {
    const { sdk, vault } = await loadTestVault()
    const walletCore = await initWasm()
    try {
      const client = getSolanaClient()
      const coin = { chain: Chain.Solana, address: await vault.address(Chain.Solana), ticker: 'SOL', decimals: 9 }
      const sender = new PublicKey(coin.address)
      // A second valid wallet address; no funds are sent to it.
      const receiver = 'Eukec6rhM9gwJBB7n38V1ized852M7vQ7nfSgjVMsbKz'
      const account = await client.getAccountInfo(sender, 'confirmed')
      expect(account?.owner.equals(SystemProgram.programId)).toBe(true)
      expect(account?.data.length).toBe(0)
      const reserve = await getSolanaWalletReserve()

      for (const entrypoint of ['vault', 'keys'] as const) {
        const quote =
          entrypoint === 'vault'
            ? await vault.getMaxSendAmount({ coin, receiver })
            : await getMaxSendAmountFromKeys(
                {
                  ecdsaPublicKey: vault.data.publicKeys.ecdsa,
                  eddsaPublicKey: vault.data.publicKeys.eddsa,
                  hexChainCode: vault.data.hexChainCode,
                  localPartyId: vault.data.localPartyId,
                  libType: vault.data.libType,
                  chainPublicKeys: vault.data.chainPublicKeys,
                },
                { coin, receiver },
                walletCore
              )
        expect(quote.maxSendable).toBeGreaterThan(0n)
        expect(quote.maxSendable).toBe(quote.balance - quote.fee - reserve)
        const payload = await vault.prepareSendTx({ coin, receiver, amount: quote.maxSendable })
        const input = getSolanaSendSigningInput({ keysignPayload: payload, walletCore })
        const signatures = walletCore.DataVector.create()
        const publicKeys = walletCore.DataVector.create()
        let transaction: VersionedTransaction
        try {
          signatures.add(new Uint8Array(64))
          publicKeys.add(sender.toBytes())
          const output = TW.Solana.Proto.SigningOutput.decode(
            walletCore.TransactionCompiler.compileWithSignatures(
              walletCore.CoinType.solana,
              TW.Solana.Proto.SigningInput.encode(input).finish(),
              signatures,
              publicKeys
            )
          )
          expect(output.errorMessage).toBe('')
          transaction = VersionedTransaction.deserialize(walletCore.Base58.decodeNoCheck(output.encoded))
        } finally {
          signatures.delete()
          publicKeys.delete()
        }
        const { instructions } = TransactionMessage.decompile(transaction.message)
        const transfer = instructions.find(instruction => instruction.programId.equals(SystemProgram.programId))!
        expect(BigInt(SystemInstruction.decodeTransfer(transfer).lamports)).toBe(quote.maxSendable)
        const budget = instructions.filter(instruction => instruction.programId.equals(ComputeBudgetProgram.programId))
        const price = ComputeBudgetInstruction.decodeSetComputeUnitPrice(
          budget.find(
            instruction => ComputeBudgetInstruction.decodeInstructionType(instruction) === 'SetComputeUnitPrice'
          )!
        ).microLamports
        const limit = ComputeBudgetInstruction.decodeSetComputeUnitLimit(
          budget.find(
            instruction => ComputeBudgetInstruction.decodeInstructionType(instruction) === 'SetComputeUnitLimit'
          )!
        ).units
        const fee = await client.getFeeForMessage(transaction.message, 'confirmed')
        expect(fee.value).not.toBeNull()
        const actualFee = BigInt(fee.value!)
        expect(actualFee).toBe(5000n + (BigInt(price) * BigInt(limit) + 999999n) / 1000000n)
        // A changed priority fee between calls must fail this proof, not be hidden.
        expect(actualFee).toBe(quote.fee)
        const balance = BigInt(await client.getBalance(sender, 'confirmed'))
        const currentReserve = await getSolanaWalletReserve()
        expect(balance - quote.maxSendable - actualFee).toBeGreaterThanOrEqual(currentReserve)
        const simulation = await client.simulateTransaction(transaction, {
          sigVerify: false,
          replaceRecentBlockhash: true,
          commitment: 'confirmed',
          accounts: { addresses: [coin.address], encoding: 'base64' },
        })
        expect(simulation.value.err).toBeNull()
        expect(BigInt(simulation.value.accounts![0]!.lamports)).toBeGreaterThanOrEqual(currentReserve)
        process.stdout.write(
          JSON.stringify({
            entrypoint,
            sender: coin.address,
            balance: balance.toString(),
            max: quote.maxSendable.toString(),
            quotedFee: quote.fee.toString(),
            actualFee: actualFee.toString(),
            reserve: currentReserve.toString(),
            remaining: (balance - quote.maxSendable - actualFee).toString(),
            price: price.toString(),
            limit,
            simulationError: simulation.value.err,
            simulatedRemaining: simulation.value.accounts![0]!.lamports,
            slot: simulation.context.slot,
            broadcast: false,
          }) + '\n'
        )
      }
    } finally {
      sdk.dispose()
    }
  })
})
