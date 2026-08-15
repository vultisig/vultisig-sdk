---
'@vultisig/cli': patch
---

`create-from-seedphrase fast` now validates mnemonic word count before the interactive email-OTP gate, so a non-interactive `-o json` call with a malformed mnemonic fails closed with a mnemonic-validation error instead of `CONFIRMATION_REQUIRED`. A shape-valid mnemonic still requires interactive OTP entry — unchanged.
