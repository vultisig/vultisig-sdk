import ExpoModulesCore
import godkls
import goschnorr

// MARK: - Helpers

/// ARC-managed buffer that pins bytes in stable heap memory for Go FFI calls.
/// The pointer remains valid as long as this object is in scope (reference counted).
/// Always assign to a local variable to prevent premature deallocation:
///   `let pin = PinnedSlice(bytes); var slice = pin.slice`
private class PinnedSlice {
    private let buffer: UnsafeMutableBufferPointer<UInt8>

    init(_ arr: [UInt8]) {
        buffer = .allocate(capacity: max(arr.count, 1))
        if !arr.isEmpty {
            _ = buffer.initialize(from: arr)
        }
    }

    convenience init(_ data: Data) {
        self.init(Array(data))
    }

    var slice: go_slice {
        go_slice(
            ptr: buffer.baseAddress,
            len: UInt(buffer.count),
            cap: UInt(buffer.count)
        )
    }

    deinit {
        buffer.deallocate()
    }
}

private func tssBufferToData(_ buf: tss_buffer) -> Data {
    guard buf.ptr != nil, buf.len > 0 else { return Data() }
    return Data(bytes: buf.ptr, count: Int(buf.len))
}

private func encodeIds(_ ids: [String]) -> [UInt8] {
    var result: [UInt8] = []
    for id in ids {
        result.append(contentsOf: Array(id.utf8))
        result.append(0) // null separator
    }
    // Remove trailing null — Go expects null-separated, not null-terminated
    if result.last == 0 {
        result.removeLast()
    }
    return result
}

private func dataFromHex(_ hex: String) -> Data? {
    var data = Data()
    var temp = ""
    for c in hex {
        temp.append(c)
        if temp.count == 2 {
            guard let byte = UInt8(temp, radix: 16) else { return nil }
            data.append(byte)
            temp = ""
        }
    }
    return temp.isEmpty ? data : nil
}

private func checkDklsError(_ err: lib_error, _ context: String) throws {
    guard err == LIB_OK else {
        throw NSError(
            domain: "ExpoMpcNative.dkls",
            code: Int(err.rawValue),
            userInfo: [NSLocalizedDescriptionKey: "\(context) failed with error code \(err.rawValue)"]
        )
    }
}

private func checkSchnorrError(_ err: schnorr_lib_error, _ context: String) throws {
    guard err.rawValue == 0 else { // LIB_OK = 0
        throw NSError(
            domain: "ExpoMpcNative.schnorr",
            code: Int(err.rawValue),
            userInfo: [NSLocalizedDescriptionKey: "\(context) failed with error code \(err.rawValue)"]
        )
    }
}

// MARK: - Module

