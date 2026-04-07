import ExpoModulesCore
import WalletCore

// MARK: - Handle Management

// NOTE: These module-level variables are accessed from the Expo module dispatch
// thread. Expo modules serialize function handler calls onto a single background
// serial queue, so concurrent mutation is not expected. If this assumption ever
// changes (e.g. concurrent AsyncFunction calls are added), access to nextHandle
// and the maps below must be protected with a DispatchQueue or a lock.
private var nextHandle: Int = 1
private var publicKeys: [Int: PublicKey] = [:]
private var privateKeys: [Int: PrivateKey] = [:]
private var hdWallets: [Int: HDWallet] = [:]

private func storePublicKey(_ pk: PublicKey) -> Int {
    let h = nextHandle; nextHandle += 1
    publicKeys[h] = pk
    return h
}

private func storePrivateKey(_ pk: PrivateKey) -> Int {
    let h = nextHandle; nextHandle += 1
    privateKeys[h] = pk
    return h
}

private func storeHDWallet(_ w: HDWallet) -> Int {
    let h = nextHandle; nextHandle += 1
    hdWallets[h] = w
    return h
}

// MARK: - CoinType mapping

private func coinTypeFromValue(_ value: Int) -> CoinType {
    let result = CoinType(rawValue: UInt32(value))
    assert(result != nil, "coinTypeFromValue: unrecognised raw value \(value), falling back to .bitcoin")
    return result ?? .bitcoin
}

private func publicKeyTypeFromValue(_ value: Int) -> PublicKeyType {
    let result = PublicKeyType(rawValue: UInt32(value))
    assert(result != nil, "publicKeyTypeFromValue: unrecognised raw value \(value), falling back to .secp256k1")
    return result ?? .secp256k1
}

private func curveFromValue(_ value: Int) -> Curve {
    let result = Curve(rawValue: UInt32(value))
    assert(result != nil, "curveFromValue: unrecognised raw value \(value), falling back to .secp256k1")
    return result ?? .secp256k1
}

private func purposeFromValue(_ value: Int) -> Purpose {
    let result = Purpose(rawValue: UInt32(value))
    assert(result != nil, "purposeFromValue: unrecognised raw value \(value), falling back to .bip44")
    return result ?? .bip44
}

private func hdVersionFromValue(_ value: Int) -> HDVersion {
    let result = HDVersion(rawValue: UInt32(value))
    assert(result != nil, "hdVersionFromValue: unrecognised raw value \(value), falling back to .none")
    return result ?? .none
}

// MARK: - Module

