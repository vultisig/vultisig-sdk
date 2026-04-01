@file:OptIn(ExperimentalStdlibApi::class)

package expo.modules.walletcore

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.exception.CodedException

import wallet.core.jni.HDWallet
import wallet.core.jni.CoinType
import wallet.core.jni.Curve
import wallet.core.jni.Purpose
import wallet.core.jni.HDVersion
import wallet.core.jni.PublicKey
import wallet.core.jni.PublicKeyType
import wallet.core.jni.PrivateKey
import wallet.core.jni.AnyAddress
import wallet.core.jni.Bech32

class ExpoWalletCoreModule : Module() {
  companion object {
    init {
      System.loadLibrary("TrustWalletCore")
    }
  }

  private var nextHandleId = 1
  private val hdWallets = mutableMapOf<Int, HDWallet>()
  private val publicKeysMap = mutableMapOf<Int, PublicKey>()

  private fun storeHDWallet(wallet: HDWallet): Int {
    val id = nextHandleId++
    hdWallets[id] = wallet
    return id
  }

  private fun storePublicKey(key: PublicKey): Int {
    val id = nextHandleId++
    publicKeysMap[id] = key
    return id
  }

  private fun hexToBytes(hex: String): ByteArray {
    val clean = if (hex.startsWith("0x")) hex.substring(2) else hex
    return clean.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
  }

  private fun getCurve(name: String): Curve = when (name) {
    "secp256k1" -> Curve.SECP256K1
    "ed25519" -> Curve.ED25519
    "ed25519Blake2bNano" -> Curve.ED25519BLAKE2BNANO
    "curve25519" -> Curve.CURVE25519
    "nist256p1" -> Curve.NIST256P1
    else -> throw CodedException("WalletCoreError", "Unknown curve: $name", null)
  }

  private fun getPublicKeyType(value: Int): PublicKeyType =
    PublicKeyType.values().find { it.value() == value }
      ?: throw CodedException("WalletCoreError", "Invalid key type: $value", null)

