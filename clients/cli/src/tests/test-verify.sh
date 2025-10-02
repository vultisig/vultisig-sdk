#!/bin/bash

echo "🧪 Testing Verify Command"
echo "=========================="
echo ""

VAULT_ID="03ac0f333fc5d22f929e013be80988f57a56837db64d968c126ca4c943984744fd"

echo "Test 1: Correct password (should return YES)"
echo "--------------------------------------------"
../../bin/vultisig verify --vault-id $VAULT_ID --password "Password123!"
echo ""

echo "Test 2: Incorrect password (should return NO)"
echo "---------------------------------------------"
../../bin/vultisig verify --vault-id $VAULT_ID --password "Password123"
echo ""

echo "✅ Test completed"

