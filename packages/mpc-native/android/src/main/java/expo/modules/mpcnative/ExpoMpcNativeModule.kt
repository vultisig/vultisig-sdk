package expo.modules.mpcnative

import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import godkls.Godkls
import goschnorr.Goschnorr

class ExpoMpcNativeModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("ExpoMpcNative")

        // =====================================================================
        // DKLS — Keygen
        // =====================================================================

        Function("dklsKeygenSetup") { threshold: Int, keyIdB64: String?, ids: List<String> ->
            val keyIdBytes = if (keyIdB64 != null) decode(keyIdB64) else null
            val idsBytes = encodeIds(ids)
            val result = Godkls.dklsKeygenSetupmsgNew(
                threshold.toLong(),
                keyIdBytes,
                idsBytes
            )
            encode(result)
        }

        AsyncFunction("createKeygenSession") { setupB64: String, localPartyId: String ->
            val setupBytes = decode(setupB64)
            val idBytes = localPartyId.toByteArray(Charsets.UTF_8)
            val handle = Godkls.dklsKeygenSessionFromSetup(setupBytes, idBytes)
            handle
        }

        Function("createKeygenRefreshSession") { setupB64: String, localPartyId: String, keyshareHandle: Long ->
            val setupBytes = decode(setupB64)
            val idBytes = localPartyId.toByteArray(Charsets.UTF_8)
            Godkls.dklsKeyRefreshSessionFromSetup(setupBytes, idBytes, keyshareHandle)
        }

        Function("createKeygenMigrationSession") { setupB64: String, localPartyId: String, publicKeyB64: String, rootChainCodeB64: String, secretCoefficientB64: String ->
            val setupBytes = decode(setupB64)
            val idBytes = localPartyId.toByteArray(Charsets.UTF_8)
            val pkBytes = decode(publicKeyB64)
            val ccBytes = decode(rootChainCodeB64)
            val secBytes = decode(secretCoefficientB64)
            Godkls.dklsKeyMigrationSessionFromSetup(setupBytes, idBytes, pkBytes, ccBytes, secBytes)
        }

        // =====================================================================
        // DKLS — Keygen session I/O
        // =====================================================================

        Function("keygenSessionOutputMessage") { sessionHandle: Long ->
            try {
                val msg = Godkls.dklsKeygenSessionOutputMessage(sessionHandle)
                if (msg != null && msg.isNotEmpty()) encode(msg) else null
            } catch (e: Exception) {
                android.util.Log.d("ExpoMpcNative", "No message available: ${e.message}")
                null
            }
        }

        Function("keygenSessionMessageReceiver") { sessionHandle: Long, messageB64: String, index: Int ->
            val msgBytes = decode(messageB64)
            val receiver = Godkls.dklsKeygenSessionMessageReceiver(sessionHandle, msgBytes, index.toLong())
            String(receiver, Charsets.UTF_8)
        }

        Function("keygenSessionInputMessage") { sessionHandle: Long, messageB64: String ->
            val msgBytes = decode(messageB64)
            Godkls.dklsKeygenSessionInputMessage(sessionHandle, msgBytes)
        }

        AsyncFunction("finishKeygen") { sessionHandle: Long ->
            val keyshareHandle = Godkls.dklsKeygenSessionFinish(sessionHandle)
            val publicKey = encodeHex(Godkls.dklsKeysharePublicKey(keyshareHandle))
            val chainCode = encodeHex(Godkls.dklsKeyshareChaincode(keyshareHandle))
            val keyshare = encode(Godkls.dklsKeyshareToBytes(keyshareHandle))
            Godkls.dklsKeyshareFree(keyshareHandle)
            mapOf("publicKey" to publicKey, "chainCode" to chainCode, "keyshare" to keyshare)
        }

        Function("freeKeygenSession") { sessionHandle: Long ->
            Godkls.dklsKeygenSessionFree(sessionHandle)
        }

        // =====================================================================
        // DKLS — Signing
        // =====================================================================

        Function("dklsSignSetup") { keyIdB64: String, chainPath: String, messageHashB64: String?, ids: List<String> ->
            val keyIdBytes = decode(keyIdB64)
            val chainPathBytes = chainPath.toByteArray(Charsets.UTF_8)
            val hashBytes = if (messageHashB64 != null) decode(messageHashB64) else null
            val idsBytes = encodeIds(ids)
            val result = Godkls.dklsSignSetupmsgNew(keyIdBytes, chainPathBytes, hashBytes, idsBytes)
            encode(result)
        }

        Function("dklsDecodeMessage") { setupB64: String ->
            try {
                val setupBytes = decode(setupB64)
                val msg = Godkls.dklsDecodeMessage(setupBytes)
                if (msg != null && msg.isNotEmpty()) encode(msg) else null
            } catch (e: Exception) {
                android.util.Log.d("ExpoMpcNative", "No message available: ${e.message}")
                null
            }
        }

        Function("dklsDecodeKeyId") { setupB64: String ->
            try {
                val setupBytes = decode(setupB64)
                val keyId = Godkls.dklsDecodeKeyId(setupBytes)
                if (keyId != null && keyId.isNotEmpty()) encode(keyId) else null
            } catch (e: Exception) {
                android.util.Log.d("ExpoMpcNative", "No message available: ${e.message}")
                null
            }
        }

        Function("createSignSession") { setupB64: String, localPartyId: String, keyshareHandle: Long ->
            val setupBytes = decode(setupB64)
            val idBytes = localPartyId.toByteArray(Charsets.UTF_8)
            Godkls.dklsSignSessionFromSetup(setupBytes, idBytes, keyshareHandle)
        }

        Function("signSessionOutputMessage") { sessionHandle: Long ->
            try {
                val msg = Godkls.dklsSignSessionOutputMessage(sessionHandle)
                if (msg != null && msg.isNotEmpty()) encode(msg) else null
            } catch (e: Exception) {
                android.util.Log.d("ExpoMpcNative", "No message available: ${e.message}")
                null
            }
        }

        Function("signSessionMessageReceiver") { sessionHandle: Long, messageB64: String, index: Int ->
            val msgBytes = decode(messageB64)
            val receiver = Godkls.dklsSignSessionMessageReceiver(sessionHandle, msgBytes, index.toLong())
            String(receiver, Charsets.UTF_8)
        }

        Function("signSessionInputMessage") { sessionHandle: Long, messageB64: String ->
            val msgBytes = decode(messageB64)
            Godkls.dklsSignSessionInputMessage(sessionHandle, msgBytes)
        }

        Function("finishSign") { sessionHandle: Long ->
            val result = Godkls.dklsSignSessionFinish(sessionHandle)
            encode(result)
        }

        Function("freeSignSession") { sessionHandle: Long ->
            Godkls.dklsSignSessionFree(sessionHandle)
        }

        // =====================================================================
        // DKLS — Keyshare
        // =====================================================================

        Function("dklsKeyshareFromBytes") { b64: String ->
            val bytes = decode(b64)
            Godkls.dklsKeyshareFromBytes(bytes)
        }

        Function("dklsKeyshareToBytes") { handle: Long ->
            val bytes = Godkls.dklsKeyshareToBytes(handle)
            encode(bytes)
        }

        Function("dklsKeysharePublicKey") { handle: Long ->
            val bytes = Godkls.dklsKeysharePublicKey(handle)
            encode(bytes)
        }

        Function("dklsKeyshareKeyId") { handle: Long ->
            val bytes = Godkls.dklsKeyshareKeyId(handle)
            encode(bytes)
        }

        Function("dklsKeyshareChainCode") { handle: Long ->
            val bytes = Godkls.dklsKeyshareChaincode(handle)
            encode(bytes)
        }

        Function("freeKeyshare") { handle: Long ->
            Godkls.dklsKeyshareFree(handle)
        }

        // =====================================================================
        // DKLS — QC (Reshare)
        // =====================================================================

        Function("dklsQcSetup") { keyshareHandle: Long, ids: List<String>, oldPartiesB64: String, newThreshold: Int, newPartiesB64: String ->
            val idsBytes = encodeIds(ids)
            val oldBytes = decode(oldPartiesB64)
            val newBytes = decode(newPartiesB64)
            val result = Godkls.dklsQcSetupmsgNew(keyshareHandle, idsBytes, oldBytes, newThreshold.toLong(), newBytes)
            encode(result)
        }

        Function("createQcSession") { setupB64: String, localPartyId: String, keyshareHandle: Long? ->
            val setupBytes = decode(setupB64)
            val idBytes = localPartyId.toByteArray(Charsets.UTF_8)
            val ksHandle = keyshareHandle ?: -1L
            Godkls.dklsQcSessionFromSetup(setupBytes, idBytes, ksHandle)
        }

        Function("qcSessionOutputMessage") { sessionHandle: Long ->
            try {
                val msg = Godkls.dklsQcSessionOutputMessage(sessionHandle)
                if (msg != null && msg.isNotEmpty()) encode(msg) else null
            } catch (e: Exception) {
                android.util.Log.d("ExpoMpcNative", "No message available: ${e.message}")
                null
            }
        }

        Function("qcSessionMessageReceiver") { sessionHandle: Long, messageB64: String, index: Int ->
            val msgBytes = decode(messageB64)
            val receiver = Godkls.dklsQcSessionMessageReceiver(sessionHandle, msgBytes, index.toLong())
            String(receiver, Charsets.UTF_8)
        }

        Function("qcSessionInputMessage") { sessionHandle: Long, messageB64: String ->
            val msgBytes = decode(messageB64)
            Godkls.dklsQcSessionInputMessage(sessionHandle, msgBytes)
        }

        Function("finishQc") { sessionHandle: Long ->
            try {
                Godkls.dklsQcSessionFinish(sessionHandle)
            } catch (e: Exception) {
                android.util.Log.w("ExpoMpcNative", "finishQc: old party (no keyshare) or error: ${e.message}")
                -1L
            }
        }

        Function("freeQcSession") { sessionHandle: Long ->
            Godkls.dklsQcSessionFree(sessionHandle)
        }

        // =====================================================================
        // DKLS — Key Import
        // =====================================================================

        Function("createDklsKeyImportInitiator") { privateKeyHex: String, rootChainCodeHex: String?, threshold: Int, ids: List<String> ->
            val pkBytes = decodeHex(privateKeyHex)
            val ccBytes = if (rootChainCodeHex != null) decodeHex(rootChainCodeHex) else null
            val idsBytes = encodeIds(ids)
            val result = Godkls.dklsKeyImportInitiatorNew(pkBytes, ccBytes, threshold.toLong(), idsBytes)
            mapOf(
                "sessionHandle" to result.handle,
                "setupMessage" to encode(result.setupMsg)
            )
        }

        AsyncFunction("createDklsKeyImportSession") { setupB64: String, localPartyId: String ->
            val setupBytes = decode(setupB64)
            val idBytes = localPartyId.toByteArray(Charsets.UTF_8)
            Godkls.dklsKeyImporterNew(setupBytes, idBytes)
        }

        // =====================================================================
        // Schnorr — Keygen
        // =====================================================================

        Function("schnorrKeygenSetup") { threshold: Int, keyIdB64: String?, ids: List<String> ->
            val keyIdBytes = if (keyIdB64 != null) decode(keyIdB64) else null
            val idsBytes = encodeIds(ids)
            val result = Goschnorr.schnorrKeygenSetupmsgNew(
                threshold.toLong(),
                keyIdBytes,
                idsBytes
            )
            encode(result)
        }

        AsyncFunction("createSchnorrKeygenSession") { setupB64: String, localPartyId: String ->
            val setupBytes = decode(setupB64)
            val idBytes = localPartyId.toByteArray(Charsets.UTF_8)
            Goschnorr.schnorrKeygenSessionFromSetup(setupBytes, idBytes)
        }

        // =====================================================================
        // Schnorr — Keygen session I/O
        // =====================================================================

        Function("schnorrKeygenSessionOutputMessage") { sessionHandle: Long ->
            try {
                val msg = Goschnorr.schnorrKeygenSessionOutputMessage(sessionHandle)
                if (msg != null && msg.isNotEmpty()) encode(msg) else null
            } catch (e: Exception) {
                android.util.Log.d("ExpoMpcNative", "No message available: ${e.message}")
                null
            }
        }

        Function("schnorrKeygenSessionMessageReceiver") { sessionHandle: Long, messageB64: String, index: Int ->
            val msgBytes = decode(messageB64)
            val receiver = Goschnorr.schnorrKeygenSessionMessageReceiver(sessionHandle, msgBytes, index.toLong())
            String(receiver, Charsets.UTF_8)
        }

        Function("schnorrKeygenSessionInputMessage") { sessionHandle: Long, messageB64: String ->
            val msgBytes = decode(messageB64)
            Goschnorr.schnorrKeygenSessionInputMessage(sessionHandle, msgBytes)
        }

        AsyncFunction("finishSchnorrKeygen") { sessionHandle: Long ->
            val keyshareHandle = Goschnorr.schnorrKeygenSessionFinish(sessionHandle)
            val publicKey = encodeHex(Goschnorr.schnorrKeysharePublicKey(keyshareHandle))
            val chainCode = encodeHex(Goschnorr.schnorrKeyshareChaincode(keyshareHandle))
            val keyshare = encode(Goschnorr.schnorrKeyshareToBytes(keyshareHandle))
            Goschnorr.schnorrKeyshareFree(keyshareHandle)
            mapOf("publicKey" to publicKey, "chainCode" to chainCode, "keyshare" to keyshare)
        }

        Function("freeSchnorrKeygenSession") { sessionHandle: Long ->
            Goschnorr.schnorrKeygenSessionFree(sessionHandle)
        }

        // =====================================================================
        // Schnorr — Signing
        // =====================================================================

        Function("schnorrSignSetup") { keyIdB64: String, chainPath: String, messageHashB64: String, ids: List<String> ->
            val keyIdBytes = decode(keyIdB64)
            val chainPathBytes = chainPath.toByteArray(Charsets.UTF_8)
            val hashBytes = decode(messageHashB64)
            val idsBytes = encodeIds(ids)
            val result = Goschnorr.schnorrSignSetupmsgNew(keyIdBytes, chainPathBytes, hashBytes, idsBytes)
            encode(result)
        }

        Function("schnorrDecodeMessage") { setupB64: String ->
            try {
                val setupBytes = decode(setupB64)
                val msg = Goschnorr.schnorrDecodeMessage(setupBytes)
                if (msg != null && msg.isNotEmpty()) encode(msg) else null
            } catch (e: Exception) {
                android.util.Log.d("ExpoMpcNative", "No message available: ${e.message}")
                null
            }
        }

        Function("schnorrDecodeKeyId") { setupB64: String ->
            try {
                val setupBytes = decode(setupB64)
                val keyId = Goschnorr.schnorrDecodeKeyId(setupBytes)
                if (keyId != null && keyId.isNotEmpty()) encode(keyId) else null
            } catch (e: Exception) {
                android.util.Log.d("ExpoMpcNative", "No message available: ${e.message}")
                null
            }
        }

        Function("createSchnorrSignSession") { setupB64: String, localPartyId: String, keyshareHandle: Long ->
            val setupBytes = decode(setupB64)
            val idBytes = localPartyId.toByteArray(Charsets.UTF_8)
            Goschnorr.schnorrSignSessionFromSetup(setupBytes, idBytes, keyshareHandle)
        }

        Function("schnorrSignSessionOutputMessage") { sessionHandle: Long ->
            try {
                val msg = Goschnorr.schnorrSignSessionOutputMessage(sessionHandle)
                if (msg != null && msg.isNotEmpty()) encode(msg) else null
            } catch (e: Exception) {
                android.util.Log.d("ExpoMpcNative", "No message available: ${e.message}")
                null
            }
        }

        Function("schnorrSignSessionMessageReceiver") { sessionHandle: Long, messageB64: String, index: Int ->
            val msgBytes = decode(messageB64)
            val receiver = Goschnorr.schnorrSignSessionMessageReceiver(sessionHandle, msgBytes, index.toLong())
            String(receiver, Charsets.UTF_8)
        }

        Function("schnorrSignSessionInputMessage") { sessionHandle: Long, messageB64: String ->
            val msgBytes = decode(messageB64)
            Goschnorr.schnorrSignSessionInputMessage(sessionHandle, msgBytes)
        }

        Function("finishSchnorrSign") { sessionHandle: Long ->
            val result = Goschnorr.schnorrSignSessionFinish(sessionHandle)
            encode(result)
        }

        Function("freeSchnorrSignSession") { sessionHandle: Long ->
            Goschnorr.schnorrSignSessionFree(sessionHandle)
        }

        // =====================================================================
        // Schnorr — Keyshare
        // =====================================================================

        Function("schnorrKeyshareFromBytes") { b64: String ->
            val bytes = decode(b64)
            Goschnorr.schnorrKeyshareFromBytes(bytes)
        }

        Function("schnorrKeyshareToBytes") { handle: Long ->
            val bytes = Goschnorr.schnorrKeyshareToBytes(handle)
            encode(bytes)
        }

        Function("schnorrKeysharePublicKey") { handle: Long ->
            val bytes = Goschnorr.schnorrKeysharePublicKey(handle)
            encode(bytes)
        }

        Function("schnorrKeyshareKeyId") { handle: Long ->
            val bytes = Goschnorr.schnorrKeyshareKeyId(handle)
            encode(bytes)
        }

        Function("schnorrKeyshareChainCode") { handle: Long ->
            val bytes = Goschnorr.schnorrKeyshareChaincode(handle)
            encode(bytes)
        }

        Function("freeSchnorrKeyshare") { handle: Long ->
            Goschnorr.schnorrKeyshareFree(handle)
        }

        // =====================================================================
        // Schnorr — QC (Reshare)
        // =====================================================================

        Function("schnorrQcSetup") { keyshareHandle: Long, ids: List<String>, oldPartiesB64: String, newThreshold: Int, newPartiesB64: String ->
            val idsBytes = encodeIds(ids)
            val oldBytes = decode(oldPartiesB64)
            val newBytes = decode(newPartiesB64)
            val result = Goschnorr.schnorrQcSetupmsgNew(keyshareHandle, idsBytes, oldBytes, newThreshold.toLong(), newBytes)
            encode(result)
        }

        Function("createSchnorrQcSession") { setupB64: String, localPartyId: String, keyshareHandle: Long? ->
            val setupBytes = decode(setupB64)
            val idBytes = localPartyId.toByteArray(Charsets.UTF_8)
            val ksHandle = keyshareHandle ?: -1L
            Goschnorr.schnorrQcSessionFromSetup(setupBytes, idBytes, ksHandle)
        }

        Function("schnorrQcSessionOutputMessage") { sessionHandle: Long ->
            try {
                val msg = Goschnorr.schnorrQcSessionOutputMessage(sessionHandle)
                if (msg != null && msg.isNotEmpty()) encode(msg) else null
            } catch (e: Exception) {
                android.util.Log.d("ExpoMpcNative", "No message available: ${e.message}")
                null
            }
        }

        Function("schnorrQcSessionMessageReceiver") { sessionHandle: Long, messageB64: String, index: Int ->
            val msgBytes = decode(messageB64)
            val receiver = Goschnorr.schnorrQcSessionMessageReceiver(sessionHandle, msgBytes, index.toLong())
            String(receiver, Charsets.UTF_8)
        }

        Function("schnorrQcSessionInputMessage") { sessionHandle: Long, messageB64: String ->
            val msgBytes = decode(messageB64)
            Goschnorr.schnorrQcSessionInputMessage(sessionHandle, msgBytes)
        }

        Function("finishSchnorrQc") { sessionHandle: Long ->
            try {
                Goschnorr.schnorrQcSessionFinish(sessionHandle)
            } catch (e: Exception) {
                android.util.Log.w("ExpoMpcNative", "finishSchnorrQc: old party (no keyshare) or error: ${e.message}")
                -1L
            }
        }

        Function("freeSchnorrQcSession") { sessionHandle: Long ->
            Goschnorr.schnorrQcSessionFree(sessionHandle)
        }

        // =====================================================================
        // Schnorr — Key Import
        // =====================================================================

        Function("createSchnorrKeyImportInitiator") { privateKeyHex: String, rootChainCodeHex: String?, threshold: Int, ids: List<String> ->
            val pkBytes = decodeHex(privateKeyHex)
            val ccBytes = if (rootChainCodeHex != null) decodeHex(rootChainCodeHex) else null
            val idsBytes = encodeIds(ids)
            val result = Goschnorr.schnorrKeyImportInitiatorNew(pkBytes, ccBytes, threshold.toLong(), idsBytes)
            mapOf(
                "sessionHandle" to result.handle,
                "setupMessage" to encode(result.setupMsg)
            )
        }

        AsyncFunction("createSchnorrKeyImportSession") { setupB64: String, localPartyId: String ->
            val setupBytes = decode(setupB64)
            val idBytes = localPartyId.toByteArray(Charsets.UTF_8)
            Goschnorr.schnorrKeyImporterNew(setupBytes, idBytes)
        }
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    private fun encode(bytes: ByteArray): String =
        Base64.encodeToString(bytes, Base64.NO_WRAP)

    private fun encodeHex(bytes: ByteArray): String =
        bytes.joinToString("") { "%02x".format(it) }

    private fun decode(b64: String): ByteArray =
        Base64.decode(b64, Base64.NO_WRAP)

    private fun decodeHex(hex: String): ByteArray {
        require(hex.length % 2 == 0) { "Hex string must have even length, got ${hex.length}" }
        return hex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
    }

    private fun encodeIds(ids: List<String>): ByteArray {
        val result = mutableListOf<Byte>()
        for (id in ids) {
            result.addAll(id.toByteArray(Charsets.UTF_8).toList())
            result.add(0) // null separator
        }
        // Remove trailing null — Go expects null-separated, not null-terminated
        if (result.isNotEmpty() && result.last() == 0.toByte()) {
            result.removeAt(result.size - 1)
        }
        return result.toByteArray()
    }
}