  override fun definition() = ModuleDefinition {
    Name("ExpoWalletCore")

    // === HDWallet ===

    Function("createHDWallet") { mnemonic: String, passphrase: String ->
      val wallet = HDWallet(mnemonic, passphrase)
      storeHDWallet(wallet)
    }

    Function("hdWalletGetMasterKey") { walletHandle: Int, curve: String ->
      val wallet = hdWallets[walletHandle]
        ?: throw CodedException("WalletCoreError", "Invalid wallet handle", null)
      val key = wallet.getMasterKey(getCurve(curve))
      key.data().toHexString()
    }

    Function("hdWalletGetKeyForCoin") { walletHandle: Int, coinType: Int ->
      val wallet = hdWallets[walletHandle]
        ?: throw CodedException("WalletCoreError", "Invalid wallet handle", null)
      val ct = CoinType.createFromValue(coinType)
      val key = wallet.getKeyForCoin(ct)
      key.data().toHexString()
    }

    Function("hdWalletGetKey") { walletHandle: Int, coinType: Int, derivationPath: String ->
      val wallet = hdWallets[walletHandle]
        ?: throw CodedException("WalletCoreError", "Invalid wallet handle", null)
      val ct = CoinType.createFromValue(coinType)
      val key = wallet.getKey(ct, derivationPath)
      key.data().toHexString()
    }

    Function("hdWalletGetAddressForCoin") { walletHandle: Int, coinType: Int ->
      val wallet = hdWallets[walletHandle]
        ?: throw CodedException("WalletCoreError", "Invalid wallet handle", null)
      val ct = CoinType.createFromValue(coinType)
      wallet.getAddressForCoin(ct)
    }

    Function("hdWalletGetExtendedPrivateKey") { walletHandle: Int, purpose: Int, coinType: Int, version: Int ->
      val wallet = hdWallets[walletHandle]
        ?: throw CodedException("WalletCoreError", "Invalid wallet handle", null)
      val p = Purpose.values().find { it.value() == purpose }
        ?: throw CodedException("WalletCoreError", "Invalid purpose", null)
      val ct = CoinType.createFromValue(coinType)
      val v = HDVersion.values().find { it.value() == version }
        ?: throw CodedException("WalletCoreError", "Invalid HD version", null)
      wallet.getExtendedPrivateKey(p, ct, v)
    }

    Function("hdWalletDelete") { walletHandle: Int ->
      hdWallets.remove(walletHandle)
    }

    // === PublicKey ===

    Function("createPublicKey") { dataHex: String, keyType: Int ->
      val data = hexToBytes(dataHex)
      val pkt = getPublicKeyType(keyType)
      val pk = PublicKey(data, pkt)
      storePublicKey(pk)
    }

    Function("publicKeyData") { handle: Int ->
      val pk = publicKeysMap[handle]
        ?: throw CodedException("WalletCoreError", "Invalid public key handle", null)
      pk.data().toHexString()
    }

    Function("publicKeyUncompressed") { handle: Int ->
      val pk = publicKeysMap[handle]
        ?: throw CodedException("WalletCoreError", "Invalid public key handle", null)
      pk.uncompressed().data().toHexString()
    }

    Function("publicKeyDelete") { handle: Int ->
      publicKeysMap.remove(handle)
    }

    // === PrivateKey (stateless) ===

    Function("privateKeyGetPublicKeySecp256k1") { privateKeyHex: String, compressed: Boolean ->
      val pk = PrivateKey(hexToBytes(privateKeyHex))
      val pubKey = pk.getPublicKeySecp256k1(compressed)
      pubKey.data().toHexString()
    }

    Function("privateKeyGetPublicKeyEd25519") { privateKeyHex: String ->
      val pk = PrivateKey(hexToBytes(privateKeyHex))
      val pubKey = pk.getPublicKeyEd25519()
      pubKey.data().toHexString()
    }

    Function("privateKeyGetPublicKeyEd25519Cardano") { privateKeyHex: String ->
      val pk = PrivateKey(hexToBytes(privateKeyHex))
      val pubKey = pk.getPublicKeyCurve25519() // Cardano uses curve25519 in JNI
      pubKey.data().toHexString()
    }

    // === CoinType operations ===

    Function("coinTypeDeriveAddressFromPublicKey") { coinType: Int, publicKeyHex: String, publicKeyType: Int ->
      val ct = CoinType.createFromValue(coinType)
      val pkt = getPublicKeyType(publicKeyType)
      val pk = PublicKey(hexToBytes(publicKeyHex), pkt)
      ct.deriveAddressFromPublicKey(pk)
    }

    Function("coinTypeDerivationPath") { coinType: Int ->
      val ct = CoinType.createFromValue(coinType)
      ct.derivationPath()
    }

    Function("coinTypeChainId") { coinType: Int ->
      val ct = CoinType.createFromValue(coinType)
      ct.chainId()
    }

    Function("coinTypeSs58Prefix") { coinType: Int ->
      val ct = CoinType.createFromValue(coinType)
      ct.ss58Prefix().toInt()
    }

    // === AnyAddress ===

    Function("anyAddressIsValid") { address: String, coinType: Int ->
      val ct = CoinType.createFromValue(coinType)
      AnyAddress.isValid(address, ct)
    }

    Function("anyAddressIsValidBech32") { address: String, coinType: Int, hrp: String ->
      val ct = CoinType.createFromValue(coinType)
      AnyAddress.isValidBech32(address, ct, hrp)
    }

    Function("anyAddressCreateWithString") { address: String, coinType: Int ->
      val ct = CoinType.createFromValue(coinType)
      try {
        val addr = AnyAddress(address, ct)
        addr.data().toHexString()
      } catch (e: Exception) {
        null
      }
    }

    Function("anyAddressCreateBech32") { address: String, coinType: Int, hrp: String ->
      val ct = CoinType.createFromValue(coinType)
      try {
        val addr = AnyAddress(address, ct, hrp)
        addr.data().toHexString()
      } catch (e: Exception) {
        null
      }
    }

    Function("anyAddressCreateBech32WithPublicKey") { publicKeyHex: String, publicKeyType: Int, coinType: Int, hrp: String ->
      val ct = CoinType.createFromValue(coinType)
      val pkt = getPublicKeyType(publicKeyType)
      val pk = PublicKey(hexToBytes(publicKeyHex), pkt)
      val addr = AnyAddress(pk, ct, hrp)
      addr.description()
    }

    // === HexCoding ===

    Function("hexDecode") { hexString: String ->
      val data = hexToBytes(hexString)
      java.util.Base64.getEncoder().encodeToString(data)
    }

    Function("hexEncode") { base64Data: String ->
      val data = java.util.Base64.getDecoder().decode(base64Data)
      data.toHexString()
    }

    // === Bech32 ===

    Function("bech32Encode") { hrp: String, dataHex: String ->
      Bech32.encode(hrp, hexToBytes(dataHex))
    }

    // === CoinType constants ===

    Function("getCoinTypes") {
      mapOf(
        "bitcoin" to CoinType.BITCOIN.value(),
        "bitcoinCash" to CoinType.BITCOINCASH.value(),
        "litecoin" to CoinType.LITECOIN.value(),
        "dogecoin" to CoinType.DOGECOIN.value(),
        "dash" to CoinType.DASH.value(),
        "zcash" to CoinType.ZCASH.value(),
        "ethereum" to CoinType.ETHEREUM.value(),
        "smartChain" to CoinType.SMARTCHAIN.value(),
        "polygon" to CoinType.POLYGON.value(),
        "arbitrum" to CoinType.ARBITRUM.value(),
        "optimism" to CoinType.OPTIMISM.value(),
        "base" to CoinType.BASE.value(),
        "blast" to CoinType.BLAST.value(),
        "cronosChain" to CoinType.CRONOSCHAIN.value(),
        "zksync" to CoinType.ZKSYNC.value(),
        "mantle" to CoinType.MANTLE.value(),
        "avalancheCChain" to CoinType.AVALANCHECCHAIN.value(),
        "thorchain" to CoinType.THORCHAIN.value(),
        "cosmos" to CoinType.COSMOS.value(),
        "kujira" to CoinType.KUJIRA.value(),
        "dydx" to CoinType.DYDX.value(),
        "osmosis" to CoinType.OSMOSIS.value(),
        "terraV2" to CoinType.TERRAV2.value(),
        "terra" to CoinType.TERRA.value(),
        "noble" to CoinType.NOBLE.value(),
        "akash" to CoinType.AKASH.value(),
        "solana" to CoinType.SOLANA.value(),
        "sui" to CoinType.SUI.value(),
        "polkadot" to CoinType.POLKADOT.value(),
        "ton" to CoinType.TON.value(),
        "xrp" to CoinType.XRP.value(),
        "tron" to CoinType.TRON.value(),
        "cardano" to CoinType.CARDANO.value(),
      )
    }

    // === Phase 2: TransactionCompiler ===

    Function("transactionCompilerPreImageHashes") { coinType: Int, txInputBase64: String ->
      val ct = CoinType.createFromValue(coinType)
      val inputData = java.util.Base64.getDecoder().decode(txInputBase64)
      val result = wallet.core.jni.TransactionCompiler.preImageHashes(ct, inputData)
      java.util.Base64.getEncoder().encodeToString(result)
    }

    Function("transactionCompilerCompileWithSignatures") { coinType: Int, txInputBase64: String, signaturesBase64: List<String>, publicKeysBase64: List<String> ->
      val ct = CoinType.createFromValue(coinType)
      val inputData = java.util.Base64.getDecoder().decode(txInputBase64)
      val sigs = wallet.core.jni.DataVector()
      for (sigB64 in signaturesBase64) {
        sigs.add(java.util.Base64.getDecoder().decode(sigB64))
      }
      val pks = wallet.core.jni.DataVector()
      for (pkB64 in publicKeysBase64) {
        pks.add(java.util.Base64.getDecoder().decode(pkB64))
      }
      val result = wallet.core.jni.TransactionCompiler.compileWithSignatures(ct, inputData, sigs, pks)
      java.util.Base64.getEncoder().encodeToString(result)
    }

    // === Phase 2: AnySigner ===

    Function("anySignerPlan") { txInputBase64: String, coinType: Int ->
      val ct = CoinType.createFromValue(coinType)
      val inputData = java.util.Base64.getDecoder().decode(txInputBase64)
      val result = wallet.core.jni.AnySigner.plan(inputData, ct, wallet.core.jni.proto.Bitcoin.SigningOutput.parser())
      java.util.Base64.getEncoder().encodeToString(result.toByteArray())
    }

    // === Phase 2: TransactionDecoder ===

    Function("transactionDecoderDecode") { coinType: Int, txDataBase64: String ->
      val ct = CoinType.createFromValue(coinType)
      val txData = java.util.Base64.getDecoder().decode(txDataBase64)
      val result = wallet.core.jni.TransactionDecoder.decode(ct, txData)
      java.util.Base64.getEncoder().encodeToString(result)
    }

    // === Phase 2: BitcoinScript ===

    Function("bitcoinScriptLockScriptForAddress") { address: String, coinType: Int ->
      val ct = CoinType.createFromValue(coinType)
      val script = wallet.core.jni.BitcoinScript.lockScriptForAddress(address, ct)
      java.util.Base64.getEncoder().encodeToString(script.data())
    }

    Function("bitcoinScriptMatchPayToWitnessPublicKeyHash") { scriptBase64: String ->
      val scriptData = java.util.Base64.getDecoder().decode(scriptBase64)
      val script = wallet.core.jni.BitcoinScript(scriptData)
      val result = script.matchPayToWitnessPublicKeyHash()
      if (result != null && result.isNotEmpty()) java.util.Base64.getEncoder().encodeToString(result) else null
    }

    Function("bitcoinScriptMatchPayToPublicKeyHash") { scriptBase64: String ->
      val scriptData = java.util.Base64.getDecoder().decode(scriptBase64)
      val script = wallet.core.jni.BitcoinScript(scriptData)
      val result = script.matchPayToPublicKeyHash()
      if (result != null && result.isNotEmpty()) java.util.Base64.getEncoder().encodeToString(result) else null
    }

    Function("bitcoinScriptBuildPayToWitnessPubkeyHash") { pubKeyHashBase64: String ->
      val hashData = java.util.Base64.getDecoder().decode(pubKeyHashBase64)
      val script = wallet.core.jni.BitcoinScript.buildPayToWitnessPubkeyHash(hashData)
      java.util.Base64.getEncoder().encodeToString(script.data())
    }

    Function("bitcoinScriptBuildPayToPublicKeyHash") { pubKeyHashBase64: String ->
      val hashData = java.util.Base64.getDecoder().decode(pubKeyHashBase64)
      val script = wallet.core.jni.BitcoinScript.buildPayToPublicKeyHash(hashData)
      java.util.Base64.getEncoder().encodeToString(script.data())
    }

    Function("bitcoinScriptHashTypeForCoin") { coinType: Int ->
      val ct = CoinType.createFromValue(coinType)
      wallet.core.jni.BitcoinScript.hashTypeForCoin(ct).toInt()
    }

    // === Phase 2: EthereumAbi ===

    Function("ethereumAbiEncode") { functionName: String, params: List<Map<String, String>> ->
      val fn = wallet.core.jni.EthereumAbiFunction(functionName)
      for (param in params) {
        val type = param["type"] ?: continue
        val value = param["value"] ?: continue
        when (type) {
          "address" -> fn.addParamAddress(hexToBytes(value), false)
          "uint256" -> fn.addParamUInt256(hexToBytes(value), false)
          "uint64" -> fn.addParamUInt64(value.toLong(), false)
          "bool" -> fn.addParamBool(value == "true", false)
          "string" -> fn.addParamString(value, false)
          "bytes" -> fn.addParamBytes(hexToBytes(value), false)
        }
      }
      val encoded = wallet.core.jni.EthereumAbi.encode(fn)
      encoded.toHexString()
    }

    // === Phase 2: TONAddressConverter ===

    Function("tonAddressToUserFriendly") { address: String, bounceable: Boolean, testOnly: Boolean ->
      wallet.core.jni.TONAddressConverter.toUserFriendly(address, bounceable, testOnly)
        ?: throw CodedException("WalletCoreError", "TON address conversion failed", null)
    }

    // === Phase 2: SolanaAddress ===

    Function("solanaAddressCreateWithString") { address: String ->
      val addr = wallet.core.jni.SolanaAddress(address)
      addr.description()
    }
  }
}
