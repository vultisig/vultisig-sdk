# Issue Writing Guide

_How to fill the Vultisig issue template so agents AND humans produce great results._

---

## Quick Start

1. Pick a template (Bug Report or Feature Request)
2. Fill frontmatter (metadata)
3. Fill body (spec)
4. Run the checklist at the bottom
5. Submit

**Time to fill:** 5-10 minutes for a well-scoped issue. If it takes longer, your scope is too big — split it.

---

## Frontmatter Reference

| Field | Required | Values | Notes |
|-------|----------|--------|-------|
| `type` | Yes | `feature` `bugfix` `refactor` `chore` | Pick one |
| `priority` | Yes | `critical` `high` `medium` `low` | Critical = blocks release |
| `size` | Yes | `tiny` `small` `medium` | **No "large".** Split it. |
| `platform` | Yes | `ios` `android` `web` `desktop` `sdk` `server` `docs` | Can be multiple |
| `files.read` | Yes | File paths | Files for context |
| `files.write` | Yes | File paths | Files to modify. Be specific |
| `verify` | Yes | Shell commands | Commands that prove the work is done |

### Size Guide

| Size | Files Changed | Lines of Code | Example |
|------|--------------|---------------|---------|
| **tiny** | 1 file | <50 lines | Fix a typo, update a constant |
| **small** | 1-3 files | 50-200 lines | Add a function, fix a bug |
| **medium** | 3-8 files | 200-500 lines | New feature with tests |
| **large** | 8+ files | 500+ lines | **SPLIT THIS.** |

---

## Key Rules for This Repo

- **DO NOT** reference `packages/core/` or `packages/lib/` in `files.write` — those are upstream mirrors
- SDK code lives in `packages/sdk/src/` — that's where edits go
- Use `yarn check:all` as the verify command (covers lint + typecheck + test + knip)

---

## Pre-Submit Checklist

- [ ] Title starts with a verb
- [ ] Size is tiny/small/medium (never large)
- [ ] files.write only references packages/sdk/ (not core/ or lib/)
- [ ] At least 2 anti-goals in Must NOT Do
- [ ] Every acceptance criterion is command-runnable
- [ ] verify has at least 1 command
