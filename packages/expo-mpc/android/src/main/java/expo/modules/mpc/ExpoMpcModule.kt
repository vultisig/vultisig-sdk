@file:OptIn(ExperimentalEncodingApi::class, ExperimentalStdlibApi::class)

package expo.modules.mpc

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.exception.CodedException

import com.silencelaboratories.godkls.BufferUtilJNI
import com.silencelaboratories.godkls.Handle
import com.silencelaboratories.godkls.go_slice
import com.silencelaboratories.godkls.godkls.dkls_keygen_setupmsg_new
import com.silencelaboratories.godkls.godkls.dkls_keygen_session_from_setup
import com.silencelaboratories.godkls.godkls.dkls_keygen_session_output_message
import com.silencelaboratories.godkls.godkls.dkls_keygen_session_message_receiver
import com.silencelaboratories.godkls.godkls.dkls_keygen_session_input_message
import com.silencelaboratories.godkls.godkls.dkls_keygen_session_finish
import com.silencelaboratories.godkls.godkls.dkls_keyshare_to_bytes
import com.silencelaboratories.godkls.godkls.dkls_keyshare_public_key
import com.silencelaboratories.godkls.godkls.dkls_keyshare_chaincode
import com.silencelaboratories.godkls.godkls.dkls_keyshare_from_bytes
import com.silencelaboratories.godkls.godkls.dkls_keyshare_key_id
import com.silencelaboratories.godkls.godkls.dkls_sign_setupmsg_new
import com.silencelaboratories.godkls.godkls.dkls_sign_session_from_setup
import com.silencelaboratories.godkls.godkls.dkls_sign_session_output_message
import com.silencelaboratories.godkls.godkls.dkls_sign_session_message_receiver
import com.silencelaboratories.godkls.godkls.dkls_sign_session_input_message
import com.silencelaboratories.godkls.godkls.dkls_sign_session_finish
import com.silencelaboratories.godkls.godkls.dkls_key_import_initiator_new
import com.silencelaboratories.godkls.godkls.tss_buffer_free
import com.silencelaboratories.godkls.lib_error.LIB_OK
import com.silencelaboratories.godkls.tss_buffer

import com.silencelaboratories.goschnorr.goschnorr.schnorr_keygen_session_from_setup
import com.silencelaboratories.goschnorr.goschnorr.schnorr_keygen_session_output_message
import com.silencelaboratories.goschnorr.goschnorr.schnorr_keygen_session_message_receiver
import com.silencelaboratories.goschnorr.goschnorr.schnorr_keygen_session_input_message
import com.silencelaboratories.goschnorr.goschnorr.schnorr_keygen_session_finish
import com.silencelaboratories.goschnorr.goschnorr.schnorr_keyshare_to_bytes
import com.silencelaboratories.goschnorr.goschnorr.schnorr_keyshare_public_key
import com.silencelaboratories.goschnorr.goschnorr.schnorr_keyshare_from_bytes
import com.silencelaboratories.goschnorr.goschnorr.schnorr_keyshare_key_id
import com.silencelaboratories.goschnorr.goschnorr.schnorr_sign_setupmsg_new
import com.silencelaboratories.goschnorr.goschnorr.schnorr_sign_session_from_setup
import com.silencelaboratories.goschnorr.goschnorr.schnorr_sign_session_output_message
import com.silencelaboratories.goschnorr.goschnorr.schnorr_sign_session_message_receiver
import com.silencelaboratories.goschnorr.goschnorr.schnorr_sign_session_input_message
import com.silencelaboratories.goschnorr.goschnorr.schnorr_sign_session_finish
import com.silencelaboratories.goschnorr.goschnorr.schnorr_key_import_initiator_new
import com.silencelaboratories.goschnorr.schnorr_lib_error.LIB_OK as SCHNORR_LIB_OK

import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi

class ExpoMpcModule : Module() {
  companion object {
    init {
      System.loadLibrary("godklsswig")
      System.loadLibrary("goschnorrswig")
    }
  }

