---
'@vultisig/mcp': patch
---

Bump `@modelcontextprotocol/sdk` to `~1.32.1` to clear GHSA-22jm-h49p-29qw, where experimental tasks were not tied to the session that created them. The MCP server only uses `McpServer` and `StdioServerTransport`, so it never reached the affected task code, but installs of `@vultisig/mcp` no longer pull in the flagged range.
