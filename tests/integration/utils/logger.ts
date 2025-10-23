/**
 * Transaction Logger for Integration Tests
 *
 * Logs transaction details including hashes, explorer links, and dry-run status
 */

export interface TransactionLog {
  chain: string;
  operation: string;
  hash?: string;
  explorerUrl?: string;
  amount?: string;
  from?: string;
  to?: string;
  dryRun: boolean;
  timestamp: Date;
  error?: string;
}

class TransactionLogger {
  private logs: TransactionLog[] = [];

  /**
   * Log a successful transaction
   */
  logSuccess(params: {
    chain: string;
    operation: string;
    hash?: string;
    explorerUrl?: string;
    amount?: string;
    from?: string;
    to?: string;
    dryRun: boolean;
  }): void {
    const log: TransactionLog = {
      ...params,
      timestamp: new Date(),
    };

    this.logs.push(log);

    const prefix = params.dryRun ? '[DRY-RUN]' : '[LIVE]';
    const checkmark = params.dryRun ? '⚠' : '✓';

    console.log('\n' + '='.repeat(80));
    console.log(`${checkmark} ${prefix} ${params.chain} - ${params.operation}`);
    console.log('='.repeat(80));

    if (params.from) {
      console.log(`From:     ${params.from}`);
    }
    if (params.to) {
      console.log(`To:       ${params.to}`);
    }
    if (params.amount) {
      console.log(`Amount:   ${params.amount}`);
    }
    if (params.hash) {
      console.log(`Tx Hash:  ${params.hash}`);
    }
    if (params.explorerUrl) {
      console.log(`Explorer: ${params.explorerUrl}`);
    }

    if (params.dryRun) {
      console.log('\nℹ️  DRY-RUN MODE: Transaction signed but NOT broadcasted');
    }

    console.log('='.repeat(80) + '\n');
  }

  /**
   * Log a failed transaction
   */
  logError(params: {
    chain: string;
    operation: string;
    error: string;
    dryRun: boolean;
  }): void {
    const log: TransactionLog = {
      ...params,
      timestamp: new Date(),
    };

    this.logs.push(log);

    const prefix = params.dryRun ? '[DRY-RUN]' : '[LIVE]';

    console.error('\n' + '='.repeat(80));
    console.error(`✗ ${prefix} ${params.chain} - ${params.operation} FAILED`);
    console.error('='.repeat(80));
    console.error(`Error: ${params.error}`);
    console.error('='.repeat(80) + '\n');
  }

  /**
   * Log dry-run payload details
   */
  logDryRunPayload(params: {
    chain: string;
    operation: string;
    payload: any;
  }): void {
    console.log('\n' + '-'.repeat(80));
    console.log(`[DRY-RUN] ${params.chain} - ${params.operation} Payload`);
    console.log('-'.repeat(80));
    console.log(JSON.stringify(params.payload, null, 2));
    console.log('-'.repeat(80) + '\n');
  }

  /**
   * Get all transaction logs
   */
  getLogs(): TransactionLog[] {
    return [...this.logs];
  }

  /**
   * Get summary statistics
   */
  getSummary(): {
    total: number;
    successful: number;
    failed: number;
    dryRun: number;
    live: number;
  } {
    return {
      total: this.logs.length,
      successful: this.logs.filter((log) => !log.error).length,
      failed: this.logs.filter((log) => log.error).length,
      dryRun: this.logs.filter((log) => log.dryRun).length,
      live: this.logs.filter((log) => !log.dryRun).length,
    };
  }

  /**
   * Print summary at the end of test run
   */
  printSummary(): void {
    const summary = this.getSummary();

    console.log('\n' + '='.repeat(80));
    console.log('INTEGRATION TEST SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total Transactions: ${summary.total}`);
    console.log(`  Successful:       ${summary.successful}`);
    console.log(`  Failed:           ${summary.failed}`);
    console.log(`  Dry-Run:          ${summary.dryRun}`);
    console.log(`  Live:             ${summary.live}`);
    console.log('='.repeat(80) + '\n');
  }

  /**
   * Clear all logs
   */
  clear(): void {
    this.logs = [];
  }
}

// Export singleton instance
export const txLogger = new TransactionLogger();
