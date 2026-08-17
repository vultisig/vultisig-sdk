---
"@vultisig/cli": patch
---

Validate ERC-20 transfer recipient AND amount from calldata before agent signing consent; render the consent amount from the signed calldata (trusted decimals when the token is known, raw base units with an unverified marker otherwise) so a producer label cannot understate the amount.
