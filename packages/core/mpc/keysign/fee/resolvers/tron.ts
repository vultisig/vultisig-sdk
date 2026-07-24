import { shouldBePresent } from "@vultisig/lib-utils/assert/shouldBePresent";

import { getBlockchainSpecificValue } from "../../chainSpecific/KeysignChainSpecific";
import { getTrc20TransferFeeAmount } from "../../chainSpecific/resolvers/tron/fee";
import { FeeAmountResolver } from "../resolver";

export const getTronFeeAmount: FeeAmountResolver = async ({
  keysignPayload,
}) => {
  const { gasEstimation } = getBlockchainSpecificValue(
    keysignPayload.blockchainSpecific,
    "tronSpecific",
  );
  const coin = shouldBePresent(keysignPayload.coin);

  if (coin.isNativeToken) {
    return gasEstimation;
  }

  return getTrc20TransferFeeAmount({
    feeLimit: gasEstimation,
    fromAddress: coin.address,
  });
};
