import { Buffer } from "buffer";
import { AccountCoinKey } from "@vultisig/core-chain/coin/AccountCoin";
import { getTronAccountResources } from "@vultisig/core-chain/chains/tron/resources/getTronAccountResources";
import { queryUrl } from "@vultisig/lib-utils/query/queryUrl";
import base58 from "bs58";

import { getEnergyPrice } from "./energyPrice";

type TriggerContractResponse = {
  result?: { result?: boolean; code?: string; message?: string };
  energy_used?: number;
  energy_penalty?: number;
};

type GetTrc20TransferFeeInput = {
  coin: AccountCoinKey;
  amount: bigint;
  receiver: string;
};

type GetTrc20TransferFeeAmountInput = {
  feeLimit: bigint;
  fromAddress: string;
};

const FEE_LIMIT_MARGIN_BPS = 5_000n; // +50%
const FEE_LIMIT_CAP_SUN = 100_000_000n; // 100 TRX

function base58ToHex(address: string): string {
  const decoded = base58.decode(address);
  const addressBytes = decoded.slice(0, -4);
  return Buffer.from(addressBytes).toString("hex");
}

function buildTrc20TransferParameter(
  recipientBaseHex: string,
  amount: bigint,
): string {
  const cleanRecipientHex = recipientBaseHex.replace(/^0x/, "");
  const addressWithoutPrefix = cleanRecipientHex.slice(2);
  const paddedAddressHex = addressWithoutPrefix.padStart(64, "0");
  const amountHex = amount.toString(16);
  const paddedAmountHex = amountHex.padStart(64, "0");
  return paddedAddressHex + paddedAmountHex;
}

export const getTrc20TransferFee = async ({
  coin,
  receiver,
  amount,
}: GetTrc20TransferFeeInput): Promise<bigint> => {
  const recipientAddressHex = base58ToHex(receiver);
  const functionSelector = "transfer(address,uint256)";

  const parameter = buildTrc20TransferParameter(recipientAddressHex, amount);

  const url = "https://api.trongrid.io/wallet/triggerconstantcontract";

  const responseData = await queryUrl<TriggerContractResponse>(url, {
    headers: {
      accept: "application/json",
    },
    body: {
      owner_address: coin.address,
      contract_address: coin.id,
      function_selector: functionSelector,
      parameter: parameter,
      visible: true,
    },
  });

  // triggerconstantcontract can return a 200 with an empty/malformed body or a
  // reverted simulation without surfacing an HTTP error. Live revert responses
  // may even carry result.result=true alongside a REVERT message, so treat any
  // code/message as a failed estimate too. Trusting energy_used=0 in those cases
  // silently produces feeLimit=0 downstream, which guarantees OUT_OF_ENERGY at
  // broadcast.
  const result = responseData.result;
  if (!result || result.result !== true || result.code || result.message) {
    const reason =
      result?.message ||
      result?.code ||
      "empty or malformed response (possible TronGrid indexing lag)";
    throw new Error(
      `[tron] triggerconstantcontract did not return a successful estimate: ${reason}`,
    );
  }

  const energyUsed = responseData.energy_used ?? 0;
  const energyPenalty = responseData.energy_penalty ?? 0;
  const totalEnergy = BigInt(energyUsed) + BigInt(energyPenalty);

  // A successful TRC-20 simulation must consume energy. Fail closed rather than
  // letting a non-positive estimate become a zero/negative protobuf feeLimit.
  if (totalEnergy <= 0n) {
    throw new Error(
      "[tron] triggerconstantcontract returned a non-positive energy estimate",
    );
  }

  const energyPrice = await getEnergyPrice();
  const totalSun = totalEnergy * energyPrice;

  // feeLimit is a spending CEILING, not an expected cost. Base it on the full
  // simulation before staked-energy subtraction so concurrent energy use during
  // the 10-60s MPC ceremony cannot reduce it to zero. Cap pathological estimates
  // at the typical 100 TRX limit documented by the send service.
  const withMargin = totalSun + (totalSun * FEE_LIMIT_MARGIN_BPS) / 10_000n;

  return withMargin > FEE_LIMIT_CAP_SUN ? FEE_LIMIT_CAP_SUN : withMargin;
};

/**
 * Returns the expected TRX burn for display/max-send, separately from the
 * serialized feeLimit ceiling. When the ceiling is capped, return the cap as a
 * conservative estimate because the original uncapped simulation cost cannot
 * be recovered from the protobuf value.
 */
export const getTrc20TransferFeeAmount = async ({
  feeLimit,
  fromAddress,
}: GetTrc20TransferFeeAmountInput): Promise<bigint> => {
  if (feeLimit <= 0n) {
    return 0n;
  }

  const fullBurnEstimate =
    feeLimit >= FEE_LIMIT_CAP_SUN
      ? FEE_LIMIT_CAP_SUN
      : (feeLimit * 10_000n + (10_000n + FEE_LIMIT_MARGIN_BPS - 1n)) /
        (10_000n + FEE_LIMIT_MARGIN_BPS);

  try {
    const [resources, energyPrice] = await Promise.all([
      getTronAccountResources(fromAddress),
      getEnergyPrice(),
    ]);
    const availableEnergy = BigInt(resources.energy.available);
    if (availableEnergy <= 0n) {
      return fullBurnEstimate;
    }

    const coveredSun = availableEnergy * energyPrice;
    return coveredSun >= fullBurnEstimate ? 0n : fullBurnEstimate - coveredSun;
  } catch (err) {
    console.warn(
      "[tron] failed to fetch account energy resources, falling back to worst-case fee",
      err,
    );
    return fullBurnEstimate;
  }
};
