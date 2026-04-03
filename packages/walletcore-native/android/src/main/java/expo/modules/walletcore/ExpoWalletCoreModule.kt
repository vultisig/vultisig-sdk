package expo.modules.walletcore

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import wallet.core.jni.*

class ExpoWalletCoreModule : Module() {
    // NOTE: nextHandle and the key/wallet maps are accessed from the Expo module
    // dispatch thread. Expo modules run function handlers on a single background
    // serial queue, so concurrent mutation is not expected. If this assumption
    // ever changes (e.g. concurrent async functions are introduced), these maps
    // must be protected with a lock or replaced with thread-safe collections.
    private var nextHandle = 1
    private val publicKeys = mutableMapOf<Int, PublicKey>()
    private val privateKeys = mutableMapOf<Int, PrivateKey>()
    private val hdWallets = mutableMapOf<Int, HDWallet>()

    init {
        System.loadLibrary("TrustWalletCore")
    }

    private fun storePublicKey(pk: PublicKey): Int {
        val h = nextHandle++; publicKeys[h] = pk; return h
    }
    private fun storePrivateKey(pk: PrivateKey): Int {
        val h = nextHandle++; privateKeys[h] = pk; return h
    }
    private fun storeHDWallet(w: HDWallet): Int {
        val h = nextHandle++; hdWallets[h] = w; return h
    }

