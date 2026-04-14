@file:OptIn(ExperimentalEncodingApi::class, ExperimentalStdlibApi::class)

package expo.modules.mpcnative

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.exception.CodedException

// DKLS SWIG bindings — package is com.silencelaboratories.godkls.* and the
// "namespace class" is the lowercase `godkls` (not `Godkls`). All static
// methods are SWIG-generated wrappers over JNI symbols in libgodklsswig.so.
import com.silencelaboratories.godkls.BufferUtilJNI as DklsBufferUtil
import com.silencelaboratories.godkls.Handle as DklsHandle
import com.silencelaboratories.godkls.go_slice as DklsGoSlice
import com.silencelaboratories.godkls.tss_buffer as DklsBuffer
import com.silencelaboratories.godkls.lib_error.LIB_OK as DKLS_LIB_OK
import com.silencelaboratories.godkls.godkls.tss_buffer_free as dklsTssBufferFree
import com.silencelaboratories.godkls.godkls.dkls_keygen_setupmsg_new
import com.silencelaboratories.godkls.godkls.dkls_keygen_session_from_setup
import com.silencelaboratories.godkls.godkls.dkls_key_refresh_session_from_setup
import com.silencelaboratories.godkls.godkls.dkls_key_migration_session_from_setup
import com.silencelaboratories.godkls.godkls.dkls_keygen_session_output_message
import com.silencelaboratories.godkls.godkls.dkls_keygen_session_message_receiver
import com.silencelaboratories.godkls.godkls.dkls_keygen_session_input_message
import com.silencelaboratories.godkls.godkls.dkls_keygen_session_finish
import com.silencelaboratories.godkls.godkls.dkls_keygen_session_free
import com.silencelaboratories.godkls.godkls.dkls_sign_setupmsg_new
import com.silencelaboratories.godkls.godkls.dkls_sign_session_from_setup
import com.silencelaboratories.godkls.godkls.dkls_sign_session_output_message
import com.silencelaboratories.godkls.godkls.dkls_sign_session_message_receiver
import com.silencelaboratories.godkls.godkls.dkls_sign_session_input_message
import com.silencelaboratories.godkls.godkls.dkls_sign_session_finish
import com.silencelaboratories.godkls.godkls.dkls_sign_session_free
import com.silencelaboratories.godkls.godkls.dkls_decode_message
import com.silencelaboratories.godkls.godkls.dkls_decode_key_id
import com.silencelaboratories.godkls.godkls.dkls_keyshare_from_bytes
import com.silencelaboratories.godkls.godkls.dkls_keyshare_to_bytes
import com.silencelaboratories.godkls.godkls.dkls_keyshare_public_key
import com.silencelaboratories.godkls.godkls.dkls_keyshare_key_id
import com.silencelaboratories.godkls.godkls.dkls_keyshare_chaincode
import com.silencelaboratories.godkls.godkls.dkls_keyshare_free
import com.silencelaboratories.godkls.godkls.dkls_qc_setupmsg_new
import com.silencelaboratories.godkls.godkls.dkls_qc_session_from_setup
import com.silencelaboratories.godkls.godkls.dkls_qc_session_output_message
import com.silencelaboratories.godkls.godkls.dkls_qc_session_message_receiver
import com.silencelaboratories.godkls.godkls.dkls_qc_session_input_message
import com.silencelaboratories.godkls.godkls.dkls_qc_session_finish
import com.silencelaboratories.godkls.godkls.dkls_qc_session_free
import com.silencelaboratories.godkls.godkls.dkls_key_import_initiator_new
import com.silencelaboratories.godkls.godkls.dkls_key_importer_new

// Schnorr SWIG bindings — symmetric structure under com.silencelaboratories.goschnorr.*.
// Notable difference: there is no `schnorr_keyshare_free` SWIG wrapper, so we
// rely on Handle's SWIG-generated `delete()` destructor for keyshare cleanup.
import com.silencelaboratories.goschnorr.BufferUtilJNI as SchnorrBufferUtil
import com.silencelaboratories.goschnorr.Handle as SchnorrHandle
import com.silencelaboratories.goschnorr.go_slice as SchnorrGoSlice
import com.silencelaboratories.goschnorr.tss_buffer as SchnorrBuffer
import com.silencelaboratories.goschnorr.schnorr_lib_error.LIB_OK as SCHNORR_LIB_OK
import com.silencelaboratories.goschnorr.goschnorr.tss_buffer_free as schnorrTssBufferFree
import com.silencelaboratories.goschnorr.goschnorr.schnorr_keygen_setupmsg_new
import com.silencelaboratories.goschnorr.goschnorr.schnorr_keygen_session_from_setup
import com.silencelaboratories.goschnorr.goschnorr.schnorr_key_refresh_session_from_setup
import com.silencelaboratories.goschnorr.goschnorr.schnorr_key_migration_session_from_setup
import com.silencelaboratories.goschnorr.goschnorr.schnorr_keygen_session_output_message
import com.silencelaboratories.goschnorr.goschnorr.schnorr_keygen_session_message_receiver
import com.silencelaboratories.goschnorr.goschnorr.schnorr_keygen_session_input_message
import com.silencelaboratories.goschnorr.goschnorr.schnorr_keygen_session_finish
import com.silencelaboratories.goschnorr.goschnorr.schnorr_keygen_session_free
import com.silencelaboratories.goschnorr.goschnorr.schnorr_sign_setupmsg_new
import com.silencelaboratories.goschnorr.goschnorr.schnorr_sign_session_from_setup
import com.silencelaboratories.goschnorr.goschnorr.schnorr_sign_session_output_message
import com.silencelaboratories.goschnorr.goschnorr.schnorr_sign_session_message_receiver
import com.silencelaboratories.goschnorr.goschnorr.schnorr_sign_session_input_message
import com.silencelaboratories.goschnorr.goschnorr.schnorr_sign_session_finish
import com.silencelaboratories.goschnorr.goschnorr.schnorr_sign_session_free
import com.silencelaboratories.goschnorr.goschnorr.schnorr_decode_message
import com.silencelaboratories.goschnorr.goschnorr.schnorr_decode_key_id
import com.silencelaboratories.goschnorr.goschnorr.schnorr_keyshare_from_bytes
import com.silencelaboratories.goschnorr.goschnorr.schnorr_keyshare_to_bytes
import com.silencelaboratories.goschnorr.goschnorr.schnorr_keyshare_public_key
import com.silencelaboratories.goschnorr.goschnorr.schnorr_keyshare_key_id
import com.silencelaboratories.goschnorr.goschnorr.schnorr_keyshare_chaincode
import com.silencelaboratories.goschnorr.goschnorr.schnorr_qc_setupmsg_new
import com.silencelaboratories.goschnorr.goschnorr.schnorr_qc_session_from_setup
import com.silencelaboratories.goschnorr.goschnorr.schnorr_qc_session_output_message
import com.silencelaboratories.goschnorr.goschnorr.schnorr_qc_session_message_receiver
import com.silencelaboratories.goschnorr.goschnorr.schnorr_qc_session_input_message
import com.silencelaboratories.goschnorr.goschnorr.schnorr_qc_session_finish
import com.silencelaboratories.goschnorr.goschnorr.schnorr_qc_session_free
import com.silencelaboratories.goschnorr.goschnorr.schnorr_key_import_initiator_new
import com.silencelaboratories.goschnorr.goschnorr.schnorr_key_importer_new

