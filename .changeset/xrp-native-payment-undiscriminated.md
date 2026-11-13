---
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

Leave a native XRP send's `transaction_type` unset instead of declaring it `RIPPLE_PAYMENT`. iOS and Android co-signers that predate `RIPPLE_PAYMENT` refused every XRP send started from the SDK or Windows ("XRP payload carries an unsupported transaction type (11)"). Native XRP signs the same bytes either way; issued-currency Payments still declare `RIPPLE_PAYMENT`.
