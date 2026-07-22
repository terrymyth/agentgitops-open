# Auth And Identities

## Principles

- Treat Git auth and provider API auth as separate channels.
- Git clone/push may use HTTPS keychain credentials, SSH keys, or a credential helper.
- PR/MR creation uses provider APIs and needs `GITHUB_TOKEN`, `GH_TOKEN`, `GITLAB_TOKEN`, or a CLI token such as `gh auth token`.
- Never store personal tokens in `.agentgitops.yml`, task files, logs, Change Packages, docs, or commits.

## GitHub Auth Precedence

AgentGitOps should resolve GitHub API auth in this order:

1. `GITHUB_TOKEN`
2. `GH_TOKEN`
3. `gh auth token` as an in-process fallback

Use fallback only as a runtime token source. Do not print the token. Do not export it globally unless the user explicitly asks.

Safe presence check:

```bash
tok="$(gh auth token 2>/dev/null || true)"
if [ -n "$tok" ]; then echo "gh-token-present"; else echo "gh-token-missing"; fi
```

Safe one-command usage:

```bash
GITHUB_TOKEN="$(gh auth token)" agentgitops pr <task-id>
```

## Recommended GitHub Token Scopes

For fine-grained tokens on a test repo:

- Metadata: read
- Contents: read/write
- Pull requests: read/write

For webhook management, add administration/webhook permissions only when the workflow actually creates or edits webhooks.

## Per-Developer Configuration

Each developer should configure auth locally:

```bash
gh auth login -h github.com --git-protocol https --web
```

or SSH for Git transport plus `gh` for API auth:

```bash
gh auth login -h github.com --git-protocol ssh --web
```

Repository-local author identity is safe to configure when needed:

```bash
git config user.name "<name>"
git config user.email "<email>"
```

Prefer repo-local config for smoke-test clones. Avoid mutating global Git config unless the user requests it.

## Diagnostics

Use these commands without printing secrets:

```bash
git remote -v
git status -sb
gh auth status
ssh -T git@github.com
git ls-remote <remote-url>
```

If `gh auth status` reports an invalid token but `gh pr create` still works in an escalated/local context, test `gh auth token` directly with the safe presence check. Some sandbox contexts cannot access the same credential store as external commands.
