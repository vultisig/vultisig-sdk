import { create } from "@bufbuild/protobuf";
import { initWasm } from "@trustwallet/wallet-core";

import { Chain } from "../packages/core/chain/Chain";
import { getEncodedSigningInputs } from "../packages/core/mpc/keysign/signingInputs/index";
import { getPreSigningHashes } from "../packages/core/mpc/tx/preSigningHashes/index";
import { KeysignPayloadSchema } from "../packages/core/mpc/types/vultisig/keysign/v1/keysign_message_pb";
import { UtxoInfoSchema } from "../packages/core/mpc/types/vultisig/keysign/v1/utxo_info_pb";

async function main() {
  const walletCore = await initWasm();
  const chain = Chain.Bitcoin;

  const senderAddress = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080";
  const recipientAddress = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";

  const utxo = {
    hash: "e3a1b2c3d4e5f60718293a4b5c6d7e8f9012a3b4c5d6e7f8091a2b3c4d5e6f70",
    amount: 100000n,
    index: 0,
  };

  const keysignPayload = create(KeysignPayloadSchema, {
    coin: {
      chain: "bitcoin",
      address: senderAddress,
    },
    toAddress: recipientAddress,
    toAmount: "50000",
    blockchainSpecific: {
      case: "utxoSpecific",
      value: {
        $typeName: "vultisig.keysign.v1.UTXOSpecific",
        byteFee: "1",
        sendMaxAmount: false,
      },
    },
    utxoInfo: [
      create(UtxoInfoSchema, {
        hash: utxo.hash,
        amount: utxo.amount,
        index: utxo.index,
      }),
    ],
  });

  const inputs = getEncodedSigningInputs({
    keysignPayload,
    walletCore,
  });
  const hashes = inputs
    .flatMap((txInputData) =>
      getPreSigningHashes({ walletCore, chain, txInputData }),
    )
    .map((v) => Buffer.from(v).toString("hex"));

  console.log(JSON.stringify(hashes, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
