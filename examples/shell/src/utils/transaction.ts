import { Chain, VaultBase } from "@vultisig/sdk";
import chalk from "chalk";
import inquirer from "inquirer";
import ora from "ora";

import type { SendParams, TransactionResult } from "./types";

// AccountCoin type from SDK internals
type AccountCoin = {
  chain: Chain;
  address: string;
  decimals: number;
  ticker: string;
  id?: string;
};

/**
 * TransactionManager - High-level transaction orchestration with user confirmation
 *
 * Handles the complete transaction flow with UX:
 * - Prepare transaction payload via SDK
 * - Show preview to user
 * - Get user confirmation
 * - Sign and broadcast via SDK
 */
export class TransactionManager {
  constructor(private vault: VaultBase) {}

  /**
   * Complete send flow: prepare → confirm → sign → broadcast
   * This is the orchestration layer with user interaction
   */
  async send(params: SendParams): Promise<TransactionResult> {
    // 1. Prepare transaction
    const spinner = ora("Preparing transaction...").start();

    try {
      const address = await this.vault.address(params.chain);
      const balance = await this.vault.balance(params.chain, params.tokenId);

      const coin: AccountCoin = {
        chain: params.chain,
        address,
        decimals: balance.decimals,
        ticker: balance.symbol,
        id: params.tokenId,
      };

      const amount = BigInt(
        Math.floor(parseFloat(params.amount) * Math.pow(10, balance.decimals)),
      );

      const payload = await this.vault.prepareSendTx({
        coin,
        receiver: params.to,
        amount,
        memo: params.memo,
      });

      spinner.succeed("Transaction prepared");

      // 2. Get gas estimate
      try {
        const gas = await this.vault.gas(params.chain);
        console.log(
          chalk.blue(`\nEstimated gas: ${JSON.stringify(gas, null, 2)}`),
        );
      } catch {
        console.log(chalk.yellow("\nGas estimation unavailable"));
      }

      // 3. Show transaction preview
      console.log(chalk.cyan("\nTransaction Preview:"));
      console.log(`  From:   ${payload.coin.address}`);
      console.log(`  To:     ${params.to}`);
      console.log(`  Amount: ${params.amount} ${payload.coin.ticker}`);
      console.log(`  Chain:  ${params.chain}`);
      if (params.memo) {
        console.log(`  Memo:   ${params.memo}`);
      }

      // 4. Confirm with user
      const { confirmed } = await inquirer.prompt([
        {
          type: "confirm",
          name: "confirmed",
          message: "Proceed with this transaction?",
          default: false,
        },
      ]);

      if (!confirmed) {
        console.log(chalk.yellow("Transaction cancelled"));
        throw new Error("Transaction cancelled by user");
      }

      // 5. Sign transaction
      const signSpinner = ora("Signing transaction...").start();

      this.vault.on("signingProgress", ({ step }: any) => {
        signSpinner.text = `${step.message} (${step.progress}%)`;
      });

      try {
        const messageHashes = await this.vault.extractMessageHashes(payload);
        const signature = await this.vault.sign({
          transaction: payload,
          chain: payload.coin.chain,
          messageHashes,
        });

        signSpinner.succeed("Transaction signed");

        // 6. Broadcast transaction
        const broadcastSpinner = ora("Broadcasting transaction...").start();
        const txHash = await this.vault.broadcastTx({
          chain: params.chain,
          keysignPayload: payload,
          signature,
        });

        broadcastSpinner.succeed(`Transaction broadcast: ${txHash}`);

        // 7. Return result with explorer URL
        return {
          txHash,
          chain: params.chain,
          explorerUrl: formatTxExplorerUrl(params.chain, txHash),
        };
      } finally {
        this.vault.removeAllListeners("signingProgress");
      }
    } catch (error) {
      spinner.fail("Transaction failed");
      throw error;
    }
  }
}

/**
 * Format explorer URL for transaction hash
 * TODO: Consider moving to SDK as chain-specific metadata
 */
export function formatTxExplorerUrl(chain: Chain, txHash: string): string {
  const explorers: Record<string, string> = {
    [Chain.Ethereum]: `https://etherscan.io/tx/${txHash}`,
    [Chain.Polygon]: `https://polygonscan.com/tx/${txHash}`,
    [Chain.Bitcoin]: `https://blockchair.com/bitcoin/transaction/${txHash}`,
    [Chain.Arbitrum]: `https://arbiscan.io/tx/${txHash}`,
    [Chain.Optimism]: `https://optimistic.etherscan.io/tx/${txHash}`,
    [Chain.Base]: `https://basescan.org/tx/${txHash}`,
    [Chain.BscChain]: `https://bscscan.com/tx/${txHash}`,
    [Chain.Avalanche]: `https://snowtrace.io/tx/${txHash}`,
    [Chain.Blast]: `https://blastscan.io/tx/${txHash}`,
    [Chain.CronosChain]: `https://cronoscan.com/tx/${txHash}`,
    [Chain.Solana]: `https://solscan.io/tx/${txHash}`,
    [Chain.Doge]: `https://blockchair.com/dogecoin/transaction/${txHash}`,
    [Chain.Litecoin]: `https://blockchair.com/litecoin/transaction/${txHash}`,
    [Chain.BitcoinCash]: `https://blockchair.com/bitcoin-cash/transaction/${txHash}`,
  };

  return explorers[chain] || `Transaction Hash: ${txHash}`;
}
