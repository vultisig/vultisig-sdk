# Publishing Vultisig Skills to Skill Hubs

Guide for publishing Vultisig skills to OpenClaw (ClawHub) and Hermes so AI agents can discover and use them.

Both platforms use the same [agentskills.io](https://agentskills.io/specification) open standard. Our skill files are already in the correct format.

## Skills to Publish

| Skill | Path | Description |
|-------|------|-------------|
| `vultisig` | `skills/` | Router skill (chooses CLI vs SDK) |
| `vultisig-cli` | `skills/vultisig-cli/` | CLI skill with commands and workflows |
| `vultisig-sdk` | `skills/vultisig-sdk/` | SDK skill for TypeScript integration |

---

## OpenClaw (ClawHub)

ClawHub is the primary skill registry ("npm for AI agents"). Publishing here makes skills available to OpenClaw, Hermes, and any agent that supports agentskills.io.

### Prerequisites

- Node.js 18+
- A GitHub account **at least one week old** (required for ClawHub auth)

### Step 1: Install the ClawHub CLI

```bash
npm install -g clawhub
```

### Step 2: Authenticate

```bash
clawhub login
```

This opens a browser for GitHub OAuth. Follow the prompts to authorize ClawHub.

Verify with:
```bash
clawhub whoami
```

### Step 3: Publish Each Skill

From the repo root:

```bash
# Router skill (top-level)
clawhub publish ./skills --slug vultisig --name "Vultisig" --version 1.0.0 --tags latest

# CLI skill
clawhub publish ./skills/vultisig-cli --slug vultisig-cli --name "Vultisig CLI" --version 1.0.0 --tags latest

# SDK skill
clawhub publish ./skills/vultisig-sdk --slug vultisig-sdk --name "Vultisig SDK" --version 1.0.0 --tags latest
```

### Updating Published Skills

When skills are updated (new version, doc changes), bump the version:

```bash
clawhub publish ./skills/vultisig-cli --slug vultisig-cli --name "Vultisig CLI" --version 1.1.0 --tags latest
```

Or use bulk sync to detect and publish all changes:

```bash
clawhub sync --all --dry-run    # Preview what would change
clawhub sync --all              # Publish all updates
```

### Useful Commands

```bash
clawhub whoami                  # Check auth status
clawhub skill rename OLD NEW    # Rename a published skill
clawhub logout                  # Sign out
```

### Reference

- Docs: https://docs.openclaw.ai/tools/clawhub
- Skills spec: https://docs.openclaw.ai/tools/skills
- GitHub: https://github.com/openclaw/clawhub

---

## Hermes (Nous Research)

Hermes Agent can install skills from ClawHub directly, so publishing to ClawHub covers Hermes too. However, you can also publish to Hermes-specific channels.

### Option A: Hermes Installs from ClawHub (No Extra Steps)

Once skills are on ClawHub, Hermes users can install them:

```bash
hermes skills install clawhub/vultisig-cli
```

No additional publishing needed.

### Option B: Publish via Hermes CLI to GitHub

If you want Hermes to discover skills directly from the GitHub repo:

```bash
# Install Hermes Agent (if not already)
# See: https://hermes-agent.nousresearch.com/docs/

# Publish skill to GitHub (uses your existing repo)
hermes skills publish skills/vultisig-cli --to github --repo vultisig/vultisig-sdk
```

Hermes users can then install with:

```bash
hermes skills install vultisig/vultisig-sdk/skills/vultisig-cli
```

### Reference

- Docs: https://hermes-agent.nousresearch.com/docs/
- Skills guide: https://hermes-agent.nousresearch.com/docs/user-guide/features/skills/
- Creating skills: https://hermes-agent.nousresearch.com/docs/developer-guide/creating-skills/

---

## Validation

You can validate skill files before publishing using the agentskills.io reference library:

```bash
npx skills-ref validate ./skills/vultisig-cli
```

## After Publishing

Verify skills are discoverable:

```bash
# On ClawHub
clawhub search vultisig

# On Hermes
hermes skills search vultisig
hermes skills inspect vultisig-cli
```

Test the full agent flow: ask an AI agent to "install Vultisig CLI and create a fast vault" — it should find the skill, follow the non-interactive setup, and complete without getting stuck.
