import ExpoModulesCore
import godkls
import goschnorr

public class ExpoMpcModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoMpc")

    Function("isAvailable") { () -> Bool in
      return true
    }

    // === DKLS (ECDSA) KEYGEN ===

    AsyncFunction("createKeygenSetupMessage") { (threshold: Int, partyIds: [String]) -> String in
      var buf = tss_buffer()
      defer { tss_buffer_free(&buf) }

      let byteArray = Self.partyIdsToBytes(partyIds)

      let err = byteArray.withUnsafeBufferPointer { bp in
        var ids = go_slice(ptr: UnsafePointer(bp.baseAddress), len: UInt(bp.count), cap: UInt(bp.count))
        return dkls_keygen_setupmsg_new(UInt32(threshold), nil, &ids, &buf)
      }

      guard err == LIB_OK else {
        throw Exception(name: "DklsError", description: "Keygen setup failed (code: \(err.rawValue))")
      }

      return Data(bytes: buf.ptr, count: Int(buf.len)).base64EncodedString()
    }

    AsyncFunction("createKeygenSession") { (setupBase64: String, localPartyId: String) -> Int in
      guard let setupData = Data(base64Encoded: setupBase64) else {
        throw Exception(name: "DklsError", description: "Invalid base64 setup message")
      }

      var handle = Handle(_0: 0)
      let setupBytes = [UInt8](setupData)
      let idBytes = [UInt8](localPartyId.utf8)

      let err = setupBytes.withUnsafeBufferPointer { setupBp in
        idBytes.withUnsafeBufferPointer { idBp in
          var setup = go_slice(ptr: UnsafePointer(setupBp.baseAddress), len: UInt(setupBp.count), cap: UInt(setupBp.count))
          var idSlice = go_slice(ptr: UnsafePointer(idBp.baseAddress), len: UInt(idBp.count), cap: UInt(idBp.count))
          return dkls_keygen_session_from_setup(&setup, &idSlice, &handle)
        }
      }

      guard err == LIB_OK else {
        throw Exception(name: "DklsError", description: "Session create failed (code: \(err.rawValue))")
      }

      return Int(handle._0)
    }

    // Hot-path: synchronous
    Function("getOutboundMessage") { (handleId: Int) -> String? in
      var buf = tss_buffer()
      defer { tss_buffer_free(&buf) }
      let handle = Handle(_0: Int32(handleId))
      let err = dkls_keygen_session_output_message(handle, &buf)
      if err != LIB_OK || buf.len == 0 { return nil }
      return Data(bytes: buf.ptr, count: Int(buf.len)).base64EncodedString()
    }

    // Hot-path: synchronous
    Function("getMessageReceiver") { (handleId: Int, messageBase64: String, index: Int) -> String? in
      guard let msgData = Data(base64Encoded: messageBase64) else { return nil }
      var buf = tss_buffer()
      defer { tss_buffer_free(&buf) }
      let handle = Handle(_0: Int32(handleId))

      let err = [UInt8](msgData).withUnsafeBufferPointer { bp in
        var msg = go_slice(ptr: UnsafePointer(bp.baseAddress), len: UInt(bp.count), cap: UInt(bp.count))
        return dkls_keygen_session_message_receiver(handle, &msg, UInt32(index), &buf)
      }

      if err != LIB_OK || buf.len == 0 { return nil }
      return String(data: Data(bytes: buf.ptr, count: Int(buf.len)), encoding: .utf8)
    }

    // Hot-path: synchronous
    Function("inputMessage") { (handleId: Int, messageBase64: String) -> Bool in
      guard let msgData = Data(base64Encoded: messageBase64) else {
        throw Exception(name: "DklsError", description: "Invalid base64 message")
      }
      let handle = Handle(_0: Int32(handleId))
      var finished: Int32 = 0

      let err = [UInt8](msgData).withUnsafeBufferPointer { bp in
        var msg = go_slice(ptr: UnsafePointer(bp.baseAddress), len: UInt(bp.count), cap: UInt(bp.count))
        return dkls_keygen_session_input_message(handle, &msg, &finished)
      }

      guard err == LIB_OK else {
        throw Exception(name: "DklsError", description: "Input message failed (code: \(err.rawValue))")
      }

      return finished != 0
    }

    AsyncFunction("finishKeygen") { (handleId: Int) -> [String: String] in
      let sessionHandle = Handle(_0: Int32(handleId))
      var keyshareHandle = Handle(_0: 0)

      let finishErr = dkls_keygen_session_finish(sessionHandle, &keyshareHandle)
      guard finishErr == LIB_OK else {
        throw Exception(name: "DklsError", description: "Keygen finish failed (code: \(finishErr.rawValue))")
      }

      var ksBuf = tss_buffer()
      defer { tss_buffer_free(&ksBuf) }
      let ksErr = dkls_keyshare_to_bytes(keyshareHandle, &ksBuf)
      guard ksErr == LIB_OK else {
        throw Exception(name: "DklsError", description: "Keyshare serialize failed (code: \(ksErr.rawValue))")
      }
      let keyshareB64 = Data(bytes: ksBuf.ptr, count: Int(ksBuf.len)).base64EncodedString()

      var pkBuf = tss_buffer()
      defer { tss_buffer_free(&pkBuf) }
      let pkErr = dkls_keyshare_public_key(keyshareHandle, &pkBuf)
      guard pkErr == LIB_OK else {
        throw Exception(name: "DklsError", description: "Public key extract failed (code: \(pkErr.rawValue))")
      }
      let publicKeyHex = Data(bytes: pkBuf.ptr, count: Int(pkBuf.len)).map { String(format: "%02x", $0) }.joined()

      var ccBuf = tss_buffer()
      defer { tss_buffer_free(&ccBuf) }
      let ccErr = dkls_keyshare_chaincode(keyshareHandle, &ccBuf)
      guard ccErr == LIB_OK else {
        throw Exception(name: "DklsError", description: "Chain code extract failed (code: \(ccErr.rawValue))")
      }
      let chainCodeHex = Data(bytes: ccBuf.ptr, count: Int(ccBuf.len)).map { String(format: "%02x", $0) }.joined()

      return [
        "keyshare": keyshareB64,
        "publicKey": publicKeyHex,
        "chainCode": chainCodeHex,
      ]
    }

    // === DKLS KEY IMPORT ===

    AsyncFunction("createDklsKeyImportSession") { (privateKeyHex: String, chainCodeHex: String, threshold: Int, partyIds: [String]) -> [String: Any] in
      guard let privKeyData = Data(hexString: privateKeyHex) else {
        throw Exception(name: "DklsError", description: "Invalid hex private key")
      }
      guard let chainCodeData = Data(hexString: chainCodeHex) else {
        throw Exception(name: "DklsError", description: "Invalid hex chain code")
      }

      var setupBuf = tss_buffer()
      defer { tss_buffer_free(&setupBuf) }
      var handle = Handle(_0: 0)

      let byteArray = Self.partyIdsToBytes(partyIds)
      let privBytes = [UInt8](privKeyData)
      let ccBytes = [UInt8](chainCodeData)

      let err = privBytes.withUnsafeBufferPointer { privBp in
        ccBytes.withUnsafeBufferPointer { ccBp in
          byteArray.withUnsafeBufferPointer { idsBp in
            var privSlice = go_slice(ptr: UnsafePointer(privBp.baseAddress), len: UInt(privBp.count), cap: UInt(privBp.count))
            var ccSlice = go_slice(ptr: UnsafePointer(ccBp.baseAddress), len: UInt(ccBp.count), cap: UInt(ccBp.count))
            var idsSlice = go_slice(ptr: UnsafePointer(idsBp.baseAddress), len: UInt(idsBp.count), cap: UInt(idsBp.count))
            return dkls_key_import_initiator_new(&privSlice, &ccSlice, UInt8(threshold), &idsSlice, &setupBuf, &handle)
          }
        }
      }

      guard err == LIB_OK else {
        throw Exception(name: "DklsError", description: "DKLS key import session failed (code: \(err.rawValue))")
      }

      let setupData = Data(bytes: setupBuf.ptr, count: Int(setupBuf.len))
      return [
        "setupMessage": setupData.base64EncodedString(),
        "sessionHandle": Int(handle._0),
      ]
    }

    AsyncFunction("createSchnorrKeyImportSession") { (privateKeyHex: String, chainCodeHex: String, threshold: Int, partyIds: [String]) -> [String: Any] in
      guard let privKeyData = Data(hexString: privateKeyHex) else {
        throw Exception(name: "SchnorrError", description: "Invalid hex private key")
      }
      guard let chainCodeData = Data(hexString: chainCodeHex) else {
        throw Exception(name: "SchnorrError", description: "Invalid hex chain code")
      }

      var setupBuf = goschnorr.tss_buffer()
      defer { goschnorr.tss_buffer_free(&setupBuf) }
      var handle = goschnorr.Handle(_0: 0)

      let byteArray = Self.partyIdsToBytes(partyIds)
      let privBytes = [UInt8](privKeyData)
      let ccBytes = [UInt8](chainCodeData)

      let err = privBytes.withUnsafeBufferPointer { privBp in
        ccBytes.withUnsafeBufferPointer { ccBp in
          byteArray.withUnsafeBufferPointer { idsBp in
            var privSlice = goschnorr.go_slice(ptr: UnsafePointer(privBp.baseAddress), len: UInt(privBp.count), cap: UInt(privBp.count))
            var ccSlice = goschnorr.go_slice(ptr: UnsafePointer(ccBp.baseAddress), len: UInt(ccBp.count), cap: UInt(ccBp.count))
            var idsSlice = goschnorr.go_slice(ptr: UnsafePointer(idsBp.baseAddress), len: UInt(idsBp.count), cap: UInt(idsBp.count))
            return schnorr_key_import_initiator_new(&privSlice, &ccSlice, UInt8(threshold), &idsSlice, &setupBuf, &handle)
          }
        }
      }

      guard err == schnorr_lib_error(rawValue: 0) else {
        throw Exception(name: "SchnorrError", description: "Schnorr key import session failed (code: \(err.rawValue))")
      }

      let setupData = Data(bytes: setupBuf.ptr, count: Int(setupBuf.len))
      return [
        "setupMessage": setupData.base64EncodedString(),
        "sessionHandle": Int(handle._0),
      ]
    }

    Function("freeKeygenSession") { (handleId: Int) in
      var handle = Handle(_0: Int32(handleId))
      dkls_keygen_session_free(&handle)
    }

    Function("freeKeyshare") { (handleId: Int) in
      var handle = Handle(_0: Int32(handleId))
      dkls_keyshare_free(&handle)
    }

    // === DKLS (ECDSA) KEYSIGN ===

    Function("loadKeyshare") { (keyshareBase64: String) -> Int in
      guard let ksData = Data(base64Encoded: keyshareBase64) else {
        throw Exception(name: "DklsError", description: "Invalid base64 keyshare")
      }
      var handle = Handle(_0: 0)
      let err = [UInt8](ksData).withUnsafeBufferPointer { bp in
        var slice = go_slice(ptr: UnsafePointer(bp.baseAddress), len: UInt(bp.count), cap: UInt(bp.count))
        return dkls_keyshare_from_bytes(&slice, &handle)
      }
      guard err == LIB_OK else {
        throw Exception(name: "DklsError", description: "Load keyshare failed (code: \(err.rawValue))")
      }
      return Int(handle._0)
    }

    Function("getKeyshareKeyId") { (handleId: Int) -> String in
      var buf = tss_buffer()
      defer { tss_buffer_free(&buf) }
      let handle = Handle(_0: Int32(handleId))
      let err = dkls_keyshare_key_id(handle, &buf)
      guard err == LIB_OK else {
        throw Exception(name: "DklsError", description: "Get key ID failed (code: \(err.rawValue))")
      }
      return Data(bytes: buf.ptr, count: Int(buf.len)).base64EncodedString()
    }

    Function("createSignSetupMessage") { (keyIdBase64: String, chainPath: String, messageHashHex: String, partyIds: [String]) -> String in
      guard let keyIdData = Data(base64Encoded: keyIdBase64) else {
        throw Exception(name: "DklsError", description: "Invalid base64 key ID")
      }
      guard let hashData = Data(hexString: messageHashHex) else {
        throw Exception(name: "DklsError", description: "Invalid hex message hash")
      }

      var buf = tss_buffer()
      defer { tss_buffer_free(&buf) }

      let chainPathBytes = [UInt8](chainPath.utf8)
      let partyBytes = Self.partyIdsToBytes(partyIds)

      let err = [UInt8](keyIdData).withUnsafeBufferPointer { keyBp in
        chainPathBytes.withUnsafeBufferPointer { pathBp in
          [UInt8](hashData).withUnsafeBufferPointer { hashBp in
            partyBytes.withUnsafeBufferPointer { idsBp in
              var keySlice = go_slice(ptr: UnsafePointer(keyBp.baseAddress), len: UInt(keyBp.count), cap: UInt(keyBp.count))
              var pathSlice = go_slice(ptr: UnsafePointer(pathBp.baseAddress), len: UInt(pathBp.count), cap: UInt(pathBp.count))
              var hashSlice = go_slice(ptr: UnsafePointer(hashBp.baseAddress), len: UInt(hashBp.count), cap: UInt(hashBp.count))
              var idsSlice = go_slice(ptr: UnsafePointer(idsBp.baseAddress), len: UInt(idsBp.count), cap: UInt(idsBp.count))
              return dkls_sign_setupmsg_new(&keySlice, &pathSlice, &hashSlice, &idsSlice, &buf)
            }
          }
        }
      }

      guard err == LIB_OK else {
        throw Exception(name: "DklsError", description: "Sign setup failed (code: \(err.rawValue))")
      }

      return Data(bytes: buf.ptr, count: Int(buf.len)).base64EncodedString()
    }

    Function("createSignSession") { (setupBase64: String, localPartyId: String, keyshareHandleId: Int) -> Int in
      guard let setupData = Data(base64Encoded: setupBase64) else {
        throw Exception(name: "DklsError", description: "Invalid base64 setup")
      }
      var handle = Handle(_0: 0)
      let keyshareHandle = Handle(_0: Int32(keyshareHandleId))
      let setupBytes = [UInt8](setupData)
      let idBytes = [UInt8](localPartyId.utf8)

      let err = setupBytes.withUnsafeBufferPointer { setupBp in
        idBytes.withUnsafeBufferPointer { idBp in
          var setup = go_slice(ptr: UnsafePointer(setupBp.baseAddress), len: UInt(setupBp.count), cap: UInt(setupBp.count))
          var idSlice = go_slice(ptr: UnsafePointer(idBp.baseAddress), len: UInt(idBp.count), cap: UInt(idBp.count))
          return dkls_sign_session_from_setup(&setup, &idSlice, keyshareHandle, &handle)
        }
      }

      guard err == LIB_OK else {
        throw Exception(name: "DklsError", description: "Sign session create failed (code: \(err.rawValue))")
      }

      return Int(handle._0)
    }

    // Hot-path: synchronous
    Function("getSignOutboundMessage") { (handleId: Int) -> String? in
      var buf = tss_buffer()
      defer { tss_buffer_free(&buf) }
      let handle = Handle(_0: Int32(handleId))
      let err = dkls_sign_session_output_message(handle, &buf)
      if err != LIB_OK || buf.len == 0 { return nil }
      return Data(bytes: buf.ptr, count: Int(buf.len)).base64EncodedString()
    }

    // Hot-path: synchronous
    Function("getSignMessageReceiver") { (handleId: Int, messageBase64: String, index: Int) -> String? in
      guard let msgData = Data(base64Encoded: messageBase64) else { return nil }
      var buf = tss_buffer()
      defer { tss_buffer_free(&buf) }
      let handle = Handle(_0: Int32(handleId))
      let err = [UInt8](msgData).withUnsafeBufferPointer { bp in
        var msg = go_slice(ptr: UnsafePointer(bp.baseAddress), len: UInt(bp.count), cap: UInt(bp.count))
        return dkls_sign_session_message_receiver(handle, &msg, UInt32(index), &buf)
      }
      if err != LIB_OK || buf.len == 0 { return nil }
      return String(data: Data(bytes: buf.ptr, count: Int(buf.len)), encoding: .utf8)
    }

    // Hot-path: synchronous
    Function("inputSignMessage") { (handleId: Int, messageBase64: String) -> Bool in
      guard let msgData = Data(base64Encoded: messageBase64) else {
        throw Exception(name: "DklsError", description: "Invalid base64 message")
      }
      let handle = Handle(_0: Int32(handleId))
      var finished: Int32 = 0
      let err = [UInt8](msgData).withUnsafeBufferPointer { bp in
        var msg = go_slice(ptr: UnsafePointer(bp.baseAddress), len: UInt(bp.count), cap: UInt(bp.count))
        return dkls_sign_session_input_message(handle, &msg, &finished)
      }
      guard err == LIB_OK else {
        throw Exception(name: "DklsError", description: "Sign input message failed (code: \(err.rawValue))")
      }
      return finished != 0
    }

    Function("finishSign") { (handleId: Int) -> String in
      var buf = tss_buffer()
      defer { tss_buffer_free(&buf) }
      let handle = Handle(_0: Int32(handleId))
      let err = dkls_sign_session_finish(handle, &buf)
      guard err == LIB_OK else {
        throw Exception(name: "DklsError", description: "Sign finish failed (code: \(err.rawValue))")
      }
      return Data(bytes: buf.ptr, count: Int(buf.len)).map { String(format: "%02x", $0) }.joined()
    }

    Function("freeSignSession") { (handleId: Int) in
      var handle = Handle(_0: Int32(handleId))
      dkls_sign_session_free(&handle)
    }

    // === SCHNORR (EdDSA) KEYGEN ===

    AsyncFunction("createSchnorrKeygenSession") { (setupBase64: String, localPartyId: String) -> Int in
      guard let setupData = Data(base64Encoded: setupBase64) else {
        throw Exception(name: "SchnorrError", description: "Invalid base64 setup message")
      }

      var handle = goschnorr.Handle(_0: 0)
      let setupBytes = [UInt8](setupData)
      let idBytes = [UInt8](localPartyId.utf8)

      let err = setupBytes.withUnsafeBufferPointer { setupBp in
        idBytes.withUnsafeBufferPointer { idBp in
          var setup = goschnorr.go_slice(ptr: UnsafePointer(setupBp.baseAddress), len: UInt(setupBp.count), cap: UInt(setupBp.count))
          var idSlice = goschnorr.go_slice(ptr: UnsafePointer(idBp.baseAddress), len: UInt(idBp.count), cap: UInt(idBp.count))
          return schnorr_keygen_session_from_setup(&setup, &idSlice, &handle)
        }
      }

      guard err == schnorr_lib_error(rawValue: 0) else {
        throw Exception(name: "SchnorrError", description: "Schnorr session create failed (code: \(err.rawValue))")
      }

      return Int(handle._0)
    }

    // Hot-path: synchronous
    Function("getSchnorrOutboundMessage") { (handleId: Int) -> String? in
      var buf = goschnorr.tss_buffer()
      defer { goschnorr.tss_buffer_free(&buf) }
      let handle = goschnorr.Handle(_0: Int32(handleId))
      let err = schnorr_keygen_session_output_message(handle, &buf)
      if err != schnorr_lib_error(rawValue: 0) || buf.len == 0 { return nil }
      return Data(bytes: buf.ptr, count: Int(buf.len)).base64EncodedString()
    }

    // Hot-path: synchronous
    Function("getSchnorrMessageReceiver") { (handleId: Int, messageBase64: String, index: Int) -> String? in
      guard let msgData = Data(base64Encoded: messageBase64) else { return nil }
      var buf = goschnorr.tss_buffer()
      defer { goschnorr.tss_buffer_free(&buf) }
      let handle = goschnorr.Handle(_0: Int32(handleId))

      let err = [UInt8](msgData).withUnsafeBufferPointer { bp in
        var msg = goschnorr.go_slice(ptr: UnsafePointer(bp.baseAddress), len: UInt(bp.count), cap: UInt(bp.count))
        return schnorr_keygen_session_message_receiver(handle, &msg, UInt32(index), &buf)
      }

      if err != schnorr_lib_error(rawValue: 0) || buf.len == 0 { return nil }
      return String(data: Data(bytes: buf.ptr, count: Int(buf.len)), encoding: .utf8)
    }

    // Hot-path: synchronous
    Function("inputSchnorrMessage") { (handleId: Int, messageBase64: String) -> Bool in
      guard let msgData = Data(base64Encoded: messageBase64) else {
        throw Exception(name: "SchnorrError", description: "Invalid base64 message")
      }
      let handle = goschnorr.Handle(_0: Int32(handleId))
      var finished: Int32 = 0

      let err = [UInt8](msgData).withUnsafeBufferPointer { bp in
        var msg = goschnorr.go_slice(ptr: UnsafePointer(bp.baseAddress), len: UInt(bp.count), cap: UInt(bp.count))
        return schnorr_keygen_session_input_message(handle, &msg, &finished)
      }

      guard err == schnorr_lib_error(rawValue: 0) else {
        throw Exception(name: "SchnorrError", description: "Schnorr input message failed (code: \(err.rawValue))")
      }

      return finished != 0
    }

    AsyncFunction("finishSchnorrKeygen") { (handleId: Int) -> [String: String] in
      let sessionHandle = goschnorr.Handle(_0: Int32(handleId))
      var keyshareHandle = goschnorr.Handle(_0: 0)

      let finishErr = schnorr_keygen_session_finish(sessionHandle, &keyshareHandle)
      guard finishErr == schnorr_lib_error(rawValue: 0) else {
        throw Exception(name: "SchnorrError", description: "Schnorr keygen finish failed (code: \(finishErr.rawValue))")
      }

      var ksBuf = goschnorr.tss_buffer()
      defer { goschnorr.tss_buffer_free(&ksBuf) }
      let ksErr = schnorr_keyshare_to_bytes(keyshareHandle, &ksBuf)
      guard ksErr == schnorr_lib_error(rawValue: 0) else {
        throw Exception(name: "SchnorrError", description: "Schnorr keyshare serialize failed (code: \(ksErr.rawValue))")
      }
      let keyshareB64 = Data(bytes: ksBuf.ptr, count: Int(ksBuf.len)).base64EncodedString()

      var pkBuf = goschnorr.tss_buffer()
      defer { goschnorr.tss_buffer_free(&pkBuf) }
      let pkErr = schnorr_keyshare_public_key(keyshareHandle, &pkBuf)
      guard pkErr == schnorr_lib_error(rawValue: 0) else {
        throw Exception(name: "SchnorrError", description: "Schnorr public key extract failed (code: \(pkErr.rawValue))")
      }
      let publicKeyHex = Data(bytes: pkBuf.ptr, count: Int(pkBuf.len)).map { String(format: "%02x", $0) }.joined()

      return [
        "keyshare": keyshareB64,
        "publicKey": publicKeyHex,
      ]
    }

    Function("freeSchnorrSession") { (handleId: Int) in
      var handle = goschnorr.Handle(_0: Int32(handleId))
      schnorr_keygen_session_free(&handle)
    }

    // === SCHNORR (EdDSA) KEYSIGN ===

    Function("loadSchnorrKeyshare") { (keyshareBase64: String) -> Int in
      guard let ksData = Data(base64Encoded: keyshareBase64) else {
        throw Exception(name: "SchnorrError", description: "Invalid base64 keyshare")
      }
      var handle = goschnorr.Handle(_0: 0)
      let err = [UInt8](ksData).withUnsafeBufferPointer { bp in
        var slice = goschnorr.go_slice(ptr: UnsafePointer(bp.baseAddress), len: UInt(bp.count), cap: UInt(bp.count))
        return schnorr_keyshare_from_bytes(&slice, &handle)
      }
      guard err == schnorr_lib_error(rawValue: 0) else {
        throw Exception(name: "SchnorrError", description: "Load Schnorr keyshare failed (code: \(err.rawValue))")
      }
      return Int(handle._0)
    }

    Function("getSchnorrKeyshareKeyId") { (handleId: Int) -> String in
      var buf = goschnorr.tss_buffer()
      defer { goschnorr.tss_buffer_free(&buf) }
      let handle = goschnorr.Handle(_0: Int32(handleId))
      let err = schnorr_keyshare_key_id(handle, &buf)
      guard err == schnorr_lib_error(rawValue: 0) else {
        throw Exception(name: "SchnorrError", description: "Get Schnorr key ID failed (code: \(err.rawValue))")
      }
      return Data(bytes: buf.ptr, count: Int(buf.len)).base64EncodedString()
    }

    Function("createSchnorrSignSetupMessage") { (keyIdBase64: String, chainPath: String, messageHashHex: String, partyIds: [String]) -> String in
      guard let keyIdData = Data(base64Encoded: keyIdBase64) else {
        throw Exception(name: "SchnorrError", description: "Invalid base64 key ID")
      }
      guard let hashData = Data(hexString: messageHashHex) else {
        throw Exception(name: "SchnorrError", description: "Invalid hex message hash")
      }

      var buf = goschnorr.tss_buffer()
      defer { goschnorr.tss_buffer_free(&buf) }

      let chainPathBytes = [UInt8](chainPath.utf8)
      let partyBytes = Self.partyIdsToBytes(partyIds)

      let err = [UInt8](keyIdData).withUnsafeBufferPointer { keyBp in
        chainPathBytes.withUnsafeBufferPointer { pathBp in
          [UInt8](hashData).withUnsafeBufferPointer { hashBp in
            partyBytes.withUnsafeBufferPointer { idsBp in
              var keySlice = goschnorr.go_slice(ptr: UnsafePointer(keyBp.baseAddress), len: UInt(keyBp.count), cap: UInt(keyBp.count))
              var pathSlice = goschnorr.go_slice(ptr: UnsafePointer(pathBp.baseAddress), len: UInt(pathBp.count), cap: UInt(pathBp.count))
              var hashSlice = goschnorr.go_slice(ptr: UnsafePointer(hashBp.baseAddress), len: UInt(hashBp.count), cap: UInt(hashBp.count))
              var idsSlice = goschnorr.go_slice(ptr: UnsafePointer(idsBp.baseAddress), len: UInt(idsBp.count), cap: UInt(idsBp.count))
              return schnorr_sign_setupmsg_new(&keySlice, &pathSlice, &hashSlice, &idsSlice, &buf)
            }
          }
        }
      }

      guard err == schnorr_lib_error(rawValue: 0) else {
        throw Exception(name: "SchnorrError", description: "Schnorr sign setup failed (code: \(err.rawValue))")
      }

      return Data(bytes: buf.ptr, count: Int(buf.len)).base64EncodedString()
    }

    Function("createSchnorrSignSession") { (setupBase64: String, localPartyId: String, keyshareHandleId: Int) -> Int in
      guard let setupData = Data(base64Encoded: setupBase64) else {
        throw Exception(name: "SchnorrError", description: "Invalid base64 setup")
      }
      var handle = goschnorr.Handle(_0: 0)
      let keyshareHandle = goschnorr.Handle(_0: Int32(keyshareHandleId))
      let setupBytes = [UInt8](setupData)
      let idBytes = [UInt8](localPartyId.utf8)

      let err = setupBytes.withUnsafeBufferPointer { setupBp in
        idBytes.withUnsafeBufferPointer { idBp in
          var setup = goschnorr.go_slice(ptr: UnsafePointer(setupBp.baseAddress), len: UInt(setupBp.count), cap: UInt(setupBp.count))
          var idSlice = goschnorr.go_slice(ptr: UnsafePointer(idBp.baseAddress), len: UInt(idBp.count), cap: UInt(idBp.count))
          return schnorr_sign_session_from_setup(&setup, &idSlice, keyshareHandle, &handle)
        }
      }

      guard err == schnorr_lib_error(rawValue: 0) else {
        throw Exception(name: "SchnorrError", description: "Schnorr sign session create failed (code: \(err.rawValue))")
      }

      return Int(handle._0)
    }

    // Hot-path: synchronous
    Function("getSchnorrSignOutboundMessage") { (handleId: Int) -> String? in
      var buf = goschnorr.tss_buffer()
      defer { goschnorr.tss_buffer_free(&buf) }
      let handle = goschnorr.Handle(_0: Int32(handleId))
      let err = schnorr_sign_session_output_message(handle, &buf)
      if err != schnorr_lib_error(rawValue: 0) || buf.len == 0 { return nil }
      return Data(bytes: buf.ptr, count: Int(buf.len)).base64EncodedString()
    }

    // Hot-path: synchronous
    Function("getSchnorrSignMessageReceiver") { (handleId: Int, messageBase64: String, index: Int) -> String? in
      guard let msgData = Data(base64Encoded: messageBase64) else { return nil }
      var buf = goschnorr.tss_buffer()
      defer { goschnorr.tss_buffer_free(&buf) }
      let handle = goschnorr.Handle(_0: Int32(handleId))
      let err = [UInt8](msgData).withUnsafeBufferPointer { bp in
        var msg = goschnorr.go_slice(ptr: UnsafePointer(bp.baseAddress), len: UInt(bp.count), cap: UInt(bp.count))
        return schnorr_sign_session_message_receiver(handle, &msg, UInt32(index), &buf)
      }
      if err != schnorr_lib_error(rawValue: 0) || buf.len == 0 { return nil }
      return String(data: Data(bytes: buf.ptr, count: Int(buf.len)), encoding: .utf8)
    }

    // Hot-path: synchronous
    Function("inputSchnorrSignMessage") { (handleId: Int, messageBase64: String) -> Bool in
      guard let msgData = Data(base64Encoded: messageBase64) else {
        throw Exception(name: "SchnorrError", description: "Invalid base64 message")
      }
      let handle = goschnorr.Handle(_0: Int32(handleId))
      var finished: UInt32 = 0
      let err = [UInt8](msgData).withUnsafeBufferPointer { bp in
        var msg = goschnorr.go_slice(ptr: UnsafePointer(bp.baseAddress), len: UInt(bp.count), cap: UInt(bp.count))
        return schnorr_sign_session_input_message(handle, &msg, &finished)
      }
      guard err == schnorr_lib_error(rawValue: 0) else {
        throw Exception(name: "SchnorrError", description: "Schnorr sign input message failed (code: \(err.rawValue))")
      }
      return finished != 0
    }

    Function("finishSchnorrSign") { (handleId: Int) -> String in
      var buf = goschnorr.tss_buffer()
      defer { goschnorr.tss_buffer_free(&buf) }
      let handle = goschnorr.Handle(_0: Int32(handleId))
      let err = schnorr_sign_session_finish(handle, &buf)
      guard err == schnorr_lib_error(rawValue: 0) else {
        throw Exception(name: "SchnorrError", description: "Schnorr sign finish failed (code: \(err.rawValue))")
      }
      return Data(bytes: buf.ptr, count: Int(buf.len)).map { String(format: "%02x", $0) }.joined()
    }

    Function("freeSchnorrSignSession") { (handleId: Int) in
      var handle = goschnorr.Handle(_0: Int32(handleId))
      schnorr_sign_session_free(&handle)
    }
  }

  /// Encode party IDs as null-separated UTF-8 bytes (trailing null removed)
  private static func partyIdsToBytes(_ partyIds: [String]) -> [UInt8] {
    var byteArray: [UInt8] = []
    for id in partyIds {
      if let utf8 = id.data(using: .utf8) {
        byteArray.append(contentsOf: utf8)
        byteArray.append(0)
      }
    }
    if byteArray.last == 0 {
      byteArray.removeLast()
    }
    return byteArray
  }
}

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
