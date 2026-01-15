# Release Process

This repository uses [Changesets](https://github.com/changesets/changesets) with the **Release PR pattern** for managing releases.

## How It Works

### Development Phase

1. **Create a changeset** when making changes that should be released:
   ```bash
   yarn changeset
   ```
   This creates a file in `.changeset/` describing the change and version bump type (patch/minor/major).

2. **Include the changeset in your PR** - commit the `.changeset/*.md` file along with your code changes.

3. **Merge PR to main** - the Release workflow runs and:
   - Detects pending changesets
   - Creates/updates a "chore: version packages" PR
   - Does NOT publish yet

### Release Phase

1. **Review the Release PR** - it contains:
   - Version bumps in `package.json` files
   - Updated `CHANGELOG.md` entries
   - All accumulated changes since last release

2. **Merge the Release PR** when ready to release - this triggers:
   - npm publish for `@vultisig/sdk` and `@vultisig/cli`
   - Git tag creation (`vX.Y.Z`)
   - GitHub Release with auto-generated notes
   - Vercel deployment of browser example
   - Documentation sync to vultisig/docs
   - Discord notification

## Changeset Version Types

When running `yarn changeset`, choose the appropriate version bump:

| Type | When to use | Example |
|------|-------------|---------|
| `patch` | Bug fixes, small improvements | `0.2.0` → `0.2.1` |
| `minor` | New features, backwards-compatible | `0.2.0` → `0.3.0` |
| `major` | Breaking changes | `0.2.0` → `1.0.0` |

## Pre-release Mode (Beta)

The repository is currently in **pre-release mode** (beta). This means:
- Versions follow `X.Y.Z-beta.N` format
- Each release increments the beta number

### Exiting Pre-release Mode

When ready for a stable release:

```bash
# Exit pre-release mode
yarn changeset pre exit

# Commit the change
git add .changeset/pre.json
git commit -m "chore: exit pre-release mode"
git push
```

The next Release PR will bump to a stable version (e.g., `0.2.0`).

### Entering Pre-release Mode

To start a new pre-release cycle:

```bash
# Enter pre-release mode with a tag (alpha, beta, rc)
yarn changeset pre enter beta

# Commit the change
git add .changeset/pre.json
git commit -m "chore: enter beta pre-release mode"
git push
```

## Emergency Manual Release

If the automated workflow fails, you can manually release:

1. **Run the manual workflow** via GitHub Actions UI:
   - Go to Actions → "Release Manual" → "Run workflow"
   - Enter the version number
   - Select which post-release tasks to run

2. **Or release locally** (requires npm credentials):
   ```bash
   # Bump versions
   yarn changeset:version

   # Build and publish
   yarn release

   # Create git tag
   git tag -a "vX.Y.Z" -m "Release vX.Y.Z"
   git push origin "vX.Y.Z"
   ```

## Linked Packages

The following packages are versioned together (configured in `.changeset/config.json`):
- `@vultisig/sdk`
- `@vultisig/cli`

A changeset affecting either package will bump both to the same version.

## Workflow Optimization

The release workflow includes an optimization that skips the full build when:
- There are no pending changesets
- The commit is not a Release PR merge
- The workflow was not manually triggered

This saves CI minutes on routine commits that don't affect releases.