public class ExpoWalletCoreModule: Module {
    public func definition() -> ModuleDefinition {
        Name("ExpoWalletCore")

        // =====================================================================
        // CoinType
        // =====================================================================

        Function("coinTypeValue") { (name: String) -> Int in
            // Map string name to CoinType raw value
            let mapping: [String: CoinType] = [
                "bitcoin": .bitcoin, "litecoin": .litecoin, "dogecoin": .dogecoin,
                "dash": .dash, "ethereum": .ethereum, "cosmos": .cosmos,
                "zcash": .zcash, "ripple": .xrp, "xrp": .xrp,
                "bitcoinCash": .bitcoinCash, "tron": .tron,
                "polkadot": .polkadot, "ton": .ton, "solana": .solana,
                "thorchain": .thorchain, "sui": .sui, "cardano": .cardano,
                "smartChain": .smartChain, "arbitrum": .arbitrum,
                "avalancheCChain": .avalancheCChain, "base": .base,
                "polygon": .polygon, "optimism": .optimism,
                "cronosChain": .cronosChain, "blast": .blast,
                "zksync": .zksync, "osmosis": .osmosis,
                "terraV2": .terraV2, "terra": .terra,
                "noble": .noble, "kujira": .kujira,
                "dydx": .dydx, "akash": .akash, "mantle": .mantle, "sei": .sei,
            ]
            return Int(mapping[name]?.rawValue ?? 0)
        }

        // =====================================================================
        // CoinTypeExt
        // =====================================================================

        Function("derivationPath") { (coinType: Int) -> String in
            let ct = coinTypeFromValue(coinType)
            return ct.derivationPath()
        }

        Function("deriveAddressFromPublicKey") { (coinType: Int, publicKeyHandle: Int) -> String in
            guard let pk = publicKeys[publicKeyHandle] else {
                throw NSError(domain: "ExpoWalletCore", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid PublicKey handle"])
            }
            let ct = coinTypeFromValue(coinType)
            return ct.deriveAddressFromPublicKey(publicKey: pk)
        }

        Function("chainId") { (coinType: Int) -> String in
            let ct = coinTypeFromValue(coinType)
            return ct.chainId
        }

        Function("ss58Prefix") { (coinType: Int) -> Int in
            let ct = coinTypeFromValue(coinType)
            return Int(ct.ss58Prefix)
        }

        // =====================================================================
        // PublicKey
        // =====================================================================

        Function("publicKeyCreateWithData") { (dataBase64: String, typeValue: Int) -> Int in
            guard let data = Data(base64Encoded: dataBase64) else {
                throw NSError(domain: "ExpoWalletCore", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid base64 data"])
            }
            let pkType = publicKeyTypeFromValue(typeValue)
            guard let pk = PublicKey(data: data, type: pkType) else {
                throw NSError(domain: "ExpoWalletCore", code: -1, userInfo: [NSLocalizedDescriptionKey: "Failed to create PublicKey"])
            }
            return storePublicKey(pk)
        }

        Function("publicKeyData") { (handle: Int) -> String in
            guard let pk = publicKeys[handle] else {
                throw NSError(domain: "ExpoWalletCore", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid PublicKey handle"])
            }
            return pk.data.base64EncodedString()
        }

        Function("publicKeyUncompressed") { (handle: Int) -> Int in
            guard let pk = publicKeys[handle] else {
                throw NSError(domain: "ExpoWalletCore", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid PublicKey handle"])
            }
            return storePublicKey(pk.uncompressed)
        }

        Function("publicKeyCompressed") { (handle: Int) -> Int in
            guard let pk = publicKeys[handle] else {
                throw NSError(domain: "ExpoWalletCore", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid PublicKey handle"])
            }
            return storePublicKey(pk.compressed)
        }

        Function("publicKeyVerify") { (handle: Int, signatureBase64: String, messageBase64: String) -> Bool in
            guard let pk = publicKeys[handle],
                  let sig = Data(base64Encoded: signatureBase64),
                  let msg = Data(base64Encoded: messageBase64) else { return false }
            return pk.verify(signature: sig, message: msg)
        }

        Function("publicKeyVerifyAsDER") { (handle: Int, signatureBase64: String, messageBase64: String) -> Bool in
            guard let pk = publicKeys[handle],
                  let sig = Data(base64Encoded: signatureBase64),
                  let msg = Data(base64Encoded: messageBase64) else { return false }
            return pk.verifyAsDER(signature: sig, message: msg)
        }

        Function("freePublicKey") { (handle: Int) in
            publicKeys.removeValue(forKey: handle)
        }

        // =====================================================================
        // AnyAddress
        // =====================================================================

        Function("anyAddressIsValid") { (address: String, coinType: Int) -> Bool in
            let ct = coinTypeFromValue(coinType)
            return AnyAddress.isValid(string: address, coin: ct)
        }

        Function("anyAddressIsValidBech32") { (address: String, coinType: Int, hrp: String) -> Bool in
            let ct = coinTypeFromValue(coinType)
            return AnyAddress.isValidBech32(string: address, coin: ct, hrp: hrp)
        }

        Function("anyAddressIsValidSS58") { (address: String, coinType: Int, ss58Prefix: Int) -> Bool in
            let ct = coinTypeFromValue(coinType)
            return AnyAddress.isValidSS58(string: address, coin: ct, ss58Prefix: UInt32(ss58Prefix))
        }

        Function("anyAddressCreateWithString") { (address: String, coinType: Int) -> String in
            let ct = coinTypeFromValue(coinType)
            guard let addr = AnyAddress(string: address, coin: ct) else {
                throw NSError(domain: "ExpoWalletCore", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid address"])
            }
            return addr.description
        }

        Function("anyAddressCreateBech32WithPublicKey") { (publicKeyHandle: Int, coinType: Int, hrp: String) -> String in
            guard let pk = publicKeys[publicKeyHandle] else {
                throw NSError(domain: "ExpoWalletCore", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid PublicKey handle"])
            }
            let ct = coinTypeFromValue(coinType)
            let addr = AnyAddress(publicKey: pk, coin: ct, hrp: hrp)
            return addr.description
        }

        Function("anyAddressCreateBech32") { (address: String, coinType: Int, hrp: String) -> String in
            let ct = coinTypeFromValue(coinType)
            guard let addr = AnyAddress(string: address, coin: ct, hrp: hrp) else {
                throw NSError(domain: "ExpoWalletCore", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid bech32 address"])
            }
            return addr.description
        }

        Function("anyAddressData") { (address: String, coinType: Int) -> String in
            let ct = coinTypeFromValue(coinType)
            guard let addr = AnyAddress(string: address, coin: ct) else {
                throw NSError(domain: "ExpoWalletCore", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid address"])
            }
            return addr.data.base64EncodedString()
        }

        // =====================================================================
        // TransactionCompiler
        // =====================================================================

        Function("preImageHashes") { (coinType: Int, txInputDataBase64: String) -> String in
            guard let txData = Data(base64Encoded: txInputDataBase64) else {
                throw NSError(domain: "ExpoWalletCore", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid base64 data"])
            }
            let ct = coinTypeFromValue(coinType)
            let result = TransactionCompiler.preImageHashes(coinType: ct, txInputData: txData)
            return result.base64EncodedString()
        }

        Function("compileWithSignatures") { (coinType: Int, txInputDataBase64: String, signaturesBase64: [String], publicKeysBase64: [String]) -> String in
            guard let txData = Data(base64Encoded: txInputDataBase64) else {
                throw NSError(domain: "ExpoWalletCore", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid base64 data"])
            }
            let ct = coinTypeFromValue(coinType)

            let signatures = DataVector()
            for sigB64 in signaturesBase64 {
                if let sigData = Data(base64Encoded: sigB64) {
                    signatures.add(data: sigData)
                }
            }

            let pubkeys = DataVector()
            for pkB64 in publicKeysBase64 {
                if let pkData = Data(base64Encoded: pkB64) {
                    pubkeys.add(data: pkData)
                }
            }

            let result = TransactionCompiler.compileWithSignatures(
                coinType: ct,
                txInputData: txData,
                signatures: signatures,
                publicKeys: pubkeys
            )
            return result.base64EncodedString()
        }

        // =====================================================================
        // AnySigner
        // =====================================================================

        Function("anySignerPlan") { (txInputDataBase64: String, coinType: Int) -> String in
            guard let txData = Data(base64Encoded: txInputDataBase64) else {
                throw NSError(domain: "ExpoWalletCore", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid base64 data"])
            }
            let ct = coinTypeFromValue(coinType)
            let result = AnySigner.nativePlan(data: txData, coin: ct)
            return result.base64EncodedString()
        }

        // =====================================================================
        // HDWallet
        // =====================================================================

        Function("hdWalletCreate") { (mnemonic: String, passphrase: String) -> Int in
            guard let wallet = HDWallet(mnemonic: mnemonic, passphrase: passphrase) else {
                throw NSError(domain: "ExpoWalletCore", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid mnemonic"])
            }
            return storeHDWallet(wallet)
        }

        Function("hdWalletGetMasterKey") { (handle: Int, curveValue: Int) -> Int in
            guard let wallet = hdWallets[handle] else {
                throw NSError(domain: "ExpoWalletCore", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid HDWallet handle"])
            }
            let curve = curveFromValue(curveValue)
            let key = wallet.getMasterKey(curve: curve)
            return storePrivateKey(key)
        }

        Function("hdWalletGetKeyForCoin") { (handle: Int, coinType: Int) -> Int in
            guard let wallet = hdWallets[handle] else {
                throw NSError(domain: "ExpoWalletCore", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid HDWallet handle"])
            }
            let ct = coinTypeFromValue(coinType)
            let key = wallet.getKeyForCoin(coin: ct)
            return storePrivateKey(key)
        }

        Function("hdWalletGetKeyDerivation") { (handle: Int, coinType: Int, derivationValue: Int) -> Int in
            guard let wallet = hdWallets[handle] else {
                throw NSError(domain: "ExpoWalletCore", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid HDWallet handle"])
            }
            let ct = coinTypeFromValue(coinType)
            let derivation = Derivation(rawValue: UInt32(derivationValue)) ?? .default
            let key = wallet.getKeyDerivation(coin: ct, derivation: derivation)
            return storePrivateKey(key)
        }

        Function("hdWalletGetAddressDerivation") { (handle: Int, coinType: Int, derivationValue: Int) -> String in
            guard let wallet = hdWallets[handle] else {
                throw NSError(domain: "ExpoWalletCore", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid HDWallet handle"])
            }
            let ct = coinTypeFromValue(coinType)
            let derivation = Derivation(rawValue: UInt32(derivationValue)) ?? .default
            return wallet.getAddressDerivation(coin: ct, derivation: derivation)
        }

        Function("hdWalletGetKey") { (handle: Int, coinType: Int, derivationPath: String) -> Int in
            guard let wallet = hdWallets[handle] else {
                throw NSError(domain: "ExpoWalletCore", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid HDWallet handle"])
            }
            let ct = coinTypeFromValue(coinType)
            let key = wallet.getKey(coin: ct, derivationPath: derivationPath)
            return storePrivateKey(key)
        }

        Function("hdWalletGetAddressForCoin") { (handle: Int, coinType: Int) -> String in
            guard let wallet = hdWallets[handle] else {
                throw NSError(domain: "ExpoWalletCore", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid HDWallet handle"])
            }
            let ct = coinTypeFromValue(coinType)
            return wallet.getAddressForCoin(coin: ct)
        }

        Function("hdWalletGetExtendedPrivateKey") { (handle: Int, purposeValue: Int, coinType: Int, versionValue: Int) -> String in
            guard let wallet = hdWallets[handle] else {
                throw NSError(domain: "ExpoWalletCore", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid HDWallet handle"])
            }
            let purpose = purposeFromValue(purposeValue)
            let ct = coinTypeFromValue(coinType)
            let version = hdVersionFromValue(versionValue)
            return wallet.getExtendedPrivateKey(purpose: purpose, coin: ct, version: version)
        }

        Function("freeHDWallet") { (handle: Int) in
            hdWallets.removeValue(forKey: handle)
        }

        // =====================================================================
        // PrivateKey
        // =====================================================================

        Function("privateKeyCreate") { () -> Int in
            let key = PrivateKey()
            return storePrivateKey(key)
        }

        Function("privateKeyData") { (handle: Int) -> String in
            guard let key = privateKeys[handle] else {
                throw NSError(domain: "ExpoWalletCore", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid PrivateKey handle"])
            }
            return key.data.base64EncodedString()
        }

        Function("privateKeyGetPublicKeySecp256k1") { (handle: Int, compressed: Bool) -> Int in
            guard let key = privateKeys[handle] else {
                throw NSError(domain: "ExpoWalletCore", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid PrivateKey handle"])
            }
            let pk = key.getPublicKeySecp256k1(compressed: compressed)
            return storePublicKey(pk)
        }

        Function("privateKeyGetPublicKeyEd25519") { (handle: Int) -> Int in
            guard let key = privateKeys[handle] else {
                throw NSError(domain: "ExpoWalletCore", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid PrivateKey handle"])
            }
            let pk = key.getPublicKeyEd25519()
            return storePublicKey(pk)
        }

        Function("freePrivateKey") { (handle: Int) in
            privateKeys.removeValue(forKey: handle)
        }

        // =====================================================================
        // HexCoding
        // =====================================================================

        Function("hexDecode") { (hex: String) -> String in
            guard hex.count % 2 == 0 else {
                throw NSError(
                    domain: "ExpoWalletCore",
                    code: -1,
                    userInfo: [NSLocalizedDescriptionKey: "Hex string must have even length, got \(hex.count)"]
                )
            }
            var data = Data()
            var temp = ""
            for c in hex.lowercased() {
                temp.append(c)
                if temp.count == 2 {
                    if let byte = UInt8(temp, radix: 16) {
                        data.append(byte)
                    }
                    temp = ""
                }
            }
            return data.base64EncodedString()
        }

        Function("hexEncode") { (dataBase64: String) -> String in
            guard let data = Data(base64Encoded: dataBase64) else { return "" }
            return data.map { String(format: "%02x", $0) }.joined()
        }

        // =====================================================================
        // Bech32
        // =====================================================================

        Function("bech32Encode") { (hrp: String, dataBase64: String) -> String in
            guard let data = Data(base64Encoded: dataBase64) else { return "" }
            return Bech32.encode(hrp: hrp, data: data)
        }

        // =====================================================================
        // BitcoinScript
        // =====================================================================

        Function("bitcoinScriptBuildPayToWitnessPubkeyHash") { (hashBase64: String) -> String in
            guard let hash = Data(base64Encoded: hashBase64) else { return "" }
            let script = BitcoinScript.buildPayToWitnessPubkeyHash(hash: hash)
            return script.data.base64EncodedString()
        }

        Function("bitcoinScriptBuildPayToPublicKeyHash") { (hashBase64: String) -> String in
            guard let hash = Data(base64Encoded: hashBase64) else { return "" }
            let script = BitcoinScript.buildPayToPublicKeyHash(hash: hash)
            return script.data.base64EncodedString()
        }

        Function("bitcoinScriptLockScriptForAddress") { (address: String, coinType: Int) -> String in
            let ct = coinTypeFromValue(coinType)
            let script = BitcoinScript.lockScriptForAddress(address: address, coin: ct)
            return script.data.base64EncodedString()
        }

        Function("bitcoinScriptHashTypeForCoin") { (coinType: Int) -> Int in
            let ct = coinTypeFromValue(coinType)
            return Int(BitcoinScript.hashTypeForCoin(coinType: ct))
        }

        // =====================================================================
        // EthereumAbi (simplified — encode a function call)
        // =====================================================================

        Function("ethereumAbiEncode") { (functionName: String, params: String) -> String in
            // TODO: params is currently unused — full ABI encoding requires parsing param
            // types and values from the string and adding them to the EthereumAbiFunction.
            // This encodes only the 4-byte function selector. A complete implementation
            // should accept a structured param list (e.g. JSON) and call fn.addParam*().
            let fn = EthereumAbiFunction(name: functionName)
            let encoded = EthereumAbi.encode(fn: fn)
            return encoded.base64EncodedString()
        }

        Function("ethereumAbiEncodeTyped") { (messageJson: String) -> String in
            let encoded = EthereumAbi.encodeTyped(messageJson: messageJson)
            return encoded.map { String(format: "%02x", $0) }.joined()
        }

        // =====================================================================
        // Mnemonic
        // =====================================================================

        Function("mnemonicIsValid") { (mnemonic: String) -> Bool in
            return Mnemonic.isValid(mnemonic: mnemonic)
        }

        // =====================================================================
        // TONAddressConverter
        // =====================================================================

        Function("tonAddressToUserFriendly") { (address: String) -> String in
            guard let result = TONAddressConverter.toUserFriendly(address: address, bounceable: false, testnet: false) else {
                throw NSError(domain: "ExpoWalletCore", code: -1, userInfo: [NSLocalizedDescriptionKey: "Failed to convert TON address"])
            }
            return result
        }

        // =====================================================================
        // SolanaAddress
        // =====================================================================

        Function("solanaAddressDefaultTokenAddress") { (address: String, tokenMintAddress: String) -> String in
            guard let solAddr = SolanaAddress(string: address),
                  let tokenAddr = solAddr.defaultTokenAddress(tokenMintAddress: tokenMintAddress) else {
                throw NSError(domain: "ExpoWalletCore", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid Solana address or token mint"])
            }
            return tokenAddr
        }
    }
}
