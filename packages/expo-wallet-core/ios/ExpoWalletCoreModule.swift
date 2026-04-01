import ExpoModulesCore
import WalletCore

public class ExpoWalletCoreModule: Module {
  private var nextHandleId: Int = 1
  private var hdWallets: [Int: HDWallet] = [:]
  private var publicKeys: [Int: PublicKey] = [:]

  private func storeHDWallet(_ wallet: HDWallet) -> Int {
    let id = nextHandleId
    nextHandleId += 1
    hdWallets[id] = wallet
    return id
  }

  private func storePublicKey(_ key: PublicKey) -> Int {
    let id = nextHandleId
    nextHandleId += 1
    publicKeys[id] = key
    return id
  }

  public func definition() -> ModuleDefinition {
    Name("ExpoWalletCore")

    // === HDWallet ===

    Function("createHDWallet") { (mnemonic: String, passphrase: String) -> Int in
      guard let wallet = HDWallet(mnemonic: mnemonic, passphrase: passphrase) else {
        throw Exception(name: "WalletCoreError", description: "Invalid mnemonic")
      }
      return self.storeHDWallet(wallet)
    }

    Function("hdWalletGetMasterKey") { (walletHandle: Int, curve: String) -> String in
      guard let wallet = self.hdWallets[walletHandle] else {
        throw Exception(name: "WalletCoreError", description: "Invalid wallet handle")
      }
      let twCurve: Curve
      switch curve {
      case "secp256k1": twCurve = .secp256k1
      case "ed25519": twCurve = .ed25519
      case "ed25519Blake2bNano": twCurve = .ed25519Blake2bNano
      case "curve25519": twCurve = .curve25519
      case "nist256p1": twCurve = .nist256p1
      default: throw Exception(name: "WalletCoreError", description: "Unknown curve: \(curve)")
      }
      let key = wallet.getMasterKey(curve: twCurve)
      return key.data.map { String(format: "%02x", $0) }.joined()
    }

    Function("hdWalletGetKeyForCoin") { (walletHandle: Int, coinType: Int) -> String in
      guard let wallet = self.hdWallets[walletHandle] else {
        throw Exception(name: "WalletCoreError", description: "Invalid wallet handle")
      }
      guard let ct = CoinType(rawValue: UInt32(coinType)) else {
        throw Exception(name: "WalletCoreError", description: "Invalid coin type: \(coinType)")
      }
      let key = wallet.getKeyForCoin(coin: ct)
      return key.data.map { String(format: "%02x", $0) }.joined()
    }

    Function("hdWalletGetKey") { (walletHandle: Int, coinType: Int, derivationPath: String) -> String in
      guard let wallet = self.hdWallets[walletHandle] else {
        throw Exception(name: "WalletCoreError", description: "Invalid wallet handle")
      }
      guard let ct = CoinType(rawValue: UInt32(coinType)) else {
        throw Exception(name: "WalletCoreError", description: "Invalid coin type: \(coinType)")
      }
      let key = wallet.getKey(coin: ct, derivationPath: derivationPath)
      return key.data.map { String(format: "%02x", $0) }.joined()
    }

    Function("hdWalletGetAddressForCoin") { (walletHandle: Int, coinType: Int) -> String in
      guard let wallet = self.hdWallets[walletHandle] else {
        throw Exception(name: "WalletCoreError", description: "Invalid wallet handle")
      }
      guard let ct = CoinType(rawValue: UInt32(coinType)) else {
        throw Exception(name: "WalletCoreError", description: "Invalid coin type: \(coinType)")
      }
      return wallet.getAddressForCoin(coin: ct)
    }

    Function("hdWalletGetExtendedPrivateKey") { (walletHandle: Int, purpose: Int, coinType: Int, version: Int) -> String in
      guard let wallet = self.hdWallets[walletHandle] else {
        throw Exception(name: "WalletCoreError", description: "Invalid wallet handle")
      }
      guard let p = Purpose(rawValue: UInt32(purpose)) else {
        throw Exception(name: "WalletCoreError", description: "Invalid purpose")
      }
      guard let ct = CoinType(rawValue: UInt32(coinType)) else {
        throw Exception(name: "WalletCoreError", description: "Invalid coin type")
      }
      guard let v = HDVersion(rawValue: UInt32(version)) else {
        throw Exception(name: "WalletCoreError", description: "Invalid HD version")
      }
      return wallet.getExtendedPrivateKey(purpose: p, coin: ct, version: v)
    }

    Function("hdWalletDelete") { (walletHandle: Int) in
      self.hdWallets.removeValue(forKey: walletHandle)
    }

    // === PublicKey ===

    Function("createPublicKey") { (dataHex: String, keyType: Int) -> Int in
      guard let data = Data(hexString: dataHex) else {
        throw Exception(name: "WalletCoreError", description: "Invalid hex data")
      }
      guard let pkt = PublicKeyType(rawValue: UInt32(keyType)) else {
        throw Exception(name: "WalletCoreError", description: "Invalid key type")
      }
      guard let pk = PublicKey(data: data, type: pkt) else {
        throw Exception(name: "WalletCoreError", description: "Failed to create public key")
      }
      return self.storePublicKey(pk)
    }

    Function("publicKeyData") { (handle: Int) -> String in
      guard let pk = self.publicKeys[handle] else {
        throw Exception(name: "WalletCoreError", description: "Invalid public key handle")
      }
      return pk.data.map { String(format: "%02x", $0) }.joined()
    }

    Function("publicKeyUncompressed") { (handle: Int) -> String in
      guard let pk = self.publicKeys[handle] else {
        throw Exception(name: "WalletCoreError", description: "Invalid public key handle")
      }
      return pk.uncompressed.data.map { String(format: "%02x", $0) }.joined()
    }

    Function("publicKeyDelete") { (handle: Int) in
      self.publicKeys.removeValue(forKey: handle)
    }

    // === PrivateKey (stateless — operates on hex strings) ===

    Function("privateKeyGetPublicKeySecp256k1") { (privateKeyHex: String, compressed: Bool) -> String in
      guard let data = Data(hexString: privateKeyHex) else {
        throw Exception(name: "WalletCoreError", description: "Invalid private key hex")
      }
      guard let pk = PrivateKey(data: data) else {
        throw Exception(name: "WalletCoreError", description: "Invalid private key")
      }
      let pubKey = pk.getPublicKeySecp256k1(compressed: compressed)
      return pubKey.data.map { String(format: "%02x", $0) }.joined()
    }

    Function("privateKeyGetPublicKeyEd25519") { (privateKeyHex: String) -> String in
      guard let data = Data(hexString: privateKeyHex) else {
        throw Exception(name: "WalletCoreError", description: "Invalid private key hex")
      }
      guard let pk = PrivateKey(data: data) else {
        throw Exception(name: "WalletCoreError", description: "Invalid private key")
      }
      let pubKey = pk.getPublicKeyEd25519()
      return pubKey.data.map { String(format: "%02x", $0) }.joined()
    }

    Function("privateKeyGetPublicKeyEd25519Cardano") { (privateKeyHex: String) -> String in
      guard let data = Data(hexString: privateKeyHex) else {
        throw Exception(name: "WalletCoreError", description: "Invalid private key hex")
      }
      guard let pk = PrivateKey(data: data) else {
        throw Exception(name: "WalletCoreError", description: "Invalid private key")
      }
      let pubKey = pk.getPublicKeyEd25519Cardano()
      return pubKey.data.map { String(format: "%02x", $0) }.joined()
    }

    // === CoinType operations ===

    Function("coinTypeDeriveAddressFromPublicKey") { (coinType: Int, publicKeyHex: String, publicKeyType: Int) -> String in
      guard let ct = CoinType(rawValue: UInt32(coinType)) else {
        throw Exception(name: "WalletCoreError", description: "Invalid coin type")
      }
      guard let data = Data(hexString: publicKeyHex) else {
        throw Exception(name: "WalletCoreError", description: "Invalid public key hex")
      }
      guard let pkt = PublicKeyType(rawValue: UInt32(publicKeyType)) else {
        throw Exception(name: "WalletCoreError", description: "Invalid key type")
      }
      guard let pk = PublicKey(data: data, type: pkt) else {
        throw Exception(name: "WalletCoreError", description: "Invalid public key data")
      }
      return ct.deriveAddressFromPublicKey(publicKey: pk)
    }

    Function("coinTypeDerivationPath") { (coinType: Int) -> String in
      guard let ct = CoinType(rawValue: UInt32(coinType)) else {
        throw Exception(name: "WalletCoreError", description: "Invalid coin type")
      }
      return ct.derivationPath()
    }

    Function("coinTypeChainId") { (coinType: Int) -> String in
      guard let ct = CoinType(rawValue: UInt32(coinType)) else {
        throw Exception(name: "WalletCoreError", description: "Invalid coin type")
      }
      return ct.chainId
    }

    Function("coinTypeSs58Prefix") { (coinType: Int) -> Int in
      guard let ct = CoinType(rawValue: UInt32(coinType)) else {
        throw Exception(name: "WalletCoreError", description: "Invalid coin type")
      }
      return Int(ct.ss58Prefix)
    }

    // === AnyAddress ===

    Function("anyAddressIsValid") { (address: String, coinType: Int) -> Bool in
      guard let ct = CoinType(rawValue: UInt32(coinType)) else { return false }
      return AnyAddress.isValid(string: address, coin: ct)
    }

    Function("anyAddressIsValidBech32") { (address: String, coinType: Int, hrp: String) -> Bool in
      guard let ct = CoinType(rawValue: UInt32(coinType)) else { return false }
      return AnyAddress.isValidBech32(string: address, coin: ct, hrp: hrp)
    }

    Function("anyAddressCreateWithString") { (address: String, coinType: Int) -> String? in
      guard let ct = CoinType(rawValue: UInt32(coinType)) else { return nil }
      guard let addr = AnyAddress(string: address, coin: ct) else { return nil }
      return addr.data.map { String(format: "%02x", $0) }.joined()
    }

    Function("anyAddressCreateBech32") { (address: String, coinType: Int, hrp: String) -> String? in
      guard let ct = CoinType(rawValue: UInt32(coinType)) else { return nil }
      guard let addr = AnyAddress(string: address, coin: ct, hrp: hrp) else { return nil }
      return addr.data.map { String(format: "%02x", $0) }.joined()
    }

    Function("anyAddressCreateBech32WithPublicKey") { (publicKeyHex: String, publicKeyType: Int, coinType: Int, hrp: String) -> String in
      guard let ct = CoinType(rawValue: UInt32(coinType)) else {
        throw Exception(name: "WalletCoreError", description: "Invalid coin type")
      }
      guard let data = Data(hexString: publicKeyHex) else {
        throw Exception(name: "WalletCoreError", description: "Invalid public key hex")
      }
      guard let pkt = PublicKeyType(rawValue: UInt32(publicKeyType)) else {
        throw Exception(name: "WalletCoreError", description: "Invalid key type")
      }
      guard let pk = PublicKey(data: data, type: pkt) else {
        throw Exception(name: "WalletCoreError", description: "Invalid public key")
      }
      let addr = AnyAddress(publicKey: pk, coin: ct, hrp: hrp)
      return addr.description
    }

    // === HexCoding ===

    Function("hexDecode") { (hexString: String) -> String in
      guard let data = Data(hexString: hexString) else {
        throw Exception(name: "WalletCoreError", description: "Invalid hex string")
      }
      return data.base64EncodedString()
    }

    Function("hexEncode") { (base64Data: String) -> String in
      guard let data = Data(base64Encoded: base64Data) else {
        throw Exception(name: "WalletCoreError", description: "Invalid base64 data")
      }
      return data.map { String(format: "%02x", $0) }.joined()
    }

    // === Bech32 ===

    Function("bech32Encode") { (hrp: String, dataHex: String) -> String in
      guard let data = Data(hexString: dataHex) else {
        throw Exception(name: "WalletCoreError", description: "Invalid hex data")
      }
      return Bech32.encode(hrp: hrp, data: data)
    }

    // === CoinType constants ===

    Function("getCoinTypes") { () -> [String: Int] in
      return [
        "bitcoin": Int(CoinType.bitcoin.rawValue),
        "bitcoinCash": Int(CoinType.bitcoinCash.rawValue),
        "litecoin": Int(CoinType.litecoin.rawValue),
        "dogecoin": Int(CoinType.dogecoin.rawValue),
        "dash": Int(CoinType.dash.rawValue),
        "zcash": Int(CoinType.zcash.rawValue),
        "ethereum": Int(CoinType.ethereum.rawValue),
        "smartChain": Int(CoinType.smartChain.rawValue),
        "polygon": Int(CoinType.polygon.rawValue),
        "arbitrum": Int(CoinType.arbitrum.rawValue),
        "optimism": Int(CoinType.optimism.rawValue),
        "base": Int(CoinType.base.rawValue),
        "blast": Int(CoinType.blast.rawValue),
        "cronosChain": Int(CoinType.cronosChain.rawValue),
        "zksync": Int(CoinType.zksync.rawValue),
        "mantle": Int(CoinType.mantle.rawValue),
        "avalancheCChain": Int(CoinType.avalancheCChain.rawValue),
        "thorchain": Int(CoinType.thorchain.rawValue),
        "cosmos": Int(CoinType.cosmos.rawValue),
        "kujira": Int(CoinType.kujira.rawValue),
        "dydx": Int(CoinType.dydx.rawValue),
        "osmosis": Int(CoinType.osmosis.rawValue),
        "terraV2": Int(CoinType.terraV2.rawValue),
        "terra": Int(CoinType.terra.rawValue),
        "noble": Int(CoinType.noble.rawValue),
        "akash": Int(CoinType.akash.rawValue),
        "solana": Int(CoinType.solana.rawValue),
        "sui": Int(CoinType.sui.rawValue),
        "polkadot": Int(CoinType.polkadot.rawValue),
        "ton": Int(CoinType.ton.rawValue),
        "xrp": Int(CoinType.xrp.rawValue),
        "tron": Int(CoinType.tron.rawValue),
        "cardano": Int(CoinType.cardano.rawValue),
      ]
    }

    // === Phase 2: TransactionCompiler ===

    Function("transactionCompilerPreImageHashes") { (coinType: Int, txInputBase64: String) -> String in
      guard let ct = CoinType(rawValue: UInt32(coinType)) else {
        throw Exception(name: "WalletCoreError", description: "Invalid coin type")
      }
      guard let inputData = Data(base64Encoded: txInputBase64) else {
        throw Exception(name: "WalletCoreError", description: "Invalid base64 input")
      }
      let result = TransactionCompiler.preImageHashes(coinType: ct, txInputData: inputData)
      return result.base64EncodedString()
    }

    Function("transactionCompilerCompileWithSignatures") { (coinType: Int, txInputBase64: String, signaturesBase64: [String], publicKeysBase64: [String]) -> String in
      guard let ct = CoinType(rawValue: UInt32(coinType)) else {
        throw Exception(name: "WalletCoreError", description: "Invalid coin type")
      }
      guard let inputData = Data(base64Encoded: txInputBase64) else {
        throw Exception(name: "WalletCoreError", description: "Invalid base64 input")
      }
      let sigs = DataVector()
      for sigB64 in signaturesBase64 {
        if let sigData = Data(base64Encoded: sigB64) {
          sigs.add(data: sigData)
        }
      }
      let pks = DataVector()
      for pkB64 in publicKeysBase64 {
        if let pkData = Data(base64Encoded: pkB64) {
          pks.add(data: pkData)
        }
      }
      let result = TransactionCompiler.compileWithSignatures(coinType: ct, txInputData: inputData, signatures: sigs, publicKeys: pks)
      return result.base64EncodedString()
    }

    // === Phase 2: AnySigner ===

    Function("anySignerPlan") { (txInputBase64: String, coinType: Int) -> String in
      guard let ct = CoinType(rawValue: UInt32(coinType)) else {
        throw Exception(name: "WalletCoreError", description: "Invalid coin type")
      }
      guard let inputData = Data(base64Encoded: txInputBase64) else {
        throw Exception(name: "WalletCoreError", description: "Invalid base64 input")
      }
      let result = AnySigner.nativePlan(data: inputData, coin: ct)
      return result.base64EncodedString()
    }

    // === Phase 2: TransactionDecoder ===

    Function("transactionDecoderDecode") { (coinType: Int, txDataBase64: String) -> String in
      guard let ct = CoinType(rawValue: UInt32(coinType)) else {
        throw Exception(name: "WalletCoreError", description: "Invalid coin type")
      }
      guard let txData = Data(base64Encoded: txDataBase64) else {
        throw Exception(name: "WalletCoreError", description: "Invalid base64 data")
      }
      let result = TransactionDecoder.decode(coinType: ct, encodedTx: txData)
      return result.base64EncodedString()
    }

    // === Phase 2: BitcoinScript ===

    Function("bitcoinScriptLockScriptForAddress") { (address: String, coinType: Int) -> String in
      guard let ct = CoinType(rawValue: UInt32(coinType)) else {
        throw Exception(name: "WalletCoreError", description: "Invalid coin type")
      }
      let script = BitcoinScript.lockScriptForAddress(address: address, coin: ct)
      return script.data.base64EncodedString()
    }

    Function("bitcoinScriptMatchPayToWitnessPublicKeyHash") { (scriptBase64: String) -> String? in
      guard let scriptData = Data(base64Encoded: scriptBase64) else { return nil }
      let script = BitcoinScript(data: scriptData)
      guard let result = script.matchPayToWitnessPublicKeyHash() else { return nil }
      return result.base64EncodedString()
    }

    Function("bitcoinScriptMatchPayToPublicKeyHash") { (scriptBase64: String) -> String? in
      guard let scriptData = Data(base64Encoded: scriptBase64) else { return nil }
      let script = BitcoinScript(data: scriptData)
      guard let result = script.matchPayToPubkeyHash() else { return nil }
      return result.base64EncodedString()
    }

    Function("bitcoinScriptBuildPayToWitnessPubkeyHash") { (pubKeyHashBase64: String) -> String in
      guard let hashData = Data(base64Encoded: pubKeyHashBase64) else {
        throw Exception(name: "WalletCoreError", description: "Invalid base64 data")
      }
      let script = BitcoinScript.buildPayToWitnessPubkeyHash(hash: hashData)
      return script.data.base64EncodedString()
    }

    Function("bitcoinScriptBuildPayToPublicKeyHash") { (pubKeyHashBase64: String) -> String in
      guard let hashData = Data(base64Encoded: pubKeyHashBase64) else {
        throw Exception(name: "WalletCoreError", description: "Invalid base64 data")
      }
      let script = BitcoinScript.buildPayToPublicKeyHash(hash: hashData)
      return script.data.base64EncodedString()
    }

    Function("bitcoinScriptHashTypeForCoin") { (coinType: Int) -> Int in
      guard let ct = CoinType(rawValue: UInt32(coinType)) else {
        throw Exception(name: "WalletCoreError", description: "Invalid coin type")
      }
      return Int(BitcoinScript.hashTypeForCoin(coinType: ct))
    }

    // === Phase 2: EthereumAbi ===

    Function("ethereumAbiEncode") { (functionName: String, params: [[String: String]]) -> String in
      let fn = EthereumAbiFunction(name: functionName)
      for param in params {
        guard let type = param["type"], let value = param["value"] else { continue }
        switch type {
        case "address":
          _ = fn.addParamAddress(val: Data(hexString: value) ?? Data(), isOutput: false)
        case "uint256":
          _ = fn.addParamUInt256(val: Data(hexString: value) ?? Data(), isOutput: false)
        case "uint64":
          _ = fn.addParamUInt64(val: UInt64(value) ?? 0, isOutput: false)
        case "bool":
          _ = fn.addParamBool(val: value == "true", isOutput: false)
        case "string":
          _ = fn.addParamString(val: value, isOutput: false)
        case "bytes":
          _ = fn.addParamBytes(val: Data(hexString: value) ?? Data(), isOutput: false)
        default:
          break
        }
      }
      let encoded = EthereumAbi.encode(fn: fn)
      return encoded.map { String(format: "%02x", $0) }.joined()
    }

    // === Phase 2: TONAddressConverter ===

    Function("tonAddressToUserFriendly") { (address: String, bounceable: Bool, testOnly: Bool) -> String in
      guard let result = TONAddressConverter.toUserFriendly(address: address, bounceable: bounceable, testnet: testOnly) else {
        throw Exception(name: "WalletCoreError", description: "TON address conversion failed")
      }
      return result
    }

    // === Phase 2: SolanaAddress ===

    Function("solanaAddressCreateWithString") { (address: String) -> String in
      guard let addr = SolanaAddress(string: address) else {
        throw Exception(name: "WalletCoreError", description: "Invalid Solana address")
      }
      return addr.description
    }
  }
}

// Helper extension
extension Data {
  init?(hexString: String) {
    let hex = hexString.hasPrefix("0x") ? String(hexString.dropFirst(2)) : hexString
    guard hex.count % 2 == 0 else { return nil }
    var data = Data(capacity: hex.count / 2)
    var index = hex.startIndex
    while index < hex.endIndex {
      let nextIndex = hex.index(index, offsetBy: 2)
      guard let byte = UInt8(hex[index..<nextIndex], radix: 16) else { return nil }
      data.append(byte)
      index = nextIndex
    }
    self = data
  }
}
