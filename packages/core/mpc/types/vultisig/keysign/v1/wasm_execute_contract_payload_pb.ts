/**
 * Compatibility export for the shared signing protobuf definitions.
 *
 * The canonical generated source lives in the leaf @vultisig/mpc-types
 * package so core-chain and core-mpc can consume it without a package cycle.
 */
export * from "@vultisig/mpc-types/types/vultisig/keysign/v1/wasm_execute_contract_payload_pb";