public class ExpoMpcNativeModule: Module {
    public func definition() -> ModuleDefinition {
        Name("ExpoMpcNative")

        // =====================================================================
        // DKLS — Keygen
        // =====================================================================

        Function("dklsKeygenSetup") { (threshold: Int, keyIdB64: String?, ids: [String]) -> String in
            var setupBuf = tss_buffer(ptr: nil, len: 0)
            var idsBytes = encodeIds(ids)

            let err: lib_error
            if let keyIdB64 = keyIdB64, let keyIdData = Data(base64Encoded: keyIdB64) {
                var keyIdBytes = Array(keyIdData)
                err = idsBytes.withUnsafeMutableBufferPointer { idsBp in
                    var idsSlice = go_slice(ptr: idsBp.baseAddress, len: UInt(idsBp.count), cap: UInt(idsBp.count))
                    return keyIdBytes.withUnsafeMutableBufferPointer { keyBp in
                        var keyIdSlice = go_slice(ptr: keyBp.baseAddress, len: UInt(keyBp.count), cap: UInt(keyBp.count))
                        return dkls_keygen_setupmsg_new(UInt32(threshold), &keyIdSlice, &idsSlice, &setupBuf)
                    }
                }
            } else {
                // Pass nil for keyId — the C function expects a null pointer when no key ID
                err = idsBytes.withUnsafeMutableBufferPointer { idsBp in
                    var idsSlice = go_slice(ptr: idsBp.baseAddress, len: UInt(idsBp.count), cap: UInt(idsBp.count))
                    return dkls_keygen_setupmsg_new(UInt32(threshold), nil, &idsSlice, &setupBuf)
                }
            }
            try checkDklsError(err, "dkls_keygen_setupmsg_new")

            let data = tssBufferToData(setupBuf)
            tss_buffer_free(&setupBuf)
            return data.base64EncodedString()
        }

        AsyncFunction("createKeygenSession") { (setupB64: String, localPartyId: String) -> Int in
            guard let setupData = Data(base64Encoded: setupB64) else {
                throw NSError(domain: "ExpoMpcNative", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid base64 setup"])
            }
            var setupBytes = Array(setupData)
            var idBytes = Array(localPartyId.utf8)
            var handle = Handle(_0: 0)

            let err = setupBytes.withUnsafeMutableBufferPointer { setupBp in
                var setupSlice = go_slice(ptr: setupBp.baseAddress, len: UInt(setupBp.count), cap: UInt(setupBp.count))
                return idBytes.withUnsafeMutableBufferPointer { idBp in
                    var idSlice = go_slice(ptr: idBp.baseAddress, len: UInt(idBp.count), cap: UInt(idBp.count))
                    return dkls_keygen_session_from_setup(&setupSlice, &idSlice, &handle)
                }
            }
            try checkDklsError(err, "dkls_keygen_session_from_setup")
            return Int(handle._0)
        }

        Function("createKeygenRefreshSession") { (setupB64: String, localPartyId: String, keyshareHandle: Int) -> Int in
            guard let setupData = Data(base64Encoded: setupB64) else {
                throw NSError(domain: "ExpoMpcNative", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid base64 setup"])
            }
            var setupBytes = Array(setupData)
            let _pinSetup = PinnedSlice(setupBytes); var setupSlice = _pinSetup.slice
            var idBytes = Array(localPartyId.utf8)
            let _pinId = PinnedSlice(idBytes); var idSlice = _pinId.slice
            var handle = Handle(_0: 0)
            let oldKs = Handle(_0: Int32(keyshareHandle))

            let err = dkls_key_refresh_session_from_setup(&setupSlice, &idSlice, oldKs, &handle)
            try checkDklsError(err, "dkls_key_refresh_session_from_setup")
            return Int(handle._0)
        }

        Function("createKeygenMigrationSession") { (setupB64: String, localPartyId: String, publicKeyB64: String, rootChainCodeB64: String, secretCoefficientB64: String) -> Int in
            guard let setupData = Data(base64Encoded: setupB64),
                  let pkData = Data(base64Encoded: publicKeyB64),
                  let chainCodeData = Data(base64Encoded: rootChainCodeB64),
                  let secretData = Data(base64Encoded: secretCoefficientB64) else {
                throw NSError(domain: "ExpoMpcNative", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid base64 input"])
            }
            var setupBytes = Array(setupData)
            let _pinSetup = PinnedSlice(setupBytes); var setupSlice = _pinSetup.slice
            var idBytes = Array(localPartyId.utf8)
            let _pinId = PinnedSlice(idBytes); var idSlice = _pinId.slice
            var pkBytes = Array(pkData)
            let _pinPk = PinnedSlice(pkBytes); var pkSlice = _pinPk.slice
            var ccBytes = Array(chainCodeData)
            let _pinCc = PinnedSlice(ccBytes); var ccSlice = _pinCc.slice
            var secBytes = Array(secretData)
            let _pinSec = PinnedSlice(secBytes); var secSlice = _pinSec.slice
            var handle = Handle(_0: 0)

            let err = dkls_key_migration_session_from_setup(&setupSlice, &idSlice, &pkSlice, &ccSlice, &secSlice, &handle)
            try checkDklsError(err, "dkls_key_migration_session_from_setup")
            return Int(handle._0)
        }

        // =====================================================================
        // DKLS — Keygen session I/O
        // =====================================================================

        Function("keygenSessionOutputMessage") { (sessionHandle: Int) -> String? in
            var msgBuf = tss_buffer(ptr: nil, len: 0)
            let session = Handle(_0: Int32(sessionHandle))
            let err = dkls_keygen_session_output_message(session, &msgBuf)
            guard err == LIB_OK, msgBuf.ptr != nil, msgBuf.len > 0 else { return nil }
            let data = tssBufferToData(msgBuf)
            tss_buffer_free(&msgBuf)
            return data.base64EncodedString()
        }

        Function("keygenSessionMessageReceiver") { (sessionHandle: Int, messageB64: String, index: Int) -> String in
            guard let msgData = Data(base64Encoded: messageB64) else {
                throw NSError(domain: "ExpoMpcNative", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid base64 message"])
            }
            var msgBytes = Array(msgData)
            let _pinMsg = PinnedSlice(msgBytes); var msgSlice = _pinMsg.slice
            var receiverBuf = tss_buffer(ptr: nil, len: 0)
            let session = Handle(_0: Int32(sessionHandle))

            let err = dkls_keygen_session_message_receiver(session, &msgSlice, UInt32(index), &receiverBuf)
            try checkDklsError(err, "dkls_keygen_session_message_receiver")
            let data = tssBufferToData(receiverBuf)
            tss_buffer_free(&receiverBuf)
            return String(data: data, encoding: .utf8) ?? ""
        }

        Function("keygenSessionInputMessage") { (sessionHandle: Int, messageB64: String) -> Bool in
            guard let msgData = Data(base64Encoded: messageB64) else {
                throw NSError(domain: "ExpoMpcNative", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid base64 message"])
            }
            var msgBytes = Array(msgData)
            let _pinMsg = PinnedSlice(msgBytes); var msgSlice = _pinMsg.slice
            var finished: Int32 = 0
            let session = Handle(_0: Int32(sessionHandle))

            let err = dkls_keygen_session_input_message(session, &msgSlice, &finished)
            try checkDklsError(err, "dkls_keygen_session_input_message")
            return finished != 0
        }

        AsyncFunction("finishKeygen") { (sessionHandle: Int) -> [String: String] in
            var keyshareHandle = Handle(_0: 0)
            let session = Handle(_0: Int32(sessionHandle))
            let err = dkls_keygen_session_finish(session, &keyshareHandle)
            try checkDklsError(err, "dkls_keygen_session_finish")

            // Extract public key (hex-encoded, matching old expo-dkls API)
            var pkBuf = tss_buffer(ptr: nil, len: 0)
            let pkErr = dkls_keyshare_public_key(keyshareHandle, &pkBuf)
            try checkDklsError(pkErr, "dkls_keyshare_public_key")
            let publicKey = tssBufferToData(pkBuf).map { String(format: "%02x", $0) }.joined()
            tss_buffer_free(&pkBuf)

            // Extract chain code (hex-encoded)
            var ccBuf = tss_buffer(ptr: nil, len: 0)
            let ccErr = dkls_keyshare_chaincode(keyshareHandle, &ccBuf)
            try checkDklsError(ccErr, "dkls_keyshare_chaincode")
            let chainCode = tssBufferToData(ccBuf).map { String(format: "%02x", $0) }.joined()
            tss_buffer_free(&ccBuf)

            // Serialize keyshare to bytes (base64-encoded for storage)
            var ksBuf = tss_buffer(ptr: nil, len: 0)
            let ksErr = dkls_keyshare_to_bytes(keyshareHandle, &ksBuf)
            try checkDklsError(ksErr, "dkls_keyshare_to_bytes")
            let keyshare = tssBufferToData(ksBuf).base64EncodedString()
            tss_buffer_free(&ksBuf)

            // Free the handle
            dkls_keyshare_free(&keyshareHandle)

            return [
                "publicKey": publicKey,
                "chainCode": chainCode,
                "keyshare": keyshare
            ]
        }

        Function("freeKeygenSession") { (sessionHandle: Int) in
            var session = Handle(_0: Int32(sessionHandle))
            dkls_keygen_session_free(&session)
        }

        // =====================================================================
        // DKLS — Signing
        // =====================================================================

        Function("dklsSignSetup") { (keyIdB64: String, chainPath: String, messageHashB64: String?, ids: [String]) -> String in
            guard let keyIdData = Data(base64Encoded: keyIdB64) else {
                throw NSError(domain: "ExpoMpcNative", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid base64 keyId"])
            }
            var keyIdBytes = Array(keyIdData)
            var chainPathBytes = Array(chainPath.utf8)
            var idsBytes = encodeIds(ids)
            var setupBuf = tss_buffer(ptr: nil, len: 0)

            let err: lib_error
            if let hashB64 = messageHashB64, let hashData = Data(base64Encoded: hashB64) {
                var hashBytes = Array(hashData)
                err = keyIdBytes.withUnsafeMutableBufferPointer { keyBp in
                    var keyIdSlice = go_slice(ptr: keyBp.baseAddress, len: UInt(keyBp.count), cap: UInt(keyBp.count))
                    return chainPathBytes.withUnsafeMutableBufferPointer { cpBp in
                        var cpSlice = go_slice(ptr: cpBp.baseAddress, len: UInt(cpBp.count), cap: UInt(cpBp.count))
                        return hashBytes.withUnsafeMutableBufferPointer { hBp in
                            var hashSlice = go_slice(ptr: hBp.baseAddress, len: UInt(hBp.count), cap: UInt(hBp.count))
                            return idsBytes.withUnsafeMutableBufferPointer { idsBp in
                                var idsSlice = go_slice(ptr: idsBp.baseAddress, len: UInt(idsBp.count), cap: UInt(idsBp.count))
                                return dkls_sign_setupmsg_new(&keyIdSlice, &cpSlice, &hashSlice, &idsSlice, &setupBuf)
                            }
                        }
                    }
                }
            } else {
                err = keyIdBytes.withUnsafeMutableBufferPointer { keyBp in
                    var keyIdSlice = go_slice(ptr: keyBp.baseAddress, len: UInt(keyBp.count), cap: UInt(keyBp.count))
                    return chainPathBytes.withUnsafeMutableBufferPointer { cpBp in
                        var cpSlice = go_slice(ptr: cpBp.baseAddress, len: UInt(cpBp.count), cap: UInt(cpBp.count))
                        return idsBytes.withUnsafeMutableBufferPointer { idsBp in
                            var idsSlice = go_slice(ptr: idsBp.baseAddress, len: UInt(idsBp.count), cap: UInt(idsBp.count))
                            return dkls_sign_setupmsg_new(&keyIdSlice, &cpSlice, nil, &idsSlice, &setupBuf)
                        }
                    }
                }
            }
            try checkDklsError(err, "dkls_sign_setupmsg_new")

            let data = tssBufferToData(setupBuf)
            tss_buffer_free(&setupBuf)
            return data.base64EncodedString()
        }

        Function("dklsDecodeMessage") { (setupB64: String) -> String? in
            guard let setupData = Data(base64Encoded: setupB64) else { return nil }
            var setupBytes = Array(setupData)
            let _pinSetup = PinnedSlice(setupBytes); var setupSlice = _pinSetup.slice
            var msgBuf = tss_buffer(ptr: nil, len: 0)
            let err = dkls_decode_message(&setupSlice, &msgBuf)
            guard err == LIB_OK, msgBuf.ptr != nil, msgBuf.len > 0 else { return nil }
            let data = tssBufferToData(msgBuf)
            tss_buffer_free(&msgBuf)
            return data.base64EncodedString()
        }

        Function("dklsDecodeKeyId") { (setupB64: String) -> String? in
            guard let setupData = Data(base64Encoded: setupB64) else { return nil }
            var setupBytes = Array(setupData)
            let _pinSetup = PinnedSlice(setupBytes); var setupSlice = _pinSetup.slice
            var keyIdBuf = tss_buffer(ptr: nil, len: 0)
            let err = dkls_decode_key_id(&setupSlice, &keyIdBuf)
            guard err == LIB_OK, keyIdBuf.ptr != nil, keyIdBuf.len > 0 else { return nil }
            let data = tssBufferToData(keyIdBuf)
            tss_buffer_free(&keyIdBuf)
            return data.base64EncodedString()
        }

        Function("createSignSession") { (setupB64: String, localPartyId: String, keyshareHandle: Int) -> Int in
            guard let setupData = Data(base64Encoded: setupB64) else {
                throw NSError(domain: "ExpoMpcNative", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid base64 setup"])
            }
            var setupBytes = Array(setupData)
            let _pinSetup = PinnedSlice(setupBytes); var setupSlice = _pinSetup.slice
            var idBytes = Array(localPartyId.utf8)
            let _pinId = PinnedSlice(idBytes); var idSlice = _pinId.slice
            let ks = Handle(_0: Int32(keyshareHandle))
            var handle = Handle(_0: 0)

            let err = dkls_sign_session_from_setup(&setupSlice, &idSlice, ks, &handle)
            try checkDklsError(err, "dkls_sign_session_from_setup")
            return Int(handle._0)
        }

        Function("signSessionOutputMessage") { (sessionHandle: Int) -> String? in
            var msgBuf = tss_buffer(ptr: nil, len: 0)
            let session = Handle(_0: Int32(sessionHandle))
            let err = dkls_sign_session_output_message(session, &msgBuf)
            guard err == LIB_OK, msgBuf.ptr != nil, msgBuf.len > 0 else { return nil }
            let data = tssBufferToData(msgBuf)
            tss_buffer_free(&msgBuf)
            return data.base64EncodedString()
        }

        Function("signSessionMessageReceiver") { (sessionHandle: Int, messageB64: String, index: Int) -> String in
            guard let msgData = Data(base64Encoded: messageB64) else {
                throw NSError(domain: "ExpoMpcNative", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid base64 message"])
            }
            var msgBytes = Array(msgData)
            let _pinMsg = PinnedSlice(msgBytes); var msgSlice = _pinMsg.slice
            var receiverBuf = tss_buffer(ptr: nil, len: 0)
            let session = Handle(_0: Int32(sessionHandle))

            let err = dkls_sign_session_message_receiver(session, &msgSlice, UInt32(index), &receiverBuf)
            try checkDklsError(err, "dkls_sign_session_message_receiver")
            let data = tssBufferToData(receiverBuf)
            tss_buffer_free(&receiverBuf)
            return String(data: data, encoding: .utf8) ?? ""
        }

        Function("signSessionInputMessage") { (sessionHandle: Int, messageB64: String) -> Bool in
            guard let msgData = Data(base64Encoded: messageB64) else {
                throw NSError(domain: "ExpoMpcNative", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid base64 message"])
            }
            var msgBytes = Array(msgData)
            let _pinMsg = PinnedSlice(msgBytes); var msgSlice = _pinMsg.slice
            var finished: UInt32 = 0
            let session = Handle(_0: Int32(sessionHandle))

            let err = dkls_sign_session_input_message(session, &msgSlice, &finished)
            try checkDklsError(err, "dkls_sign_session_input_message")
            return finished != 0
        }

        Function("finishSign") { (sessionHandle: Int) -> String in
            var outputBuf = tss_buffer(ptr: nil, len: 0)
            let session = Handle(_0: Int32(sessionHandle))
            let err = dkls_sign_session_finish(session, &outputBuf)
            try checkDklsError(err, "dkls_sign_session_finish")
            let data = tssBufferToData(outputBuf)
            tss_buffer_free(&outputBuf)
            return data.base64EncodedString()
        }

        Function("freeSignSession") { (sessionHandle: Int) in
            var session = Handle(_0: Int32(sessionHandle))
            dkls_sign_session_free(&session)
        }

        // =====================================================================
        // DKLS — Keyshare
        // =====================================================================

        Function("dklsKeyshareFromBytes") { (b64: String) -> Int in
            guard let data = Data(base64Encoded: b64) else {
                throw NSError(domain: "ExpoMpcNative", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid base64 keyshare"])
            }
            var bytes = Array(data)
            let _pinBytes = PinnedSlice(bytes); var slice = _pinBytes.slice
            var handle = Handle(_0: 0)
            let err = dkls_keyshare_from_bytes(&slice, &handle)
            try checkDklsError(err, "dkls_keyshare_from_bytes")
            return Int(handle._0)
        }

        Function("dklsKeyshareToBytes") { (handle: Int) -> String in
            var buf = tss_buffer(ptr: nil, len: 0)
            let ks = Handle(_0: Int32(handle))
            let err = dkls_keyshare_to_bytes(ks, &buf)
            try checkDklsError(err, "dkls_keyshare_to_bytes")
            let data = tssBufferToData(buf)
            tss_buffer_free(&buf)
            return data.base64EncodedString()
        }

        Function("dklsKeysharePublicKey") { (handle: Int) -> String in
            var buf = tss_buffer(ptr: nil, len: 0)
            let ks = Handle(_0: Int32(handle))
            let err = dkls_keyshare_public_key(ks, &buf)
            try checkDklsError(err, "dkls_keyshare_public_key")
            let data = tssBufferToData(buf)
            tss_buffer_free(&buf)
            return data.base64EncodedString()
        }

        Function("dklsKeyshareKeyId") { (handle: Int) -> String in
            var buf = tss_buffer(ptr: nil, len: 0)
            let ks = Handle(_0: Int32(handle))
            let err = dkls_keyshare_key_id(ks, &buf)
            try checkDklsError(err, "dkls_keyshare_key_id")
            let data = tssBufferToData(buf)
            tss_buffer_free(&buf)
            return data.base64EncodedString()
        }

        Function("dklsKeyshareChainCode") { (handle: Int) -> String in
            var buf = tss_buffer(ptr: nil, len: 0)
            let ks = Handle(_0: Int32(handle))
            let err = dkls_keyshare_chaincode(ks, &buf)
            try checkDklsError(err, "dkls_keyshare_chaincode")
            let data = tssBufferToData(buf)
            tss_buffer_free(&buf)
            return data.base64EncodedString()
        }

        Function("freeKeyshare") { (handle: Int) in
            var ks = Handle(_0: Int32(handle))
            dkls_keyshare_free(&ks)
        }

        // =====================================================================
        // DKLS — QC (Reshare)
        // =====================================================================

        Function("dklsQcSetup") { (keyshareHandle: Int, ids: [String], oldPartiesB64: String, newThreshold: Int, newPartiesB64: String) -> String in
            guard let oldData = Data(base64Encoded: oldPartiesB64),
                  let newData = Data(base64Encoded: newPartiesB64) else {
                throw NSError(domain: "ExpoMpcNative", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid base64 parties"])
            }
            let ks = Handle(_0: Int32(keyshareHandle))
            let idsBytes = encodeIds(ids)
            let _pinIds = PinnedSlice(idsBytes); var idsSlice = _pinIds.slice
            var oldBytes = Array(oldData)
            let _pinOld = PinnedSlice(oldBytes); var oldSlice = _pinOld.slice
            var newBytes = Array(newData)
            let _pinNew = PinnedSlice(newBytes); var newSlice = _pinNew.slice
            var setupBuf = tss_buffer(ptr: nil, len: 0)

            let err = dkls_qc_setupmsg_new(ks, &idsSlice, &oldSlice, UInt32(newThreshold), &newSlice, &setupBuf)
            try checkDklsError(err, "dkls_qc_setupmsg_new")
            let data = tssBufferToData(setupBuf)
            tss_buffer_free(&setupBuf)
            return data.base64EncodedString()
        }

        Function("createQcSession") { (setupB64: String, localPartyId: String, keyshareHandle: Int?) -> Int in
            guard let setupData = Data(base64Encoded: setupB64) else {
                throw NSError(domain: "ExpoMpcNative", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid base64 setup"])
            }
            var setupBytes = Array(setupData)
            let _pinSetup = PinnedSlice(setupBytes); var setupSlice = _pinSetup.slice
            var idBytes = Array(localPartyId.utf8)
            let _pinId = PinnedSlice(idBytes); var idSlice = _pinId.slice
            let ks = Handle(_0: Int32(keyshareHandle ?? -1))
            var handle = Handle(_0: 0)

            let err = dkls_qc_session_from_setup(&setupSlice, &idSlice, ks, &handle)
            try checkDklsError(err, "dkls_qc_session_from_setup")
            return Int(handle._0)
        }

        Function("qcSessionOutputMessage") { (sessionHandle: Int) -> String? in
            var msgBuf = tss_buffer(ptr: nil, len: 0)
            let session = Handle(_0: Int32(sessionHandle))
            let err = dkls_qc_session_output_message(session, &msgBuf)
            guard err == LIB_OK, msgBuf.ptr != nil, msgBuf.len > 0 else { return nil }
            let data = tssBufferToData(msgBuf)
            tss_buffer_free(&msgBuf)
            return data.base64EncodedString()
        }

        Function("qcSessionMessageReceiver") { (sessionHandle: Int, messageB64: String, index: Int) -> String in
            guard let msgData = Data(base64Encoded: messageB64) else {
                throw NSError(domain: "ExpoMpcNative", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid base64 message"])
            }
            var msgBytes = Array(msgData)
            let _pinMsg = PinnedSlice(msgBytes); var msgSlice = _pinMsg.slice
            var receiverBuf = tss_buffer(ptr: nil, len: 0)
            let session = Handle(_0: Int32(sessionHandle))

            let err = dkls_qc_session_message_receiver(session, &msgSlice, UInt32(index), &receiverBuf)
            try checkDklsError(err, "dkls_qc_session_message_receiver")
            let data = tssBufferToData(receiverBuf)
            tss_buffer_free(&receiverBuf)
            return String(data: data, encoding: .utf8) ?? ""
        }

        Function("qcSessionInputMessage") { (sessionHandle: Int, messageB64: String) -> Bool in
            guard let msgData = Data(base64Encoded: messageB64) else {
                throw NSError(domain: "ExpoMpcNative", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid base64 message"])
            }
            var msgBytes = Array(msgData)
            let _pinMsg = PinnedSlice(msgBytes); var msgSlice = _pinMsg.slice
            var finished: Int32 = 0
            let session = Handle(_0: Int32(sessionHandle))

            let err = dkls_qc_session_input_message(session, &msgSlice, &finished)
            try checkDklsError(err, "dkls_qc_session_input_message")
            return finished != 0
        }

        Function("finishQc") { (sessionHandle: Int) -> Int in
            var keyshareHandle = Handle(_0: 0)
            let session = Handle(_0: Int32(sessionHandle))
            let err = dkls_qc_session_finish(session, &keyshareHandle)
            if err != LIB_OK {
                NSLog("ExpoMpcNative: finishQc returned error %d (old party / no keyshare)", err.rawValue)
                return -1
            }
            return Int(keyshareHandle._0)
        }

        Function("freeQcSession") { (sessionHandle: Int) in
            var session = Handle(_0: Int32(sessionHandle))
            dkls_qc_session_free(&session)
        }

        // =====================================================================
        // DKLS — Key Import
        // =====================================================================

        Function("createDklsKeyImportInitiator") { (privateKeyHex: String, rootChainCodeHex: String?, threshold: Int, ids: [String]) -> [String: Any] in
            guard let pkData = dataFromHex(privateKeyHex) else {
                throw NSError(domain: "ExpoMpcNative", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid hex private key"])
            }
            var pkBytes = Array(pkData)
            var idsBytes = encodeIds(ids)
            var setupBuf = tss_buffer(ptr: nil, len: 0)
            var handle = Handle(_0: 0)

            let err: lib_error
            if let ccHex = rootChainCodeHex, let ccData = dataFromHex(ccHex) {
                var ccBytes = Array(ccData)
                err = pkBytes.withUnsafeMutableBufferPointer { pkBp in
                    var pkSlice = go_slice(ptr: pkBp.baseAddress, len: UInt(pkBp.count), cap: UInt(pkBp.count))
                    return ccBytes.withUnsafeMutableBufferPointer { ccBp in
                        var ccSlice = go_slice(ptr: ccBp.baseAddress, len: UInt(ccBp.count), cap: UInt(ccBp.count))
                        return idsBytes.withUnsafeMutableBufferPointer { idsBp in
                            var idsSlice = go_slice(ptr: idsBp.baseAddress, len: UInt(idsBp.count), cap: UInt(idsBp.count))
                            return dkls_key_import_initiator_new(&pkSlice, &ccSlice, UInt8(threshold), &idsSlice, &setupBuf, &handle)
                        }
                    }
                }
            } else {
                err = pkBytes.withUnsafeMutableBufferPointer { pkBp in
                    var pkSlice = go_slice(ptr: pkBp.baseAddress, len: UInt(pkBp.count), cap: UInt(pkBp.count))
                    return idsBytes.withUnsafeMutableBufferPointer { idsBp in
                        var idsSlice = go_slice(ptr: idsBp.baseAddress, len: UInt(idsBp.count), cap: UInt(idsBp.count))
                        return dkls_key_import_initiator_new(&pkSlice, nil, UInt8(threshold), &idsSlice, &setupBuf, &handle)
                    }
                }
            }
            try checkDklsError(err, "dkls_key_import_initiator_new")

            let setupData = tssBufferToData(setupBuf)
            tss_buffer_free(&setupBuf)
            return [
                "sessionHandle": Int(handle._0),
                "setupMessage": setupData.base64EncodedString()
            ]
        }

        AsyncFunction("createDklsKeyImportSession") { (setupB64: String, localPartyId: String) -> Int in
            guard let setupData = Data(base64Encoded: setupB64) else {
                throw NSError(domain: "ExpoMpcNative", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid base64 setup"])
            }
            var setupBytes = Array(setupData)
            let _pinSetup = PinnedSlice(setupBytes); var setupSlice = _pinSetup.slice
            var idBytes = Array(localPartyId.utf8)
            let _pinId = PinnedSlice(idBytes); var idSlice = _pinId.slice
            var handle = Handle(_0: 0)

            let err = dkls_key_importer_new(&setupSlice, &idSlice, &handle)
            try checkDklsError(err, "dkls_key_importer_new")
            return Int(handle._0)
        }

        // =====================================================================
        // Schnorr — Keygen
        // =====================================================================

        Function("schnorrKeygenSetup") { (threshold: Int, keyIdB64: String?, ids: [String]) -> String in
            var setupBuf = tss_buffer(ptr: nil, len: 0)
            var idsBytes = encodeIds(ids)

            let err: schnorr_lib_error
            if let keyIdB64 = keyIdB64, let keyIdData = Data(base64Encoded: keyIdB64) {
                var keyIdBytes = Array(keyIdData)
                err = idsBytes.withUnsafeMutableBufferPointer { idsBp in
                    var idsSlice = go_slice(ptr: idsBp.baseAddress, len: UInt(idsBp.count), cap: UInt(idsBp.count))
                    return keyIdBytes.withUnsafeMutableBufferPointer { keyBp in
                        var keyIdSlice = go_slice(ptr: keyBp.baseAddress, len: UInt(keyBp.count), cap: UInt(keyBp.count))
                        return schnorr_keygen_setupmsg_new(UInt32(threshold), &keyIdSlice, &idsSlice, &setupBuf)
                    }
                }
            } else {
                err = idsBytes.withUnsafeMutableBufferPointer { idsBp in
                    var idsSlice = go_slice(ptr: idsBp.baseAddress, len: UInt(idsBp.count), cap: UInt(idsBp.count))
                    return schnorr_keygen_setupmsg_new(UInt32(threshold), nil, &idsSlice, &setupBuf)
                }
            }
            try checkSchnorrError(err, "schnorr_keygen_setupmsg_new")

            let data = tssBufferToData(setupBuf)
            tss_buffer_free(&setupBuf)
            return data.base64EncodedString()
        }

        AsyncFunction("createSchnorrKeygenSession") { (setupB64: String, localPartyId: String) -> Int in
            guard let setupData = Data(base64Encoded: setupB64) else {
                throw NSError(domain: "ExpoMpcNative", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid base64 setup"])
            }
            var setupBytes = Array(setupData)
            var idBytes = Array(localPartyId.utf8)
            var handle = Handle(_0: 0)

            let err = setupBytes.withUnsafeMutableBufferPointer { setupBp in
                var setupSlice = go_slice(ptr: setupBp.baseAddress, len: UInt(setupBp.count), cap: UInt(setupBp.count))
                return idBytes.withUnsafeMutableBufferPointer { idBp in
                    var idSlice = go_slice(ptr: idBp.baseAddress, len: UInt(idBp.count), cap: UInt(idBp.count))
                    return schnorr_keygen_session_from_setup(&setupSlice, &idSlice, &handle)
                }
            }
            try checkSchnorrError(err, "schnorr_keygen_session_from_setup")
            return Int(handle._0)
        }

        // =====================================================================
        // Schnorr — Keygen session I/O
        // =====================================================================

        Function("schnorrKeygenSessionOutputMessage") { (sessionHandle: Int) -> String? in
            var msgBuf = tss_buffer(ptr: nil, len: 0)
            let session = Handle(_0: Int32(sessionHandle))
            let err = schnorr_keygen_session_output_message(session, &msgBuf)
            guard err.rawValue == 0, msgBuf.ptr != nil, msgBuf.len > 0 else { return nil }
            let data = tssBufferToData(msgBuf)
            tss_buffer_free(&msgBuf)
            return data.base64EncodedString()
        }

        Function("schnorrKeygenSessionMessageReceiver") { (sessionHandle: Int, messageB64: String, index: Int) -> String in
            guard let msgData = Data(base64Encoded: messageB64) else {
                throw NSError(domain: "ExpoMpcNative", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid base64 message"])
            }
            var msgBytes = Array(msgData)
            let _pinMsg = PinnedSlice(msgBytes); var msgSlice = _pinMsg.slice
            var receiverBuf = tss_buffer(ptr: nil, len: 0)
            let session = Handle(_0: Int32(sessionHandle))

            let err = schnorr_keygen_session_message_receiver(session, &msgSlice, UInt32(index), &receiverBuf)
            try checkSchnorrError(err, "schnorr_keygen_session_message_receiver")
            let data = tssBufferToData(receiverBuf)
            tss_buffer_free(&receiverBuf)
            return String(data: data, encoding: .utf8) ?? ""
        }

        Function("schnorrKeygenSessionInputMessage") { (sessionHandle: Int, messageB64: String) -> Bool in
            guard let msgData = Data(base64Encoded: messageB64) else {
                throw NSError(domain: "ExpoMpcNative", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid base64 message"])
            }
            var msgBytes = Array(msgData)
            let _pinMsg = PinnedSlice(msgBytes); var msgSlice = _pinMsg.slice
            var finished: Int32 = 0
            let session = Handle(_0: Int32(sessionHandle))

            let err = schnorr_keygen_session_input_message(session, &msgSlice, &finished)
            try checkSchnorrError(err, "schnorr_keygen_session_input_message")
            return finished != 0
        }

        AsyncFunction("finishSchnorrKeygen") { (sessionHandle: Int) -> [String: String] in
            var keyshareHandle = Handle(_0: 0)
            let session = Handle(_0: Int32(sessionHandle))
            let err = schnorr_keygen_session_finish(session, &keyshareHandle)
            try checkSchnorrError(err, "schnorr_keygen_session_finish")

            // Extract public key (hex-encoded, matching old expo-dkls API)
            var pkBuf = tss_buffer(ptr: nil, len: 0)
            let pkErr = schnorr_keyshare_public_key(keyshareHandle, &pkBuf)
            try checkSchnorrError(pkErr, "schnorr_keyshare_public_key")
            let publicKey = tssBufferToData(pkBuf).map { String(format: "%02x", $0) }.joined()
            tss_buffer_free(&pkBuf)

            // Extract chain code (hex-encoded)
            var ccBuf = tss_buffer(ptr: nil, len: 0)
            let ccErr = schnorr_keyshare_chaincode(keyshareHandle, &ccBuf)
            try checkSchnorrError(ccErr, "schnorr_keyshare_chaincode")
            let chainCode = tssBufferToData(ccBuf).map { String(format: "%02x", $0) }.joined()
            tss_buffer_free(&ccBuf)

            // Serialize keyshare to bytes (base64-encoded for storage)
            var ksBuf = tss_buffer(ptr: nil, len: 0)
            let ksErr = schnorr_keyshare_to_bytes(keyshareHandle, &ksBuf)
            try checkSchnorrError(ksErr, "schnorr_keyshare_to_bytes")
            let keyshare = tssBufferToData(ksBuf).base64EncodedString()
            tss_buffer_free(&ksBuf)

            // Free the handle after extracting all data
            schnorr_keyshare_free(&keyshareHandle)

            return [
                "publicKey": publicKey,
                "chainCode": chainCode,
                "keyshare": keyshare
            ]
        }

        Function("freeSchnorrKeygenSession") { (sessionHandle: Int) in
            var session = Handle(_0: Int32(sessionHandle))
            schnorr_keygen_session_free(&session)
        }

        // =====================================================================
        // Schnorr — Signing
        // =====================================================================

        Function("schnorrSignSetup") { (keyIdB64: String, chainPath: String, messageHashB64: String, ids: [String]) -> String in
            guard let keyIdData = Data(base64Encoded: keyIdB64),
                  let hashData = Data(base64Encoded: messageHashB64) else {
                throw NSError(domain: "ExpoMpcNative", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid base64 input"])
            }
            var keyIdBytes = Array(keyIdData)
            let _pinKeyId = PinnedSlice(keyIdBytes); var keyIdSlice = _pinKeyId.slice
            var chainPathBytes = Array(chainPath.utf8)
            let _pinChainPath = PinnedSlice(chainPathBytes); var chainPathSlice = _pinChainPath.slice
            var hashBytes = Array(hashData)
            let _pinHash = PinnedSlice(hashBytes); var hashSlice = _pinHash.slice
            let idsBytes = encodeIds(ids)
            let _pinIds = PinnedSlice(idsBytes); var idsSlice = _pinIds.slice
            var setupBuf = tss_buffer(ptr: nil, len: 0)

            let err = schnorr_sign_setupmsg_new(&keyIdSlice, &chainPathSlice, &hashSlice, &idsSlice, &setupBuf)
            try checkSchnorrError(err, "schnorr_sign_setupmsg_new")
            let data = tssBufferToData(setupBuf)
            tss_buffer_free(&setupBuf)
            return data.base64EncodedString()
        }

        Function("schnorrDecodeMessage") { (setupB64: String) -> String? in
            guard let setupData = Data(base64Encoded: setupB64) else { return nil }
            var setupBytes = Array(setupData)
            let _pinSetup = PinnedSlice(setupBytes); var setupSlice = _pinSetup.slice
            var msgBuf = tss_buffer(ptr: nil, len: 0)
            let err = schnorr_decode_message(&setupSlice, &msgBuf)
            guard err.rawValue == 0, msgBuf.ptr != nil, msgBuf.len > 0 else { return nil }
            let data = tssBufferToData(msgBuf)
            tss_buffer_free(&msgBuf)
            return data.base64EncodedString()
        }

        Function("schnorrDecodeKeyId") { (setupB64: String) -> String? in
            guard let setupData = Data(base64Encoded: setupB64) else { return nil }
            var setupBytes = Array(setupData)
            let _pinSetup = PinnedSlice(setupBytes); var setupSlice = _pinSetup.slice
            var keyIdBuf = tss_buffer(ptr: nil, len: 0)
            let err = schnorr_decode_key_id(&setupSlice, &keyIdBuf)
            guard err.rawValue == 0, keyIdBuf.ptr != nil, keyIdBuf.len > 0 else { return nil }
            let data = tssBufferToData(keyIdBuf)
            tss_buffer_free(&keyIdBuf)
            return data.base64EncodedString()
        }

        Function("createSchnorrSignSession") { (setupB64: String, localPartyId: String, keyshareHandle: Int) -> Int in
            guard let setupData = Data(base64Encoded: setupB64) else {
                throw NSError(domain: "ExpoMpcNative", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid base64 setup"])
            }
            var setupBytes = Array(setupData)
            let _pinSetup = PinnedSlice(setupBytes); var setupSlice = _pinSetup.slice
            var idBytes = Array(localPartyId.utf8)
            let _pinId = PinnedSlice(idBytes); var idSlice = _pinId.slice
            let ks = Handle(_0: Int32(keyshareHandle))
            var handle = Handle(_0: 0)

            let err = schnorr_sign_session_from_setup(&setupSlice, &idSlice, ks, &handle)
            try checkSchnorrError(err, "schnorr_sign_session_from_setup")
            return Int(handle._0)
        }

        Function("schnorrSignSessionOutputMessage") { (sessionHandle: Int) -> String? in
            var msgBuf = tss_buffer(ptr: nil, len: 0)
            let session = Handle(_0: Int32(sessionHandle))
            let err = schnorr_sign_session_output_message(session, &msgBuf)
            guard err.rawValue == 0, msgBuf.ptr != nil, msgBuf.len > 0 else { return nil }
            let data = tssBufferToData(msgBuf)
            tss_buffer_free(&msgBuf)
            return data.base64EncodedString()
        }

        Function("schnorrSignSessionMessageReceiver") { (sessionHandle: Int, messageB64: String, index: Int) -> String in
            guard let msgData = Data(base64Encoded: messageB64) else {
                throw NSError(domain: "ExpoMpcNative", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid base64 message"])
            }
            var msgBytes = Array(msgData)
            let _pinMsg = PinnedSlice(msgBytes); var msgSlice = _pinMsg.slice
            var receiverBuf = tss_buffer(ptr: nil, len: 0)
            let session = Handle(_0: Int32(sessionHandle))

            let err = schnorr_sign_session_message_receiver(session, &msgSlice, UInt32(index), &receiverBuf)
            try checkSchnorrError(err, "schnorr_sign_session_message_receiver")
            let data = tssBufferToData(receiverBuf)
            tss_buffer_free(&receiverBuf)
            return String(data: data, encoding: .utf8) ?? ""
        }

        Function("schnorrSignSessionInputMessage") { (sessionHandle: Int, messageB64: String) -> Bool in
            guard let msgData = Data(base64Encoded: messageB64) else {
                throw NSError(domain: "ExpoMpcNative", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid base64 message"])
            }
            var msgBytes = Array(msgData)
            let _pinMsg = PinnedSlice(msgBytes); var msgSlice = _pinMsg.slice
            var finished: UInt32 = 0
            let session = Handle(_0: Int32(sessionHandle))

            let err = schnorr_sign_session_input_message(session, &msgSlice, &finished)
            try checkSchnorrError(err, "schnorr_sign_session_input_message")
            return finished != 0
        }

        Function("finishSchnorrSign") { (sessionHandle: Int) -> String in
            var outputBuf = tss_buffer(ptr: nil, len: 0)
            let session = Handle(_0: Int32(sessionHandle))
            let err = schnorr_sign_session_finish(session, &outputBuf)
            try checkSchnorrError(err, "schnorr_sign_session_finish")
            let data = tssBufferToData(outputBuf)
            tss_buffer_free(&outputBuf)
            return data.base64EncodedString()
        }

        Function("freeSchnorrSignSession") { (sessionHandle: Int) in
            var session = Handle(_0: Int32(sessionHandle))
            schnorr_sign_session_free(&session)
        }

        // =====================================================================
        // Schnorr — Keyshare
        // =====================================================================

        Function("schnorrKeyshareFromBytes") { (b64: String) -> Int in
            guard let data = Data(base64Encoded: b64) else {
                throw NSError(domain: "ExpoMpcNative", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid base64 keyshare"])
            }
            var bytes = Array(data)
            let _pinBytes = PinnedSlice(bytes); var slice = _pinBytes.slice
            var handle = Handle(_0: 0)
            let err = schnorr_keyshare_from_bytes(&slice, &handle)
            try checkSchnorrError(err, "schnorr_keyshare_from_bytes")
            return Int(handle._0)
        }

        Function("schnorrKeyshareToBytes") { (handle: Int) -> String in
            var buf = tss_buffer(ptr: nil, len: 0)
            let ks = Handle(_0: Int32(handle))
            let err = schnorr_keyshare_to_bytes(ks, &buf)
            try checkSchnorrError(err, "schnorr_keyshare_to_bytes")
            let data = tssBufferToData(buf)
            tss_buffer_free(&buf)
            return data.base64EncodedString()
        }

        Function("schnorrKeysharePublicKey") { (handle: Int) -> String in
            var buf = tss_buffer(ptr: nil, len: 0)
            let ks = Handle(_0: Int32(handle))
            let err = schnorr_keyshare_public_key(ks, &buf)
            try checkSchnorrError(err, "schnorr_keyshare_public_key")
            let data = tssBufferToData(buf)
            tss_buffer_free(&buf)
            return data.base64EncodedString()
        }

        Function("schnorrKeyshareKeyId") { (handle: Int) -> String in
            var buf = tss_buffer(ptr: nil, len: 0)
            let ks = Handle(_0: Int32(handle))
            let err = schnorr_keyshare_key_id(ks, &buf)
            try checkSchnorrError(err, "schnorr_keyshare_key_id")
            let data = tssBufferToData(buf)
            tss_buffer_free(&buf)
            return data.base64EncodedString()
        }

        Function("schnorrKeyshareChainCode") { (handle: Int) -> String in
            var buf = tss_buffer(ptr: nil, len: 0)
            let ks = Handle(_0: Int32(handle))
            let err = schnorr_keyshare_chaincode(ks, &buf)
            try checkSchnorrError(err, "schnorr_keyshare_chaincode")
            let data = tssBufferToData(buf)
            tss_buffer_free(&buf)
            return data.base64EncodedString()
        }

        Function("freeSchnorrKeyshare") { (handle: Int) in
            // Schnorr keyshares use the same free as DKLS in the C API
            var ks = Handle(_0: Int32(handle))
            dkls_keyshare_free(&ks)
        }

        // =====================================================================
        // Schnorr — QC (Reshare)
        // =====================================================================

        Function("schnorrQcSetup") { (keyshareHandle: Int, ids: [String], oldPartiesB64: String, newThreshold: Int, newPartiesB64: String) -> String in
            guard let oldData = Data(base64Encoded: oldPartiesB64),
                  let newData = Data(base64Encoded: newPartiesB64) else {
                throw NSError(domain: "ExpoMpcNative", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid base64 parties"])
            }
            let ks = Handle(_0: Int32(keyshareHandle))
            let idsBytes = encodeIds(ids)
            let _pinIds = PinnedSlice(idsBytes); var idsSlice = _pinIds.slice
            var oldBytes = Array(oldData)
            let _pinOld = PinnedSlice(oldBytes); var oldSlice = _pinOld.slice
            var newBytes = Array(newData)
            let _pinNew = PinnedSlice(newBytes); var newSlice = _pinNew.slice
            var setupBuf = tss_buffer(ptr: nil, len: 0)

            let err = schnorr_qc_setupmsg_new(ks, &idsSlice, &oldSlice, UInt32(newThreshold), &newSlice, &setupBuf)
            try checkSchnorrError(err, "schnorr_qc_setupmsg_new")
            let data = tssBufferToData(setupBuf)
            tss_buffer_free(&setupBuf)
            return data.base64EncodedString()
        }

        Function("createSchnorrQcSession") { (setupB64: String, localPartyId: String, keyshareHandle: Int?) -> Int in
            guard let setupData = Data(base64Encoded: setupB64) else {
                throw NSError(domain: "ExpoMpcNative", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid base64 setup"])
            }
            var setupBytes = Array(setupData)
            let _pinSetup = PinnedSlice(setupBytes); var setupSlice = _pinSetup.slice
            var idBytes = Array(localPartyId.utf8)
            let _pinId = PinnedSlice(idBytes); var idSlice = _pinId.slice
            let ks = Handle(_0: Int32(keyshareHandle ?? -1))
            var handle = Handle(_0: 0)

            let err = schnorr_qc_session_from_setup(&setupSlice, &idSlice, ks, &handle)
            try checkSchnorrError(err, "schnorr_qc_session_from_setup")
            return Int(handle._0)
        }

        Function("schnorrQcSessionOutputMessage") { (sessionHandle: Int) -> String? in
            var msgBuf = tss_buffer(ptr: nil, len: 0)
            let session = Handle(_0: Int32(sessionHandle))
            let err = schnorr_qc_session_output_message(session, &msgBuf)
            guard err.rawValue == 0, msgBuf.ptr != nil, msgBuf.len > 0 else { return nil }
            let data = tssBufferToData(msgBuf)
            tss_buffer_free(&msgBuf)
            return data.base64EncodedString()
        }

        Function("schnorrQcSessionMessageReceiver") { (sessionHandle: Int, messageB64: String, index: Int) -> String in
            guard let msgData = Data(base64Encoded: messageB64) else {
                throw NSError(domain: "ExpoMpcNative", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid base64 message"])
            }
            var msgBytes = Array(msgData)
            let _pinMsg = PinnedSlice(msgBytes); var msgSlice = _pinMsg.slice
            var receiverBuf = tss_buffer(ptr: nil, len: 0)
            let session = Handle(_0: Int32(sessionHandle))

            let err = schnorr_qc_session_message_receiver(session, &msgSlice, UInt32(index), &receiverBuf)
            try checkSchnorrError(err, "schnorr_qc_session_message_receiver")
            let data = tssBufferToData(receiverBuf)
            tss_buffer_free(&receiverBuf)
            return String(data: data, encoding: .utf8) ?? ""
        }

        Function("schnorrQcSessionInputMessage") { (sessionHandle: Int, messageB64: String) -> Bool in
            guard let msgData = Data(base64Encoded: messageB64) else {
                throw NSError(domain: "ExpoMpcNative", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid base64 message"])
            }
            var msgBytes = Array(msgData)
            let _pinMsg = PinnedSlice(msgBytes); var msgSlice = _pinMsg.slice
            var finished: Int32 = 0
            let session = Handle(_0: Int32(sessionHandle))

            let err = schnorr_qc_session_input_message(session, &msgSlice, &finished)
            try checkSchnorrError(err, "schnorr_qc_session_input_message")
            return finished != 0
        }

        Function("finishSchnorrQc") { (sessionHandle: Int) -> Int in
            var keyshareHandle = Handle(_0: 0)
            let session = Handle(_0: Int32(sessionHandle))
            let err = schnorr_qc_session_finish(session, &keyshareHandle)
            if err.rawValue != 0 {
                NSLog("ExpoMpcNative: finishSchnorrQc returned error %d (old party / no keyshare)", err.rawValue)
                return -1
            }
            return Int(keyshareHandle._0)
        }

        Function("freeSchnorrQcSession") { (sessionHandle: Int) in
            var session = Handle(_0: Int32(sessionHandle))
            schnorr_qc_session_free(&session)
        }

        // =====================================================================
        // Schnorr — Key Import
        // =====================================================================

        Function("createSchnorrKeyImportInitiator") { (privateKeyHex: String, rootChainCodeHex: String?, threshold: Int, ids: [String]) -> [String: Any] in
            guard let pkData = dataFromHex(privateKeyHex) else {
                throw NSError(domain: "ExpoMpcNative", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid hex private key"])
            }
            var pkBytes = Array(pkData)
            var idsBytes = encodeIds(ids)
            var setupBuf = tss_buffer(ptr: nil, len: 0)
            var handle = Handle(_0: 0)

            let err: schnorr_lib_error
            if let ccHex = rootChainCodeHex, let ccData = dataFromHex(ccHex) {
                var ccBytes = Array(ccData)
                err = pkBytes.withUnsafeMutableBufferPointer { pkBp in
                    var pkSlice = go_slice(ptr: pkBp.baseAddress, len: UInt(pkBp.count), cap: UInt(pkBp.count))
                    return ccBytes.withUnsafeMutableBufferPointer { ccBp in
                        var ccSlice = go_slice(ptr: ccBp.baseAddress, len: UInt(ccBp.count), cap: UInt(ccBp.count))
                        return idsBytes.withUnsafeMutableBufferPointer { idsBp in
                            var idsSlice = go_slice(ptr: idsBp.baseAddress, len: UInt(idsBp.count), cap: UInt(idsBp.count))
                            return schnorr_key_import_initiator_new(&pkSlice, &ccSlice, UInt8(threshold), &idsSlice, &setupBuf, &handle)
                        }
                    }
                }
            } else {
                err = pkBytes.withUnsafeMutableBufferPointer { pkBp in
                    var pkSlice = go_slice(ptr: pkBp.baseAddress, len: UInt(pkBp.count), cap: UInt(pkBp.count))
                    return idsBytes.withUnsafeMutableBufferPointer { idsBp in
                        var idsSlice = go_slice(ptr: idsBp.baseAddress, len: UInt(idsBp.count), cap: UInt(idsBp.count))
                        return schnorr_key_import_initiator_new(&pkSlice, nil, UInt8(threshold), &idsSlice, &setupBuf, &handle)
                    }
                }
            }
            try checkSchnorrError(err, "schnorr_key_import_initiator_new")

            let setupData = tssBufferToData(setupBuf)
            tss_buffer_free(&setupBuf)
            return [
                "sessionHandle": Int(handle._0),
                "setupMessage": setupData.base64EncodedString()
            ]
        }

        AsyncFunction("createSchnorrKeyImportSession") { (setupB64: String, localPartyId: String) -> Int in
            guard let setupData = Data(base64Encoded: setupB64) else {
                throw NSError(domain: "ExpoMpcNative", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid base64 setup"])
            }
            var setupBytes = Array(setupData)
            let _pinSetup = PinnedSlice(setupBytes); var setupSlice = _pinSetup.slice
            var idBytes = Array(localPartyId.utf8)
            let _pinId = PinnedSlice(idBytes); var idSlice = _pinId.slice
            var handle = Handle(_0: 0)

            let err = schnorr_key_importer_new(&setupSlice, &idSlice, &handle)
            try checkSchnorrError(err, "schnorr_key_importer_new")
            return Int(handle._0)
        }
    }
}