    override fun definition() = ModuleDefinition {
        Name("ExpoWalletCore")

        // CoinType
        Function("coinTypeValue") { name: String ->
            CoinType.valueOf(name.uppercase()).value()
        }

        // CoinTypeExt
        Function("derivationPath") { coinType: Int ->
            CoinType.createFromValue(coinType).derivationPath()
        }

        Function("deriveAddressFromPublicKey") { coinType: Int, publicKeyHandle: Int ->
            val pk = publicKeys[publicKeyHandle] ?: throw Exception("Invalid PublicKey handle")
            CoinType.createFromValue(coinType).deriveAddressFromPublicKey(pk)
        }

        Function("chainId") { coinType: Int ->
            CoinType.createFromValue(coinType).chainId()
        }

        Function("ss58Prefix") { coinType: Int ->
            CoinType.createFromValue(coinType).ss58Prefix()
        }

        // PublicKey
        Function("publicKeyCreateWithData") { dataBase64: String, typeValue: Int ->
            val data = android.util.Base64.decode(dataBase64, android.util.Base64.NO_WRAP)
            val pkType = PublicKeyType.createFromValue(typeValue)
            val pk = PublicKey(data, pkType)
            storePublicKey(pk)
        }

        Function("publicKeyData") { handle: Int ->
            val pk = publicKeys[handle] ?: throw Exception("Invalid PublicKey handle")
            android.util.Base64.encodeToString(pk.data(), android.util.Base64.NO_WRAP)
        }

        Function("publicKeyUncompressed") { handle: Int ->
            val pk = publicKeys[handle] ?: throw Exception("Invalid PublicKey handle")
            storePublicKey(pk.uncompressed())
        }

        Function("publicKeyCompressed") { handle: Int ->
            val pk = publicKeys[handle] ?: throw Exception("Invalid PublicKey handle")
            storePublicKey(pk.compressed())
        }

        Function("publicKeyVerify") { handle: Int, signatureBase64: String, messageBase64: String ->
            val pk = publicKeys[handle] ?: return@Function false
            val sig = android.util.Base64.decode(signatureBase64, android.util.Base64.NO_WRAP)
            val msg = android.util.Base64.decode(messageBase64, android.util.Base64.NO_WRAP)
            pk.verify(sig, msg)
        }

        Function("publicKeyVerifyAsDER") { handle: Int, signatureBase64: String, messageBase64: String ->
            val pk = publicKeys[handle] ?: return@Function false
            val sig = android.util.Base64.decode(signatureBase64, android.util.Base64.NO_WRAP)
            val msg = android.util.Base64.decode(messageBase64, android.util.Base64.NO_WRAP)
            pk.verifyAsDER(sig, msg)
        }

        Function("freePublicKey") { handle: Int -> publicKeys.remove(handle) }

        // AnyAddress
        Function("anyAddressIsValid") { address: String, coinType: Int ->
            AnyAddress.isValid(address, CoinType.createFromValue(coinType))
        }

        Function("anyAddressIsValidBech32") { address: String, coinType: Int, hrp: String ->
            AnyAddress.isValidBech32(address, CoinType.createFromValue(coinType), hrp)
        }

        Function("anyAddressIsValidSS58") { address: String, coinType: Int, _ss58Prefix: Int ->
            // TODO: The Trust Wallet Core Android JNI binding does not expose an SS58-prefix
            // overload on AnyAddress. Falling back to the generic isValid check, which uses
            // the coin's default SS58 prefix. Pass the _ss58Prefix argument here once the
            // binding provides AnyAddress.isValidSS58(address, coinType, ss58Prefix).
            AnyAddress.isValid(address, CoinType.createFromValue(coinType))
        }

        Function("anyAddressCreateWithString") { address: String, coinType: Int ->
            AnyAddress(address, CoinType.createFromValue(coinType)).description()
        }

        Function("anyAddressCreateBech32WithPublicKey") { publicKeyHandle: Int, coinType: Int, hrp: String ->
            val pk = publicKeys[publicKeyHandle] ?: throw Exception("Invalid PublicKey handle")
            AnyAddress(pk, CoinType.createFromValue(coinType), hrp).description()
        }

        Function("anyAddressData") { address: String, coinType: Int ->
            val addr = AnyAddress(address, CoinType.createFromValue(coinType))
            android.util.Base64.encodeToString(addr.data(), android.util.Base64.NO_WRAP)
        }

        // TransactionCompiler
        Function("preImageHashes") { coinType: Int, txInputDataBase64: String ->
            val txData = android.util.Base64.decode(txInputDataBase64, android.util.Base64.NO_WRAP)
            val result = TransactionCompiler.preImageHashes(CoinType.createFromValue(coinType), txData)
            android.util.Base64.encodeToString(result, android.util.Base64.NO_WRAP)
        }

        Function("compileWithSignatures") { coinType: Int, txInputDataBase64: String, signaturesBase64: List<String>, publicKeysBase64: List<String> ->
            val txData = android.util.Base64.decode(txInputDataBase64, android.util.Base64.NO_WRAP)
            val signatures = DataVector()
            signaturesBase64.forEach { s ->
                signatures.add(android.util.Base64.decode(s, android.util.Base64.NO_WRAP))
            }
            val pubkeys = DataVector()
            publicKeysBase64.forEach { p ->
                pubkeys.add(android.util.Base64.decode(p, android.util.Base64.NO_WRAP))
            }
            val result = TransactionCompiler.compileWithSignatures(
                CoinType.createFromValue(coinType), txData, signatures, pubkeys
            )
            android.util.Base64.encodeToString(result, android.util.Base64.NO_WRAP)
        }

        // AnySigner
        Function("anySignerPlan") { txInputDataBase64: String, coinType: Int ->
            val txData = android.util.Base64.decode(txInputDataBase64, android.util.Base64.NO_WRAP)
            val result = AnySigner.plan(txData, CoinType.createFromValue(coinType))
            android.util.Base64.encodeToString(result, android.util.Base64.NO_WRAP)
        }

        // HDWallet
        Function("hdWalletCreate") { mnemonic: String, passphrase: String ->
            storeHDWallet(HDWallet(mnemonic, passphrase))
        }

        Function("hdWalletGetMasterKey") { handle: Int, curveValue: Int ->
            val wallet = hdWallets[handle] ?: throw Exception("Invalid HDWallet handle")
            storePrivateKey(wallet.getMasterKey(Curve.createFromValue(curveValue)))
        }

        Function("hdWalletGetKeyForCoin") { handle: Int, coinType: Int ->
            val wallet = hdWallets[handle] ?: throw Exception("Invalid HDWallet handle")
            storePrivateKey(wallet.getKeyForCoin(CoinType.createFromValue(coinType)))
        }

        Function("hdWalletGetKey") { handle: Int, coinType: Int, derivationPath: String ->
            val wallet = hdWallets[handle] ?: throw Exception("Invalid HDWallet handle")
            storePrivateKey(wallet.getKey(CoinType.createFromValue(coinType), derivationPath))
        }

        Function("hdWalletGetAddressForCoin") { handle: Int, coinType: Int ->
            val wallet = hdWallets[handle] ?: throw Exception("Invalid HDWallet handle")
            wallet.getAddressForCoin(CoinType.createFromValue(coinType))
        }

        Function("hdWalletGetExtendedPrivateKey") { handle: Int, purposeValue: Int, coinType: Int, versionValue: Int ->
            val wallet = hdWallets[handle] ?: throw Exception("Invalid HDWallet handle")
            wallet.getExtendedPrivateKey(
                Purpose.createFromValue(purposeValue),
                CoinType.createFromValue(coinType),
                HDVersion.createFromValue(versionValue)
            )
        }

        Function("freeHDWallet") { handle: Int -> hdWallets.remove(handle) }

        // PrivateKey
        Function("privateKeyCreate") { -> storePrivateKey(PrivateKey()) }

        Function("privateKeyData") { handle: Int ->
            val key = privateKeys[handle] ?: throw Exception("Invalid PrivateKey handle")
            android.util.Base64.encodeToString(key.data(), android.util.Base64.NO_WRAP)
        }

        Function("privateKeyGetPublicKeySecp256k1") { handle: Int, compressed: Boolean ->
            val key = privateKeys[handle] ?: throw Exception("Invalid PrivateKey handle")
            storePublicKey(key.getPublicKeySecp256k1(compressed))
        }

        Function("privateKeyGetPublicKeyEd25519") { handle: Int ->
            val key = privateKeys[handle] ?: throw Exception("Invalid PrivateKey handle")
            storePublicKey(key.getPublicKeyEd25519())
        }

        Function("freePrivateKey") { handle: Int -> privateKeys.remove(handle) }

        // HexCoding
        Function("hexDecode") { hex: String ->
            require(hex.length % 2 == 0) { "Hex string must have even length, got ${hex.length}" }
            require(hex.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' }) {
                "Hex string contains non-hex characters"
            }
            val bytes = hex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
            android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
        }

        Function("hexEncode") { dataBase64: String ->
            val data = android.util.Base64.decode(dataBase64, android.util.Base64.NO_WRAP)
            data.joinToString("") { "%02x".format(it) }
        }

        // Bech32
        Function("bech32Encode") { hrp: String, dataBase64: String ->
            val data = android.util.Base64.decode(dataBase64, android.util.Base64.NO_WRAP)
            Bech32.encode(hrp, data)
        }

        // BitcoinScript
        Function("bitcoinScriptBuildPayToWitnessPubkeyHash") { hashBase64: String ->
            val hash = android.util.Base64.decode(hashBase64, android.util.Base64.NO_WRAP)
            val script = BitcoinScript.buildPayToWitnessPubkeyHash(hash)
            android.util.Base64.encodeToString(script.data(), android.util.Base64.NO_WRAP)
        }

        Function("bitcoinScriptBuildPayToPublicKeyHash") { hashBase64: String ->
            val hash = android.util.Base64.decode(hashBase64, android.util.Base64.NO_WRAP)
            val script = BitcoinScript.buildPayToPublicKeyHash(hash)
            android.util.Base64.encodeToString(script.data(), android.util.Base64.NO_WRAP)
        }

        Function("bitcoinScriptLockScriptForAddress") { address: String, coinType: Int ->
            val script = BitcoinScript.lockScriptForAddress(address, CoinType.createFromValue(coinType))
            android.util.Base64.encodeToString(script.data(), android.util.Base64.NO_WRAP)
        }

        Function("bitcoinScriptHashTypeForCoin") { coinType: Int ->
            BitcoinScript.hashTypeForCoin(CoinType.createFromValue(coinType)).toInt()
        }

        // EthereumAbi
        // TODO: _params is currently unused — full ABI encoding requires parsing param
        // types and values from the string and adding them to the EthereumAbiFunction.
        // This encodes only the 4-byte function selector. A complete implementation
        // should accept a structured param list (e.g. JSON) and call fn.addParam*().
        Function("ethereumAbiEncode") { functionName: String, _params: String ->
            val fn = EthereumAbiFunction(functionName)
            val encoded = EthereumAbi.encode(fn)
            android.util.Base64.encodeToString(encoded, android.util.Base64.NO_WRAP)
        }

        // TONAddressConverter
        Function("tonAddressToUserFriendly") { address: String ->
            TONAddressConverter.toUserFriendly(address)
        }

        // SolanaAddress
        Function("solanaAddressDefaultTokenAddress") { address: String, tokenMintAddress: String ->
            SolanaAddress(address).defaultTokenAddress(tokenMintAddress)
        }
    }
}
