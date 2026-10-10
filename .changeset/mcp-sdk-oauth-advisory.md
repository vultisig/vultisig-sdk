---
'@vultisig/mcp': patch
---

Bump `@modelcontextprotocol/sdk` to `~1.31.0` to clear GHSA-6qxp-vccf-f47h, where the SDK's OAuth client could send credentials to an authorization server chosen by the MCP server. The MCP server only uses `McpServer` and `StdioServerTransport`, so it never reached the affected client code, but installs of `@vultisig/mcp` no longer pull in the flagged range.