  private var nextHandleId = 1
  private val dklsHandles = mutableMapOf<Int, Handle>()
  private val schnorrHandles = mutableMapOf<Int, com.silencelaboratories.goschnorr.Handle>()

  private fun storeDklsHandle(handle: Handle): Int {
    val id = nextHandleId++
    dklsHandles[id] = handle
    return id
  }

  private fun getDklsHandle(id: Int): Handle {
    return dklsHandles[id] ?: throw CodedException("DklsError", "Invalid handle ID: $id", null)
  }

  private fun storeSchnorrHandle(handle: com.silencelaboratories.goschnorr.Handle): Int {
    val id = nextHandleId++
    schnorrHandles[id] = handle
    return id
  }

  private fun getSchnorrHandle(id: Int): com.silencelaboratories.goschnorr.Handle {
    return schnorrHandles[id] ?: throw CodedException("SchnorrError", "Invalid handle ID: $id", null)
  }

  private fun partyIdsToBytes(partyIds: List<String>): ByteArray {
    if (partyIds.isEmpty()) return byteArrayOf()
    val bytes = mutableListOf<Byte>()
    for (id in partyIds) {
      bytes.addAll(id.toByteArray(Charsets.UTF_8).toList())
      bytes.add(0)
    }
    if (bytes.last() == 0.toByte()) {
      bytes.removeAt(bytes.size - 1)
    }
    return bytes.toByteArray()
  }

  private fun hexToBytes(hex: String): ByteArray {
    val clean = if (hex.startsWith("0x")) hex.substring(2) else hex
    return clean.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
  }

  private fun ByteArray.toGoSlice(): go_slice {
    val slice = go_slice()
    BufferUtilJNI.set_bytes_on_go_slice(slice, this)
    return slice
  }

  private fun ByteArray.toSchnorrGoSlice(): com.silencelaboratories.goschnorr.go_slice {
    val slice = com.silencelaboratories.goschnorr.go_slice()
    com.silencelaboratories.goschnorr.BufferUtilJNI.set_bytes_on_go_slice(slice, this)
    return slice
  }

