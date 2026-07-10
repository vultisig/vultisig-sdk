---
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

fix(mpc): keep keygen tracing off stdout so `-o json` output stays parseable

The DKLS and Schnorr keygen/reshare/key-import ceremonies logged progress
(session ids, raw wire messages, "keygen complete", …) to stdout via ungated
`console.log`. stdout is the machine channel for the CLI's `-o json` mode, so
the documented `create fast … -o json` agent flow produced unparseable stdout
(`JSON.parse(stdout)` failed on the leading garbage) and leaked MPC internals
into terminals and CI logs.

Route that tracing through a gated logger that writes to stderr only when
`VULTISIG_DEBUG=1`, so stdout carries only the final JSON envelope while
the debug output stays available to humans on demand. No keygen behavior
changes — only the log sink moves off stdout.