import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi

class ExpoMpcNativeModule : Module() {

    companion object {
        init {
            // godklsJNI / goschnorrJNI declare native methods without a static
            // initializer, so the consumer has to load the SWIG shims by hand.
            // Load the underlying Go-built libs FIRST so they're already in the
            // linker namespace by the time the SWIG shims try to resolve their
            // DT_NEEDED/verneed entries against them. Wrapped in try/catch so a
            // failed load doesn't crash the app — the first JNI call will then
            // surface a clean error to JS.
            try {
                System.loadLibrary("godkls")
                System.loadLibrary("goschnorr")
                System.loadLibrary("godklsswig")
                System.loadLibrary("goschnorrswig")
            } catch (e: Throwable) {
                android.util.Log.e("ExpoMpcNative", "Failed to load native libs", e)
            }
        }
    }

    // Handle registry: JS sees handles as Long integers; we map them to native Handle objects.
    // DKLS and Schnorr use separate class hierarchies (different packages) so we track them apart.
    private val dklsHandles = mutableMapOf<Long, DklsHandle>()
    private val schnorrHandles = mutableMapOf<Long, SchnorrHandle>()
    private var nextHandleId: Long = 1L

    @Synchronized
    private fun storeDkls(h: DklsHandle): Long {
        val id = nextHandleId++
        dklsHandles[id] = h
        return id
    }

    private fun getDkls(id: Long): DklsHandle =
        dklsHandles[id] ?: throw CodedException("DklsError", "Invalid DKLS handle: $id", null)

    @Synchronized
    private fun storeSchnorr(h: SchnorrHandle): Long {
        val id = nextHandleId++
        schnorrHandles[id] = h
        return id
    }

    private fun getSchnorr(id: Long): SchnorrHandle =
        schnorrHandles[id] ?: throw CodedException("SchnorrError", "Invalid Schnorr handle: $id", null)

