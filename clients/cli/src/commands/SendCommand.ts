import { SignCommand } from "./SignCommand";

export type SendOptions = {
  network: string;
  to: string;
  amount: string;
  memo?: string;
  vault?: string;
  password?: string;
};

export class SendCommand {
  readonly description = "Send cryptocurrency from your vault to an address";

  async run(options: SendOptions): Promise<void> {
    if (!options.network) {
      throw new Error("--network is required");
    }
    if (!options.to) {
      throw new Error("--to address is required");
    }
    if (!options.amount) {
      throw new Error("--amount is required");
    }

    const network = options.network.toUpperCase();

    if (network !== "ETH" && network !== "ETHEREUM") {
      throw new Error("Only ETH network is currently supported");
    }

    console.log("\n💸 Preparing to send transaction...");
    console.log(`Network: ${network}`);
    console.log(`To: ${options.to}`);
    console.log(`Amount: ${options.amount} ETH`);
    if (options.memo) {
      console.log(`Memo: ${options.memo}`);
    }

    console.log("\n🔨 Building transaction payload...");
    const txPayload = this.buildEthTransactionPayload({
      to: options.to,
      amount: options.amount,
      memo: options.memo,
    });

    console.log("Payload created:");
    console.log(`  To: ${txPayload.to}`);
    console.log(`  Value: ${txPayload.value} Wei`);
    console.log(`  Gas Limit: ${txPayload.gasLimit}`);

    console.log("\n🔐 Passing to sign command...");
    const signCommand = new SignCommand();
    await signCommand.run({
      network: "ETH",
      payloadData: txPayload,
      vault: options.vault,
      password: options.password,
    });
  }

  private buildEthTransactionPayload({
    to,
    amount,
    memo,
  }: {
    to: string;
    amount: string;
    memo?: string;
  }) {
    const amountInWei = BigInt(Math.floor(parseFloat(amount) * 1e18));
    const gasLimit = 21000;

    return {
      to,
      value: amountInWei.toString(),
      data: memo ? `0x${Buffer.from(memo).toString("hex")}` : "0x",
      gasLimit: gasLimit.toString(),
      type: 2,
      chainId: 1,
    };
  }
}