  override fun definition() = ModuleDefinition {
    Name("ExpoMpc")

    Function("isAvailable") { true }

    // === DKLS (ECDSA) KEYGEN ===

    AsyncFunction("createKeygenSetupMessage") { threshold: Int, partyIds: List<String> ->
      val buf = tss_buffer()
      try {
        val ids = partyIdsToBytes(partyIds).toGoSlice()
        val err = dkls_keygen_setupmsg_new(threshold.toLong(), null, ids, buf)
        if (err != LIB_OK) {
          throw CodedException("DklsError", "Keygen setup failed (code: $err)", null)
        }
        Base64.encode(BufferUtilJNI.get_bytes_from_tss_buffer(buf))
      } finally {
        tss_buffer_free(buf)
      }
    }

    AsyncFunction("createKeygenSession") { setupBase64: String, localPartyId: String ->
      val handle = Handle()
      val err = dkls_keygen_session_from_setup(
        Base64.decode(setupBase64).toGoSlice(),
        localPartyId.toByteArray(Charsets.UTF_8).toGoSlice(),
        handle
      )
      if (err != LIB_OK) {
        throw CodedException("DklsError", "Session create failed (code: $err)", null)
      }
      storeDklsHandle(handle)
    }

    // Hot-path: synchronous
    Function("getOutboundMessage") { handleId: Int ->
      val buf = tss_buffer()
      try {
        val err = dkls_keygen_session_output_message(getDklsHandle(handleId), buf)
        if (err != LIB_OK) return@Function null
        val data = BufferUtilJNI.get_bytes_from_tss_buffer(buf)
        if (data.isEmpty()) return@Function null
        Base64.encode(data)
      } finally {
        tss_buffer_free(buf)
      }
    }

    // Hot-path: synchronous
    Function("getMessageReceiver") { handleId: Int, messageBase64: String, index: Int ->
      val buf = tss_buffer()
      try {
        val err = dkls_keygen_session_message_receiver(
          getDklsHandle(handleId),
          Base64.decode(messageBase64).toGoSlice(),
          index.toLong(),
          buf
        )
        if (err != LIB_OK) return@Function null
        val data = BufferUtilJNI.get_bytes_from_tss_buffer(buf)
        if (data.isEmpty()) return@Function null
        String(data, Charsets.UTF_8)
      } finally {
        tss_buffer_free(buf)
      }
    }

    // Hot-path: synchronous
    Function("inputMessage") { handleId: Int, messageBase64: String ->
      val isFinished = intArrayOf(0)
      val err = dkls_keygen_session_input_message(
        getDklsHandle(handleId),
        Base64.decode(messageBase64).toGoSlice(),
        isFinished
      )
      if (err != LIB_OK) {
        throw CodedException("DklsError", "Input message failed (code: $err)", null)
      }
      isFinished[0] != 0
    }

    AsyncFunction("finishKeygen") { handleId: Int ->
      val keyshareHandle = Handle()
      val finishErr = dkls_keygen_session_finish(getDklsHandle(handleId), keyshareHandle)
      if (finishErr != LIB_OK) {
        throw CodedException("DklsError", "Keygen finish failed (code: $finishErr)", null)
      }

      val ksBuf = tss_buffer()
      val ksErr = dkls_keyshare_to_bytes(keyshareHandle, ksBuf)
      if (ksErr != LIB_OK) {
        tss_buffer_free(ksBuf)
        throw CodedException("DklsError", "Keyshare serialize failed (code: $ksErr)", null)
      }
      val keyshareB64 = Base64.encode(BufferUtilJNI.get_bytes_from_tss_buffer(ksBuf))
      tss_buffer_free(ksBuf)

      val pkBuf = tss_buffer()
      val pkErr = dkls_keyshare_public_key(keyshareHandle, pkBuf)
      if (pkErr != LIB_OK) {
        tss_buffer_free(pkBuf)
        throw CodedException("DklsError", "Public key extract failed (code: $pkErr)", null)
      }
      val publicKeyHex = BufferUtilJNI.get_bytes_from_tss_buffer(pkBuf).toHexString()
      tss_buffer_free(pkBuf)

      val ccBuf = tss_buffer()
      val ccErr = dkls_keyshare_chaincode(keyshareHandle, ccBuf)
      if (ccErr != LIB_OK) {
        tss_buffer_free(ccBuf)
        throw CodedException("DklsError", "Chain code extract failed (code: $ccErr)", null)
      }
      val chainCodeHex = BufferUtilJNI.get_bytes_from_tss_buffer(ccBuf).toHexString()
      tss_buffer_free(ccBuf)

      storeDklsHandle(keyshareHandle)

      mapOf(
        "keyshare" to keyshareB64,
        "publicKey" to publicKeyHex,
        "chainCode" to chainCodeHex,
      )
    }

    // === DKLS KEY IMPORT ===

    AsyncFunction("createDklsKeyImportSession") { privateKeyHex: String, chainCodeHex: String, threshold: Int, partyIds: List<String> ->
      val buf = tss_buffer()
      try {
        val handle = Handle()
        val err = dkls_key_import_initiator_new(
          hexToBytes(privateKeyHex).toGoSlice(),
          hexToBytes(chainCodeHex).toGoSlice(),
          threshold.toShort(),
          partyIdsToBytes(partyIds).toGoSlice(),
          buf,
          handle
        )
        if (err != LIB_OK) {
          throw CodedException("DklsError", "DKLS key import session failed (code: $err)", null)
        }
        mapOf(
          "setupMessage" to Base64.encode(BufferUtilJNI.get_bytes_from_tss_buffer(buf)),
          "sessionHandle" to storeDklsHandle(handle),
        )
      } finally {
        tss_buffer_free(buf)
      }
    }

    AsyncFunction("createSchnorrKeyImportSession") { privateKeyHex: String, chainCodeHex: String, threshold: Int, partyIds: List<String> ->
      val buf = com.silencelaboratories.goschnorr.tss_buffer()
      try {
        val handle = com.silencelaboratories.goschnorr.Handle()
        val err = schnorr_key_import_initiator_new(
          hexToBytes(privateKeyHex).toSchnorrGoSlice(),
          hexToBytes(chainCodeHex).toSchnorrGoSlice(),
          threshold.toShort(),
          partyIdsToBytes(partyIds).toSchnorrGoSlice(),
          buf,
          handle
        )
        if (err != SCHNORR_LIB_OK) {
          throw CodedException("SchnorrError", "Schnorr key import session failed (code: $err)", null)
        }
        mapOf(
          "setupMessage" to Base64.encode(com.silencelaboratories.goschnorr.BufferUtilJNI.get_bytes_from_tss_buffer(buf)),
          "sessionHandle" to storeSchnorrHandle(handle),
        )
      } finally {
        com.silencelaboratories.goschnorr.goschnorr.tss_buffer_free(buf)
      }
    }

    Function("freeKeygenSession") { handleId: Int -> dklsHandles.remove(handleId) }
    Function("freeKeyshare") { handleId: Int -> dklsHandles.remove(handleId) }

    // === DKLS (ECDSA) KEYSIGN ===

    Function("loadKeyshare") { keyshareBase64: String ->
      val handle = Handle()
      val err = dkls_keyshare_from_bytes(Base64.decode(keyshareBase64).toGoSlice(), handle)
      if (err != LIB_OK) {
        throw CodedException("DklsError", "Load keyshare failed (code: $err)", null)
      }
      storeDklsHandle(handle)
    }

    Function("getKeyshareKeyId") { handleId: Int ->
      val buf = tss_buffer()
      try {
        val err = dkls_keyshare_key_id(getDklsHandle(handleId), buf)
        if (err != LIB_OK) {
          throw CodedException("DklsError", "Get key ID failed (code: $err)", null)
        }
        Base64.encode(BufferUtilJNI.get_bytes_from_tss_buffer(buf))
      } finally {
        tss_buffer_free(buf)
      }
    }

    Function("createSignSetupMessage") { keyIdBase64: String, chainPath: String, messageHashHex: String, partyIds: List<String> ->
      val buf = tss_buffer()
      try {
        val err = dkls_sign_setupmsg_new(
          Base64.decode(keyIdBase64).toGoSlice(),
          chainPath.toByteArray(Charsets.UTF_8).toGoSlice(),
          hexToBytes(messageHashHex).toGoSlice(),
          partyIdsToBytes(partyIds).toGoSlice(),
          buf
        )
        if (err != LIB_OK) {
          throw CodedException("DklsError", "Sign setup failed (code: $err)", null)
        }
        Base64.encode(BufferUtilJNI.get_bytes_from_tss_buffer(buf))
      } finally {
        tss_buffer_free(buf)
      }
    }

    Function("createSignSession") { setupBase64: String, localPartyId: String, keyshareHandleId: Int ->
      val handle = Handle()
      val err = dkls_sign_session_from_setup(
        Base64.decode(setupBase64).toGoSlice(),
        localPartyId.toByteArray(Charsets.UTF_8).toGoSlice(),
        getDklsHandle(keyshareHandleId),
        handle
      )
      if (err != LIB_OK) {
        throw CodedException("DklsError", "Sign session create failed (code: $err)", null)
      }
      storeDklsHandle(handle)
    }

    // Hot-path: synchronous
    Function("getSignOutboundMessage") { handleId: Int ->
      val buf = tss_buffer()
      try {
        val err = dkls_sign_session_output_message(getDklsHandle(handleId), buf)
        if (err != LIB_OK) return@Function null
        val data = BufferUtilJNI.get_bytes_from_tss_buffer(buf)
        if (data.isEmpty()) return@Function null
        Base64.encode(data)
      } finally {
        tss_buffer_free(buf)
      }
    }

    // Hot-path: synchronous
    Function("getSignMessageReceiver") { handleId: Int, messageBase64: String, index: Int ->
      val buf = tss_buffer()
      try {
        val err = dkls_sign_session_message_receiver(
          getDklsHandle(handleId),
          Base64.decode(messageBase64).toGoSlice(),
          index.toLong(),
          buf
        )
        if (err != LIB_OK) return@Function null
        val data = BufferUtilJNI.get_bytes_from_tss_buffer(buf)
        if (data.isEmpty()) return@Function null
        String(data, Charsets.UTF_8)
      } finally {
        tss_buffer_free(buf)
      }
    }

    // Hot-path: synchronous
    Function("inputSignMessage") { handleId: Int, messageBase64: String ->
      val isFinished = intArrayOf(0)
      val err = dkls_sign_session_input_message(
        getDklsHandle(handleId),
        Base64.decode(messageBase64).toGoSlice(),
        isFinished
      )
      if (err != LIB_OK) {
        throw CodedException("DklsError", "Sign input message failed (code: $err)", null)
      }
      isFinished[0] != 0
    }

    Function("finishSign") { handleId: Int ->
      val buf = tss_buffer()
      try {
        val err = dkls_sign_session_finish(getDklsHandle(handleId), buf)
        if (err != LIB_OK) {
          throw CodedException("DklsError", "Sign finish failed (code: $err)", null)
        }
        BufferUtilJNI.get_bytes_from_tss_buffer(buf).toHexString()
      } finally {
        tss_buffer_free(buf)
      }
    }

    Function("freeSignSession") { handleId: Int -> dklsHandles.remove(handleId) }

    // === SCHNORR (EdDSA) KEYGEN ===

    AsyncFunction("createSchnorrKeygenSession") { setupBase64: String, localPartyId: String ->
      val handle = com.silencelaboratories.goschnorr.Handle()
      val err = schnorr_keygen_session_from_setup(
        Base64.decode(setupBase64).toSchnorrGoSlice(),
        localPartyId.toByteArray(Charsets.UTF_8).toSchnorrGoSlice(),
        handle
      )
      if (err != SCHNORR_LIB_OK) {
        throw CodedException("SchnorrError", "Schnorr session create failed (code: $err)", null)
      }
      storeSchnorrHandle(handle)
    }

    // Hot-path: synchronous
    Function("getSchnorrOutboundMessage") { handleId: Int ->
      val buf = com.silencelaboratories.goschnorr.tss_buffer()
      try {
        val err = schnorr_keygen_session_output_message(getSchnorrHandle(handleId), buf)
        if (err != SCHNORR_LIB_OK) return@Function null
        val data = com.silencelaboratories.goschnorr.BufferUtilJNI.get_bytes_from_tss_buffer(buf)
        if (data.isEmpty()) return@Function null
        Base64.encode(data)
      } finally {
        com.silencelaboratories.goschnorr.goschnorr.tss_buffer_free(buf)
      }
    }

    // Hot-path: synchronous
    Function("getSchnorrMessageReceiver") { handleId: Int, messageBase64: String, index: Int ->
      val buf = com.silencelaboratories.goschnorr.tss_buffer()
      try {
        val err = schnorr_keygen_session_message_receiver(
          getSchnorrHandle(handleId),
          Base64.decode(messageBase64).toSchnorrGoSlice(),
          index.toLong(),
          buf
        )
        if (err != SCHNORR_LIB_OK) return@Function null
        val data = com.silencelaboratories.goschnorr.BufferUtilJNI.get_bytes_from_tss_buffer(buf)
        if (data.isEmpty()) return@Function null
        String(data, Charsets.UTF_8)
      } finally {
        com.silencelaboratories.goschnorr.goschnorr.tss_buffer_free(buf)
      }
    }

    // Hot-path: synchronous
    Function("inputSchnorrMessage") { handleId: Int, messageBase64: String ->
      val isFinished = intArrayOf(0)
      val err = schnorr_keygen_session_input_message(
        getSchnorrHandle(handleId),
        Base64.decode(messageBase64).toSchnorrGoSlice(),
        isFinished
      )
      if (err != SCHNORR_LIB_OK) {
        throw CodedException("SchnorrError", "Schnorr input message failed (code: $err)", null)
      }
      isFinished[0] != 0
    }

    AsyncFunction("finishSchnorrKeygen") { handleId: Int ->
      val keyshareHandle = com.silencelaboratories.goschnorr.Handle()
      val finishErr = schnorr_keygen_session_finish(getSchnorrHandle(handleId), keyshareHandle)
      if (finishErr != SCHNORR_LIB_OK) {
        throw CodedException("SchnorrError", "Schnorr keygen finish failed (code: $finishErr)", null)
      }

      val ksBuf = com.silencelaboratories.goschnorr.tss_buffer()
      val ksErr = schnorr_keyshare_to_bytes(keyshareHandle, ksBuf)
      if (ksErr != SCHNORR_LIB_OK) {
        com.silencelaboratories.goschnorr.goschnorr.tss_buffer_free(ksBuf)
        throw CodedException("SchnorrError", "Schnorr keyshare serialize failed (code: $ksErr)", null)
      }
      val keyshareB64 = Base64.encode(com.silencelaboratories.goschnorr.BufferUtilJNI.get_bytes_from_tss_buffer(ksBuf))
      com.silencelaboratories.goschnorr.goschnorr.tss_buffer_free(ksBuf)

      val pkBuf = com.silencelaboratories.goschnorr.tss_buffer()
      val pkErr = schnorr_keyshare_public_key(keyshareHandle, pkBuf)
      if (pkErr != SCHNORR_LIB_OK) {
        com.silencelaboratories.goschnorr.goschnorr.tss_buffer_free(pkBuf)
        throw CodedException("SchnorrError", "Schnorr public key extract failed (code: $pkErr)", null)
      }
      val publicKeyHex = com.silencelaboratories.goschnorr.BufferUtilJNI.get_bytes_from_tss_buffer(pkBuf).toHexString()
      com.silencelaboratories.goschnorr.goschnorr.tss_buffer_free(pkBuf)

      storeSchnorrHandle(keyshareHandle)

      mapOf(
        "keyshare" to keyshareB64,
        "publicKey" to publicKeyHex,
      )
    }

    Function("freeSchnorrSession") { handleId: Int -> schnorrHandles.remove(handleId) }

    // === SCHNORR (EdDSA) KEYSIGN ===

    Function("loadSchnorrKeyshare") { keyshareBase64: String ->
      val handle = com.silencelaboratories.goschnorr.Handle()
      val err = schnorr_keyshare_from_bytes(
        Base64.decode(keyshareBase64).toSchnorrGoSlice(),
        handle
      )
      if (err != SCHNORR_LIB_OK) {
        throw CodedException("SchnorrError", "Load Schnorr keyshare failed (code: $err)", null)
      }
      storeSchnorrHandle(handle)
    }

    Function("getSchnorrKeyshareKeyId") { handleId: Int ->
      val buf = com.silencelaboratories.goschnorr.tss_buffer()
      try {
        val err = schnorr_keyshare_key_id(getSchnorrHandle(handleId), buf)
        if (err != SCHNORR_LIB_OK) {
          throw CodedException("SchnorrError", "Get Schnorr key ID failed (code: $err)", null)
        }
        Base64.encode(com.silencelaboratories.goschnorr.BufferUtilJNI.get_bytes_from_tss_buffer(buf))
      } finally {
        com.silencelaboratories.goschnorr.goschnorr.tss_buffer_free(buf)
      }
    }

    Function("createSchnorrSignSetupMessage") { keyIdBase64: String, chainPath: String, messageHashHex: String, partyIds: List<String> ->
      val buf = com.silencelaboratories.goschnorr.tss_buffer()
      try {
        val err = schnorr_sign_setupmsg_new(
          Base64.decode(keyIdBase64).toSchnorrGoSlice(),
          chainPath.toByteArray(Charsets.UTF_8).toSchnorrGoSlice(),
          hexToBytes(messageHashHex).toSchnorrGoSlice(),
          partyIdsToBytes(partyIds).toSchnorrGoSlice(),
          buf
        )
        if (err != SCHNORR_LIB_OK) {
          throw CodedException("SchnorrError", "Schnorr sign setup failed (code: $err)", null)
        }
        Base64.encode(com.silencelaboratories.goschnorr.BufferUtilJNI.get_bytes_from_tss_buffer(buf))
      } finally {
        com.silencelaboratories.goschnorr.goschnorr.tss_buffer_free(buf)
      }
    }

    Function("createSchnorrSignSession") { setupBase64: String, localPartyId: String, keyshareHandleId: Int ->
      val handle = com.silencelaboratories.goschnorr.Handle()
      val err = schnorr_sign_session_from_setup(
        Base64.decode(setupBase64).toSchnorrGoSlice(),
        localPartyId.toByteArray(Charsets.UTF_8).toSchnorrGoSlice(),
        getSchnorrHandle(keyshareHandleId),
        handle
      )
      if (err != SCHNORR_LIB_OK) {
        throw CodedException("SchnorrError", "Schnorr sign session create failed (code: $err)", null)
      }
      storeSchnorrHandle(handle)
    }

    // Hot-path: synchronous
    Function("getSchnorrSignOutboundMessage") { handleId: Int ->
      val buf = com.silencelaboratories.goschnorr.tss_buffer()
      try {
        val err = schnorr_sign_session_output_message(getSchnorrHandle(handleId), buf)
        if (err != SCHNORR_LIB_OK) return@Function null
        val data = com.silencelaboratories.goschnorr.BufferUtilJNI.get_bytes_from_tss_buffer(buf)
        if (data.isEmpty()) return@Function null
        Base64.encode(data)
      } finally {
        com.silencelaboratories.goschnorr.goschnorr.tss_buffer_free(buf)
      }
    }

    // Hot-path: synchronous
    Function("getSchnorrSignMessageReceiver") { handleId: Int, messageBase64: String, index: Int ->
      val buf = com.silencelaboratories.goschnorr.tss_buffer()
      try {
        val err = schnorr_sign_session_message_receiver(
          getSchnorrHandle(handleId),
          Base64.decode(messageBase64).toSchnorrGoSlice(),
          index.toLong(),
          buf
        )
        if (err != SCHNORR_LIB_OK) return@Function null
        val data = com.silencelaboratories.goschnorr.BufferUtilJNI.get_bytes_from_tss_buffer(buf)
        if (data.isEmpty()) return@Function null
        String(data, Charsets.UTF_8)
      } finally {
        com.silencelaboratories.goschnorr.goschnorr.tss_buffer_free(buf)
      }
    }

    // Hot-path: synchronous
    Function("inputSchnorrSignMessage") { handleId: Int, messageBase64: String ->
      val isFinished = intArrayOf(0)
      val err = schnorr_sign_session_input_message(
        getSchnorrHandle(handleId),
        Base64.decode(messageBase64).toSchnorrGoSlice(),
        isFinished
      )
      if (err != SCHNORR_LIB_OK) {
        throw CodedException("SchnorrError", "Schnorr sign input message failed (code: $err)", null)
      }
      isFinished[0] != 0
    }

    Function("finishSchnorrSign") { handleId: Int ->
      val buf = com.silencelaboratories.goschnorr.tss_buffer()
      try {
        val err = schnorr_sign_session_finish(getSchnorrHandle(handleId), buf)
        if (err != SCHNORR_LIB_OK) {
          throw CodedException("SchnorrError", "Schnorr sign finish failed (code: $err)", null)
        }
        com.silencelaboratories.goschnorr.BufferUtilJNI.get_bytes_from_tss_buffer(buf).toHexString()
      } finally {
        com.silencelaboratories.goschnorr.goschnorr.tss_buffer_free(buf)
      }
    }

    Function("freeSchnorrSignSession") { handleId: Int -> schnorrHandles.remove(handleId) }
  }
}
