---
"@vultisig/core-mpc": patch
---

Match iOS Sui send coin selection by bounding native inputs to the largest
objects covering amount plus gas, selecting token inputs by largest covering
objects, and choosing a native gas object that covers token-send gas.
