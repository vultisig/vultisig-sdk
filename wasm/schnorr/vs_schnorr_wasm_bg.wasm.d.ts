/* tslint:disable */
/* eslint-disable */
export const memory: WebAssembly.Memory;
export const __wbg_keyimportinitiator_free: (a: number, b: number) => void;
export const keyimportinitiator_new: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
export const keyimportinitiator_setup: (a: number) => [number, number];
export const keyimportinitiator_outputMessage: (a: number) => number;
export const keyimportinitiator_inputMessage: (a: number, b: number, c: number) => number;
export const keyimportinitiator_finish: (a: number) => [number, number, number];
export const __wbg_keyexportsession_free: (a: number, b: number) => void;
export const keyexportsession_new: (a: number, b: number, c: number) => number;
export const keyexportsession_setup: (a: number) => [number, number];
export const keyexportsession_inputMessage: (a: number, b: number, c: number) => number;
export const keyexportsession_finish: (a: number) => [number, number, number, number];
export const keyexportsession_exportShare: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
export const __wbg_signsession_free: (a: number, b: number) => void;
export const signsession_new: (a: any, b: number, c: number, d: number) => [number, number, number];
export const signsession_setup: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
export const signsession_setupMessageHash: (a: number, b: number) => [number, number];
export const signsession_setupKeyId: (a: number, b: number) => [number, number];
export const signsession_outputMessage: (a: number) => number;
export const signsession_inputMessage: (a: number, b: number, c: number) => number;
export const signsession_finish: (a: number) => [number, number, number, number];
export const __wbg_keyimportersession_free: (a: number, b: number) => void;
export const keyimportsession_new: (a: number, b: number, c: number, d: number) => [number, number, number];
export const keyimportsession_outputMessage: (a: number) => number;
export const keyimportsession_inputMessage: (a: number, b: number, c: number) => number;
export const keyimportsession_finish: (a: number) => [number, number, number];
export const __wbg_message_free: (a: number, b: number) => void;
export const message_body: (a: number) => [number, number];
export const message_receivers: (a: number) => [number, number];
export const __wbg_qcsession_free: (a: number, b: number) => void;
export const qcsession_new: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
export const qcsession_setup: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
export const qcsession_setupKeyId: (a: number, b: number) => [number, number];
export const qcsession_outputMessage: (a: number) => number;
export const qcsession_inputMessage: (a: number, b: number, c: number) => number;
export const qcsession_finish: (a: number) => [number, number, number];
export const __wbg_keygensession_free: (a: number, b: number) => void;
export const keygensession_new: (a: number, b: number, c: number, d: number) => [number, number, number];
export const keygensession_refresh: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
export const keygensession_migrate: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number, number];
export const keygensession_setup: (a: number, b: number, c: number, d: number, e: number) => [number, number];
export const keygensession_setupKeyId: (a: number, b: number) => [number, number];
export const keygensession_outputMessage: (a: number) => number;
export const keygensession_inputMessage: (a: number, b: number, c: number) => number;
export const keygensession_finish: (a: number) => [number, number, number];
export const __wbg_keyshare_free: (a: number, b: number) => void;
export const keyshare_publicKey: (a: number) => [number, number];
export const keyshare_keyId: (a: number) => [number, number];
export const keyshare_toBytes: (a: number) => [number, number];
export const keyshare_fromBytes: (a: number, b: number) => [number, number, number];
export const keyshare_rootChainCode: (a: number) => [number, number];
export const __wbindgen_exn_store: (a: number) => void;
export const __externref_table_alloc: () => number;
export const __wbindgen_export_2: WebAssembly.Table;
export const __wbindgen_malloc: (a: number, b: number) => number;
export const __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
export const __externref_table_dealloc: (a: number) => void;
export const __wbindgen_free: (a: number, b: number, c: number) => void;
export const __externref_drop_slice: (a: number, b: number) => void;
export const __wbindgen_start: () => void;