    override fun definition() = ModuleDefinition {
        Name("ExpoMpcNative")

        // =====================================================================
        // DKLS — Keygen
        // =====================================================================

        Function("dklsKeygenSetup") { threshold: Int, keyIdB64: String?, ids: List<String> ->
            val buf = DklsBuffer()
            try {
                // Mirror the iOS Swift contract: pass null (not an empty slice) when keyIdB64
                // is omitted. The C API treats a null go_slice pointer as "no key id" and
                // an empty slice as "key id is the empty byte string" — different semantics.
                val keyIdSlice = if (keyIdB64 != null) decode(keyIdB64).toDklsSlice() else null
                val idsSlice = encodeIds(ids).toDklsSlice()
                val err = dkls_keygen_setupmsg_new(threshold.toLong(), keyIdSlice, idsSlice, buf)
                if (err != DKLS_LIB_OK) dklsFail("dklsKeygenSetup", err)
                encode(DklsBufferUtil.get_bytes_from_tss_buffer(buf))
            } finally {
                dklsTssBufferFree(buf)
            }
        }

        AsyncFunction("createKeygenSession") { setupB64: String, localPartyId: String ->
            val handle = DklsHandle()
            val setupSlice = decode(setupB64).toDklsSlice()
            val idSlice = localPartyId.toByteArray(Charsets.UTF_8).toDklsSlice()
            val err = dkls_keygen_session_from_setup(setupSlice, idSlice, handle)
            if (err != DKLS_LIB_OK) dklsFail("createKeygenSession", err)
            storeDkls(handle)
        }

        Function("createKeygenRefreshSession") { setupB64: String, localPartyId: String, keyshareHandle: Long ->
            val ks = getDkls(keyshareHandle)
            val session = DklsHandle()
            val setupSlice = decode(setupB64).toDklsSlice()
            val idSlice = localPartyId.toByteArray(Charsets.UTF_8).toDklsSlice()
            val err = dkls_key_refresh_session_from_setup(setupSlice, idSlice, ks, session)
            if (err != DKLS_LIB_OK) dklsFail("createKeygenRefreshSession", err)
            storeDkls(session)
        }

        Function("createKeygenMigrationSession") { setupB64: String, localPartyId: String, publicKeyB64: String, rootChainCodeB64: String, secretCoefficientB64: String ->
            val session = DklsHandle()
            val setupSlice = decode(setupB64).toDklsSlice()
            val idSlice = localPartyId.toByteArray(Charsets.UTF_8).toDklsSlice()
            val pkSlice = decode(publicKeyB64).toDklsSlice()
            val ccSlice = decode(rootChainCodeB64).toDklsSlice()
            val secSlice = decode(secretCoefficientB64).toDklsSlice()
            val err = dkls_key_migration_session_from_setup(setupSlice, idSlice, pkSlice, ccSlice, secSlice, session)
            if (err != DKLS_LIB_OK) dklsFail("createKeygenMigrationSession", err)
            storeDkls(session)
        }

        // =====================================================================
        // DKLS — Keygen session I/O
        // =====================================================================

        Function("keygenSessionOutputMessage") { sessionHandle: Long ->
            readDklsOutput("keygenSessionOutputMessage", sessionHandle) { h, buf ->
                dkls_keygen_session_output_message(h, buf)
            }
        }

        Function("keygenSessionMessageReceiver") { sessionHandle: Long, messageB64: String, index: Int ->
            val buf = DklsBuffer()
            try {
                val h = getDkls(sessionHandle)
                val msgSlice = decode(messageB64).toDklsSlice()
                val err = dkls_keygen_session_message_receiver(h, msgSlice, index.toLong(), buf)
                if (err != DKLS_LIB_OK) dklsFail("keygenSessionMessageReceiver", err)
                String(DklsBufferUtil.get_bytes_from_tss_buffer(buf), Charsets.UTF_8)
            } finally {
                dklsTssBufferFree(buf)
            }
        }

        Function("keygenSessionInputMessage") { sessionHandle: Long, messageB64: String ->
            val h = getDkls(sessionHandle)
            val isFinished = intArrayOf(0)
            val msgSlice = decode(messageB64).toDklsSlice()
            val err = dkls_keygen_session_input_message(h, msgSlice, isFinished)
            if (err != DKLS_LIB_OK) dklsFail("keygenSessionInputMessage", err)
            isFinished[0] != 0
        }

        AsyncFunction("finishKeygen") { sessionHandle: Long ->
            val session = getDkls(sessionHandle)
            val keyshare = DklsHandle()
            val finishErr = dkls_keygen_session_finish(session, keyshare)
            if (finishErr != DKLS_LIB_OK) dklsFail("finishKeygen.session", finishErr)

            val publicKey = encodeHex(readDklsBuffer("keysharePublicKey") { dkls_keyshare_public_key(keyshare, it) })
            val chainCode = encodeHex(readDklsBuffer("keyshareChaincode") { dkls_keyshare_chaincode(keyshare, it) })
            val keyshareBytes = readDklsBuffer("keyshareToBytes") { dkls_keyshare_to_bytes(keyshare, it) }
            dkls_keyshare_free(keyshare)
            dkls_keygen_session_free(session)
            dklsHandles.remove(sessionHandle)

            mapOf(
                "publicKey" to publicKey,
                "chainCode" to chainCode,
                "keyshare" to encode(keyshareBytes),
            )
        }

        Function("freeKeygenSession") { sessionHandle: Long ->
            dklsHandles.remove(sessionHandle)?.let { dkls_keygen_session_free(it) }
        }

        // =====================================================================
        // DKLS — Signing
        // =====================================================================

        Function("dklsSignSetup") { keyIdB64: String, chainPath: String, messageHashB64: String?, ids: List<String> ->
            val buf = DklsBuffer()
            try {
                val keyIdSlice = decode(keyIdB64).toDklsSlice()
                val chainPathSlice = chainPath.toByteArray(Charsets.UTF_8).toDklsSlice()
                val hashSlice = if (messageHashB64 != null) decode(messageHashB64).toDklsSlice() else null
                val idsSlice = encodeIds(ids).toDklsSlice()
                val err = dkls_sign_setupmsg_new(keyIdSlice, chainPathSlice, hashSlice, idsSlice, buf)
                if (err != DKLS_LIB_OK) dklsFail("dklsSignSetup", err)
                encode(DklsBufferUtil.get_bytes_from_tss_buffer(buf))
            } finally {
                dklsTssBufferFree(buf)
            }
        }

        Function("dklsDecodeMessage") { setupB64: String ->
            readDklsOptional("dklsDecodeMessage", setupB64) { slice, buf -> dkls_decode_message(slice, buf) }
        }

        Function("dklsDecodeKeyId") { setupB64: String ->
            readDklsOptional("dklsDecodeKeyId", setupB64) { slice, buf -> dkls_decode_key_id(slice, buf) }
        }

        Function("createSignSession") { setupB64: String, localPartyId: String, keyshareHandle: Long ->
            val ks = getDkls(keyshareHandle)
            val session = DklsHandle()
            val setupSlice = decode(setupB64).toDklsSlice()
            val idSlice = localPartyId.toByteArray(Charsets.UTF_8).toDklsSlice()
            val err = dkls_sign_session_from_setup(setupSlice, idSlice, ks, session)
            if (err != DKLS_LIB_OK) dklsFail("createSignSession", err)
            storeDkls(session)
        }

        Function("signSessionOutputMessage") { sessionHandle: Long ->
            readDklsOutput("signSessionOutputMessage", sessionHandle) { h, buf ->
                dkls_sign_session_output_message(h, buf)
            }
        }

        Function("signSessionMessageReceiver") { sessionHandle: Long, messageB64: String, index: Int ->
            val buf = DklsBuffer()
            try {
                val h = getDkls(sessionHandle)
                val msgSlice = decode(messageB64).toDklsSlice()
                val err = dkls_sign_session_message_receiver(h, msgSlice, index.toLong(), buf)
                if (err != DKLS_LIB_OK) dklsFail("signSessionMessageReceiver", err)
                String(DklsBufferUtil.get_bytes_from_tss_buffer(buf), Charsets.UTF_8)
            } finally {
                dklsTssBufferFree(buf)
            }
        }

        Function("signSessionInputMessage") { sessionHandle: Long, messageB64: String ->
            val h = getDkls(sessionHandle)
            val isFinished = intArrayOf(0)
            val msgSlice = decode(messageB64).toDklsSlice()
            val err = dkls_sign_session_input_message(h, msgSlice, isFinished)
            if (err != DKLS_LIB_OK) dklsFail("signSessionInputMessage", err)
            isFinished[0] != 0
        }

        Function("finishSign") { sessionHandle: Long ->
            val buf = DklsBuffer()
            try {
                val h = getDkls(sessionHandle)
                val err = dkls_sign_session_finish(h, buf)
                if (err != DKLS_LIB_OK) dklsFail("finishSign", err)
                encode(DklsBufferUtil.get_bytes_from_tss_buffer(buf))
            } finally {
                dklsTssBufferFree(buf)
            }
        }

        Function("freeSignSession") { sessionHandle: Long ->
            dklsHandles.remove(sessionHandle)?.let { dkls_sign_session_free(it) }
        }

        // =====================================================================
        // DKLS — Keyshare
        // =====================================================================

        Function("dklsKeyshareFromBytes") { b64: String ->
            val ks = DklsHandle()
            val slice = decode(b64).toDklsSlice()
            val err = dkls_keyshare_from_bytes(slice, ks)
            if (err != DKLS_LIB_OK) dklsFail("dklsKeyshareFromBytes", err)
            storeDkls(ks)
        }

        Function("dklsKeyshareToBytes") { handle: Long ->
            encode(readDklsBuffer("dklsKeyshareToBytes") { dkls_keyshare_to_bytes(getDkls(handle), it) })
        }

        Function("dklsKeysharePublicKey") { handle: Long ->
            encode(readDklsBuffer("dklsKeysharePublicKey") { dkls_keyshare_public_key(getDkls(handle), it) })
        }

        Function("dklsKeyshareKeyId") { handle: Long ->
            encode(readDklsBuffer("dklsKeyshareKeyId") { dkls_keyshare_key_id(getDkls(handle), it) })
        }

        Function("dklsKeyshareChainCode") { handle: Long ->
            encode(readDklsBuffer("dklsKeyshareChainCode") { dkls_keyshare_chaincode(getDkls(handle), it) })
        }

        Function("freeKeyshare") { handle: Long ->
            dklsHandles.remove(handle)?.let { dkls_keyshare_free(it) }
        }

        // =====================================================================
        // DKLS — QC (Reshare)
        // =====================================================================

        Function("dklsQcSetup") { keyshareHandle: Long, ids: List<String>, oldPartiesB64: String, newThreshold: Int, newPartiesB64: String ->
            val buf = DklsBuffer()
            try {
                val ks = getDkls(keyshareHandle)
                val idsSlice = encodeIds(ids).toDklsSlice()
                val oldSlice = decode(oldPartiesB64).toDklsSlice()
                val newSlice = decode(newPartiesB64).toDklsSlice()
                val err = dkls_qc_setupmsg_new(ks, idsSlice, oldSlice, newThreshold.toLong(), newSlice, buf)
                if (err != DKLS_LIB_OK) dklsFail("dklsQcSetup", err)
                encode(DklsBufferUtil.get_bytes_from_tss_buffer(buf))
            } finally {
                dklsTssBufferFree(buf)
            }
        }

        Function("createQcSession") { setupB64: String, localPartyId: String, keyshareHandle: Long? ->
            val session = DklsHandle()
            // Old-party / no-keyshare reshare participants pass a sentinel Handle whose
            // internal `_0` is -1. iOS does the same with `Handle(_0: Int32(keyshareHandle ?? -1))`;
            // the C side branches on this to skip the keyshare-bound code path.
            val ks = if (keyshareHandle != null) {
                getDkls(keyshareHandle)
            } else {
                DklsHandle().apply { set_0(-1) }
            }
            val setupSlice = decode(setupB64).toDklsSlice()
            val idSlice = localPartyId.toByteArray(Charsets.UTF_8).toDklsSlice()
            val err = dkls_qc_session_from_setup(setupSlice, idSlice, ks, session)
            if (err != DKLS_LIB_OK) dklsFail("createQcSession", err)
            storeDkls(session)
        }

        Function("qcSessionOutputMessage") { sessionHandle: Long ->
            readDklsOutput("qcSessionOutputMessage", sessionHandle) { h, buf ->
                dkls_qc_session_output_message(h, buf)
            }
        }

        Function("qcSessionMessageReceiver") { sessionHandle: Long, messageB64: String, index: Int ->
            val buf = DklsBuffer()
            try {
                val h = getDkls(sessionHandle)
                val msgSlice = decode(messageB64).toDklsSlice()
                val err = dkls_qc_session_message_receiver(h, msgSlice, index.toLong(), buf)
                if (err != DKLS_LIB_OK) dklsFail("qcSessionMessageReceiver", err)
                String(DklsBufferUtil.get_bytes_from_tss_buffer(buf), Charsets.UTF_8)
            } finally {
                dklsTssBufferFree(buf)
            }
        }

        Function("qcSessionInputMessage") { sessionHandle: Long, messageB64: String ->
            val h = getDkls(sessionHandle)
            val isFinished = intArrayOf(0)
            val msgSlice = decode(messageB64).toDklsSlice()
            val err = dkls_qc_session_input_message(h, msgSlice, isFinished)
            if (err != DKLS_LIB_OK) dklsFail("qcSessionInputMessage", err)
            isFinished[0] != 0
        }

        Function("finishQc") { sessionHandle: Long ->
            val session = getDkls(sessionHandle)
            val newKeyshare = DklsHandle()
            val err = dkls_qc_session_finish(session, newKeyshare)
            if (err != DKLS_LIB_OK) {
                android.util.Log.i("ExpoMpcNative", "finishQc: no new keyshare for session $sessionHandle (err=$err) - likely an old-party exit")
                -1L
            } else {
                storeDkls(newKeyshare)
            }
        }

        Function("freeQcSession") { sessionHandle: Long ->
            dklsHandles.remove(sessionHandle)?.let { dkls_qc_session_free(it) }
        }

        // =====================================================================
        // DKLS — Key Import
        // =====================================================================

        Function("createDklsKeyImportInitiator") { privateKeyHex: String, rootChainCodeHex: String?, threshold: Int, ids: List<String> ->
            val buf = DklsBuffer()
            try {
                val session = DklsHandle()
                val pkSlice = decodeHex(privateKeyHex).toDklsSlice()
                val ccSlice = if (rootChainCodeHex != null) decodeHex(rootChainCodeHex).toDklsSlice() else null
                val idsSlice = encodeIds(ids).toDklsSlice()
                val err = dkls_key_import_initiator_new(pkSlice, ccSlice, threshold.toShort(), idsSlice, buf, session)
                if (err != DKLS_LIB_OK) dklsFail("createDklsKeyImportInitiator", err)
                mapOf(
                    "sessionHandle" to storeDkls(session),
                    "setupMessage" to encode(DklsBufferUtil.get_bytes_from_tss_buffer(buf)),
                )
            } finally {
                dklsTssBufferFree(buf)
            }
        }

        AsyncFunction("createDklsKeyImportSession") { setupB64: String, localPartyId: String ->
            val session = DklsHandle()
            val setupSlice = decode(setupB64).toDklsSlice()
            val idSlice = localPartyId.toByteArray(Charsets.UTF_8).toDklsSlice()
            val err = dkls_key_importer_new(setupSlice, idSlice, session)
            if (err != DKLS_LIB_OK) dklsFail("createDklsKeyImportSession", err)
            storeDkls(session)
        }

        // =====================================================================
        // Schnorr — Keygen
        // =====================================================================

        Function("schnorrKeygenSetup") { threshold: Int, keyIdB64: String?, ids: List<String> ->
            val buf = SchnorrBuffer()
            try {
                val keyIdSlice = if (keyIdB64 != null) decode(keyIdB64).toSchnorrSlice() else null
                val idsSlice = encodeIds(ids).toSchnorrSlice()
                val err = schnorr_keygen_setupmsg_new(threshold.toLong(), keyIdSlice, idsSlice, buf)
                if (err != SCHNORR_LIB_OK) schnorrFail("schnorrKeygenSetup", err)
                encode(SchnorrBufferUtil.get_bytes_from_tss_buffer(buf))
            } finally {
                schnorrTssBufferFree(buf)
            }
        }

        AsyncFunction("createSchnorrKeygenSession") { setupB64: String, localPartyId: String ->
            val session = SchnorrHandle()
            val setupSlice = decode(setupB64).toSchnorrSlice()
            val idSlice = localPartyId.toByteArray(Charsets.UTF_8).toSchnorrSlice()
            val err = schnorr_keygen_session_from_setup(setupSlice, idSlice, session)
            if (err != SCHNORR_LIB_OK) schnorrFail("createSchnorrKeygenSession", err)
            storeSchnorr(session)
        }

        // =====================================================================
        // Schnorr — Keygen session I/O
        // =====================================================================

        Function("schnorrKeygenSessionOutputMessage") { sessionHandle: Long ->
            readSchnorrOutput("schnorrKeygenSessionOutputMessage", sessionHandle) { h, buf ->
                schnorr_keygen_session_output_message(h, buf)
            }
        }

        Function("schnorrKeygenSessionMessageReceiver") { sessionHandle: Long, messageB64: String, index: Int ->
            val buf = SchnorrBuffer()
            try {
                val h = getSchnorr(sessionHandle)
                val msgSlice = decode(messageB64).toSchnorrSlice()
                val err = schnorr_keygen_session_message_receiver(h, msgSlice, index.toLong(), buf)
                if (err != SCHNORR_LIB_OK) schnorrFail("schnorrKeygenSessionMessageReceiver", err)
                String(SchnorrBufferUtil.get_bytes_from_tss_buffer(buf), Charsets.UTF_8)
            } finally {
                schnorrTssBufferFree(buf)
            }
        }

        Function("schnorrKeygenSessionInputMessage") { sessionHandle: Long, messageB64: String ->
            val h = getSchnorr(sessionHandle)
            val isFinished = intArrayOf(0)
            val msgSlice = decode(messageB64).toSchnorrSlice()
            val err = schnorr_keygen_session_input_message(h, msgSlice, isFinished)
            if (err != SCHNORR_LIB_OK) schnorrFail("schnorrKeygenSessionInputMessage", err)
            isFinished[0] != 0
        }

        AsyncFunction("finishSchnorrKeygen") { sessionHandle: Long ->
            val session = getSchnorr(sessionHandle)
            val keyshare = SchnorrHandle()
            val finishErr = schnorr_keygen_session_finish(session, keyshare)
            if (finishErr != SCHNORR_LIB_OK) schnorrFail("finishSchnorrKeygen.session", finishErr)

            val publicKey = encodeHex(readSchnorrBuffer("schnorrKeysharePublicKey") { schnorr_keyshare_public_key(keyshare, it) })
            val chainCode = encodeHex(readSchnorrBuffer("schnorrKeyshareChaincode") { schnorr_keyshare_chaincode(keyshare, it) })
            val keyshareBytes = readSchnorrBuffer("schnorrKeyshareToBytes") { schnorr_keyshare_to_bytes(keyshare, it) }
            // Schnorr SWIG bindings have no keyshare_free; rely on Handle's SWIG destructor.
            keyshare.delete()
            schnorr_keygen_session_free(session)
            schnorrHandles.remove(sessionHandle)

            mapOf(
                "publicKey" to publicKey,
                "chainCode" to chainCode,
                "keyshare" to encode(keyshareBytes),
            )
        }

        Function("freeSchnorrKeygenSession") { sessionHandle: Long ->
            schnorrHandles.remove(sessionHandle)?.let { schnorr_keygen_session_free(it) }
        }

        // =====================================================================
        // Schnorr — Signing
        // =====================================================================

        Function("schnorrSignSetup") { keyIdB64: String, chainPath: String, messageHashB64: String, ids: List<String> ->
            val buf = SchnorrBuffer()
            try {
                val keyIdSlice = decode(keyIdB64).toSchnorrSlice()
                val chainPathSlice = chainPath.toByteArray(Charsets.UTF_8).toSchnorrSlice()
                val hashSlice = decode(messageHashB64).toSchnorrSlice()
                val idsSlice = encodeIds(ids).toSchnorrSlice()
                val err = schnorr_sign_setupmsg_new(keyIdSlice, chainPathSlice, hashSlice, idsSlice, buf)
                if (err != SCHNORR_LIB_OK) schnorrFail("schnorrSignSetup", err)
                encode(SchnorrBufferUtil.get_bytes_from_tss_buffer(buf))
            } finally {
                schnorrTssBufferFree(buf)
            }
        }

        Function("schnorrDecodeMessage") { setupB64: String ->
            readSchnorrOptional("schnorrDecodeMessage", setupB64) { slice, buf -> schnorr_decode_message(slice, buf) }
        }

        Function("schnorrDecodeKeyId") { setupB64: String ->
            readSchnorrOptional("schnorrDecodeKeyId", setupB64) { slice, buf -> schnorr_decode_key_id(slice, buf) }
        }

        Function("createSchnorrSignSession") { setupB64: String, localPartyId: String, keyshareHandle: Long ->
            val ks = getSchnorr(keyshareHandle)
            val session = SchnorrHandle()
            val setupSlice = decode(setupB64).toSchnorrSlice()
            val idSlice = localPartyId.toByteArray(Charsets.UTF_8).toSchnorrSlice()
            val err = schnorr_sign_session_from_setup(setupSlice, idSlice, ks, session)
            if (err != SCHNORR_LIB_OK) schnorrFail("createSchnorrSignSession", err)
            storeSchnorr(session)
        }

        Function("schnorrSignSessionOutputMessage") { sessionHandle: Long ->
            readSchnorrOutput("schnorrSignSessionOutputMessage", sessionHandle) { h, buf ->
                schnorr_sign_session_output_message(h, buf)
            }
        }

        Function("schnorrSignSessionMessageReceiver") { sessionHandle: Long, messageB64: String, index: Int ->
            val buf = SchnorrBuffer()
            try {
                val h = getSchnorr(sessionHandle)
                val msgSlice = decode(messageB64).toSchnorrSlice()
                val err = schnorr_sign_session_message_receiver(h, msgSlice, index.toLong(), buf)
                if (err != SCHNORR_LIB_OK) schnorrFail("schnorrSignSessionMessageReceiver", err)
                String(SchnorrBufferUtil.get_bytes_from_tss_buffer(buf), Charsets.UTF_8)
            } finally {
                schnorrTssBufferFree(buf)
            }
        }

        Function("schnorrSignSessionInputMessage") { sessionHandle: Long, messageB64: String ->
            val h = getSchnorr(sessionHandle)
            val isFinished = intArrayOf(0)
            val msgSlice = decode(messageB64).toSchnorrSlice()
            val err = schnorr_sign_session_input_message(h, msgSlice, isFinished)
            if (err != SCHNORR_LIB_OK) schnorrFail("schnorrSignSessionInputMessage", err)
            isFinished[0] != 0
        }

        Function("finishSchnorrSign") { sessionHandle: Long ->
            val buf = SchnorrBuffer()
            try {
                val h = getSchnorr(sessionHandle)
                val err = schnorr_sign_session_finish(h, buf)
                if (err != SCHNORR_LIB_OK) schnorrFail("finishSchnorrSign", err)
                encode(SchnorrBufferUtil.get_bytes_from_tss_buffer(buf))
            } finally {
                schnorrTssBufferFree(buf)
            }
        }

        Function("freeSchnorrSignSession") { sessionHandle: Long ->
            schnorrHandles.remove(sessionHandle)?.let { schnorr_sign_session_free(it) }
        }

        // =====================================================================
        // Schnorr — Keyshare
        // =====================================================================

        Function("schnorrKeyshareFromBytes") { b64: String ->
            val ks = SchnorrHandle()
            val slice = decode(b64).toSchnorrSlice()
            val err = schnorr_keyshare_from_bytes(slice, ks)
            if (err != SCHNORR_LIB_OK) schnorrFail("schnorrKeyshareFromBytes", err)
            storeSchnorr(ks)
        }

        Function("schnorrKeyshareToBytes") { handle: Long ->
            encode(readSchnorrBuffer("schnorrKeyshareToBytes") { schnorr_keyshare_to_bytes(getSchnorr(handle), it) })
        }

        Function("schnorrKeysharePublicKey") { handle: Long ->
            encode(readSchnorrBuffer("schnorrKeysharePublicKey") { schnorr_keyshare_public_key(getSchnorr(handle), it) })
        }

        Function("schnorrKeyshareKeyId") { handle: Long ->
            encode(readSchnorrBuffer("schnorrKeyshareKeyId") { schnorr_keyshare_key_id(getSchnorr(handle), it) })
        }

        Function("schnorrKeyshareChainCode") { handle: Long ->
            encode(readSchnorrBuffer("schnorrKeyshareChainCode") { schnorr_keyshare_chaincode(getSchnorr(handle), it) })
        }

        Function("freeSchnorrKeyshare") { handle: Long ->
            // Schnorr SWIG bindings have no keyshare_free; rely on Handle's SWIG destructor.
            schnorrHandles.remove(handle)?.delete()
        }

        // =====================================================================
        // Schnorr — QC (Reshare)
        // =====================================================================

        Function("schnorrQcSetup") { keyshareHandle: Long, ids: List<String>, oldPartiesB64: String, newThreshold: Int, newPartiesB64: String ->
            val buf = SchnorrBuffer()
            try {
                val ks = getSchnorr(keyshareHandle)
                val idsSlice = encodeIds(ids).toSchnorrSlice()
                val oldSlice = decode(oldPartiesB64).toSchnorrSlice()
                val newSlice = decode(newPartiesB64).toSchnorrSlice()
                val err = schnorr_qc_setupmsg_new(ks, idsSlice, oldSlice, newThreshold.toLong(), newSlice, buf)
                if (err != SCHNORR_LIB_OK) schnorrFail("schnorrQcSetup", err)
                encode(SchnorrBufferUtil.get_bytes_from_tss_buffer(buf))
            } finally {
                schnorrTssBufferFree(buf)
            }
        }

        Function("createSchnorrQcSession") { setupB64: String, localPartyId: String, keyshareHandle: Long? ->
            val session = SchnorrHandle()
            // Sentinel Handle with `_0 = -1` for old-party / no-keyshare reshare participants;
            // mirrors iOS `Handle(_0: Int32(keyshareHandle ?? -1))`.
            val ks = if (keyshareHandle != null) {
                getSchnorr(keyshareHandle)
            } else {
                SchnorrHandle().apply { set_0(-1) }
            }
            val setupSlice = decode(setupB64).toSchnorrSlice()
            val idSlice = localPartyId.toByteArray(Charsets.UTF_8).toSchnorrSlice()
            val err = schnorr_qc_session_from_setup(setupSlice, idSlice, ks, session)
            if (err != SCHNORR_LIB_OK) schnorrFail("createSchnorrQcSession", err)
            storeSchnorr(session)
        }

        Function("schnorrQcSessionOutputMessage") { sessionHandle: Long ->
            readSchnorrOutput("schnorrQcSessionOutputMessage", sessionHandle) { h, buf ->
                schnorr_qc_session_output_message(h, buf)
            }
        }

        Function("schnorrQcSessionMessageReceiver") { sessionHandle: Long, messageB64: String, index: Int ->
            val buf = SchnorrBuffer()
            try {
                val h = getSchnorr(sessionHandle)
                val msgSlice = decode(messageB64).toSchnorrSlice()
                val err = schnorr_qc_session_message_receiver(h, msgSlice, index.toLong(), buf)
                if (err != SCHNORR_LIB_OK) schnorrFail("schnorrQcSessionMessageReceiver", err)
                String(SchnorrBufferUtil.get_bytes_from_tss_buffer(buf), Charsets.UTF_8)
            } finally {
                schnorrTssBufferFree(buf)
            }
        }

        Function("schnorrQcSessionInputMessage") { sessionHandle: Long, messageB64: String ->
            val h = getSchnorr(sessionHandle)
            val isFinished = intArrayOf(0)
            val msgSlice = decode(messageB64).toSchnorrSlice()
            val err = schnorr_qc_session_input_message(h, msgSlice, isFinished)
            if (err != SCHNORR_LIB_OK) schnorrFail("schnorrQcSessionInputMessage", err)
            isFinished[0] != 0
        }

        Function("finishSchnorrQc") { sessionHandle: Long ->
            val session = getSchnorr(sessionHandle)
            val newKeyshare = SchnorrHandle()
            val err = schnorr_qc_session_finish(session, newKeyshare)
            if (err != SCHNORR_LIB_OK) {
                android.util.Log.i("ExpoMpcNative", "finishSchnorrQc: no new keyshare for session $sessionHandle (err=$err) - likely an old-party exit")
                -1L
            } else {
                storeSchnorr(newKeyshare)
            }
        }

        Function("freeSchnorrQcSession") { sessionHandle: Long ->
            schnorrHandles.remove(sessionHandle)?.let { schnorr_qc_session_free(it) }
        }

        // =====================================================================
        // Schnorr — Key Import
        // =====================================================================

        Function("createSchnorrKeyImportInitiator") { privateKeyHex: String, rootChainCodeHex: String?, threshold: Int, ids: List<String> ->
            val buf = SchnorrBuffer()
            try {
                val session = SchnorrHandle()
                val pkSlice = decodeHex(privateKeyHex).toSchnorrSlice()
                val ccSlice = if (rootChainCodeHex != null) decodeHex(rootChainCodeHex).toSchnorrSlice() else null
                val idsSlice = encodeIds(ids).toSchnorrSlice()
                val err = schnorr_key_import_initiator_new(pkSlice, ccSlice, threshold.toShort(), idsSlice, buf, session)
                if (err != SCHNORR_LIB_OK) schnorrFail("createSchnorrKeyImportInitiator", err)
                mapOf(
                    "sessionHandle" to storeSchnorr(session),
                    "setupMessage" to encode(SchnorrBufferUtil.get_bytes_from_tss_buffer(buf)),
                )
            } finally {
                schnorrTssBufferFree(buf)
            }
        }

        AsyncFunction("createSchnorrKeyImportSession") { setupB64: String, localPartyId: String ->
            val session = SchnorrHandle()
            val setupSlice = decode(setupB64).toSchnorrSlice()
            val idSlice = localPartyId.toByteArray(Charsets.UTF_8).toSchnorrSlice()
            val err = schnorr_key_importer_new(setupSlice, idSlice, session)
            if (err != SCHNORR_LIB_OK) schnorrFail("createSchnorrKeyImportSession", err)
            storeSchnorr(session)
        }
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    private fun ByteArray.toDklsSlice(): DklsGoSlice {
        val slice = DklsGoSlice()
        DklsBufferUtil.set_bytes_on_go_slice(slice, this)
        return slice
    }

    private fun ByteArray.toSchnorrSlice(): SchnorrGoSlice {
        val slice = SchnorrGoSlice()
        SchnorrBufferUtil.set_bytes_on_go_slice(slice, this)
        return slice
    }

    private inline fun readDklsBuffer(op: String, block: (DklsBuffer) -> Any): ByteArray {
        val buf = DklsBuffer()
        try {
            val err = block(buf)
            if (err != DKLS_LIB_OK) dklsFail(op, err)
            return DklsBufferUtil.get_bytes_from_tss_buffer(buf)
        } finally {
            dklsTssBufferFree(buf)
        }
    }

    private inline fun readSchnorrBuffer(op: String, block: (SchnorrBuffer) -> Any): ByteArray {
        val buf = SchnorrBuffer()
        try {
            val err = block(buf)
            if (err != SCHNORR_LIB_OK) schnorrFail(op, err)
            return SchnorrBufferUtil.get_bytes_from_tss_buffer(buf)
        } finally {
            schnorrTssBufferFree(buf)
        }
    }

    /** Reads an output message from a DKLS session. Returns null on empty or non-OK (session not ready). */
    private inline fun readDklsOutput(op: String, sessionHandle: Long, block: (DklsHandle, DklsBuffer) -> Any): String? {
        val buf = DklsBuffer()
        try {
            val h = getDkls(sessionHandle)
            val err = block(h, buf)
            if (err != DKLS_LIB_OK) return null
            val data = DklsBufferUtil.get_bytes_from_tss_buffer(buf)
            return if (data.isEmpty()) null else encode(data)
        } catch (e: Exception) {
            android.util.Log.e("ExpoMpcNative", "$op failed for session $sessionHandle: ${e.message}", e)
            return null
        } finally {
            dklsTssBufferFree(buf)
        }
    }

    private inline fun readSchnorrOutput(op: String, sessionHandle: Long, block: (SchnorrHandle, SchnorrBuffer) -> Any): String? {
        val buf = SchnorrBuffer()
        try {
            val h = getSchnorr(sessionHandle)
            val err = block(h, buf)
            if (err != SCHNORR_LIB_OK) return null
            val data = SchnorrBufferUtil.get_bytes_from_tss_buffer(buf)
            return if (data.isEmpty()) null else encode(data)
        } catch (e: Exception) {
            android.util.Log.e("ExpoMpcNative", "$op failed for session $sessionHandle: ${e.message}", e)
            return null
        } finally {
            schnorrTssBufferFree(buf)
        }
    }

    private inline fun readDklsOptional(op: String, b64: String, block: (DklsGoSlice, DklsBuffer) -> Any): String? {
        val buf = DklsBuffer()
        try {
            val slice = decode(b64).toDklsSlice()
            val err = block(slice, buf)
            if (err != DKLS_LIB_OK) return null
            val data = DklsBufferUtil.get_bytes_from_tss_buffer(buf)
            return if (data.isEmpty()) null else encode(data)
        } catch (e: Exception) {
            android.util.Log.e("ExpoMpcNative", "$op failed: ${e.message}", e)
            return null
        } finally {
            dklsTssBufferFree(buf)
        }
    }

    private inline fun readSchnorrOptional(op: String, b64: String, block: (SchnorrGoSlice, SchnorrBuffer) -> Any): String? {
        val buf = SchnorrBuffer()
        try {
            val slice = decode(b64).toSchnorrSlice()
            val err = block(slice, buf)
            if (err != SCHNORR_LIB_OK) return null
            val data = SchnorrBufferUtil.get_bytes_from_tss_buffer(buf)
            return if (data.isEmpty()) null else encode(data)
        } catch (e: Exception) {
            android.util.Log.e("ExpoMpcNative", "$op failed: ${e.message}", e)
            return null
        } finally {
            schnorrTssBufferFree(buf)
        }
    }

    private fun dklsFail(op: String, err: Any): Nothing =
        throw CodedException("DklsError", "$op failed (code: $err)", null)

    private fun schnorrFail(op: String, err: Any): Nothing =
        throw CodedException("SchnorrError", "$op failed (code: $err)", null)

    private fun encode(bytes: ByteArray): String = Base64.encode(bytes)
    private fun decode(b64: String): ByteArray = Base64.decode(b64)
    private fun encodeHex(bytes: ByteArray): String = bytes.toHexString()

    private fun decodeHex(hex: String): ByteArray {
        val clean = if (hex.startsWith("0x")) hex.substring(2) else hex
        require(clean.length % 2 == 0) { "Hex string must have even length, got ${clean.length}" }
        return clean.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
    }

    /** Encode party IDs as null-separated UTF-8 bytes (no trailing null). */
    private fun encodeIds(ids: List<String>): ByteArray {
        if (ids.isEmpty()) return ByteArray(0)
        val out = mutableListOf<Byte>()
        for ((i, id) in ids.withIndex()) {
            out.addAll(id.toByteArray(Charsets.UTF_8).toList())
            if (i < ids.lastIndex) out.add(0)
        }
        return out.toByteArray()
    }
}
