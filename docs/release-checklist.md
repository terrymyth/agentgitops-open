# Release Checklist

Use this checklist before publishing a public release from the protected `main` branch.

## 1. Branch Readiness

- [ ] Current branch is `main`.
- [ ] Branch is up to date with `origin/main`.
- [ ] No internal files are tracked:
  - `.agentgitops/closeouts/`
  - `.agentgitops/handoffs/`
  - `.agentgitops/packages/`
  - `.agentgitops/tasks/`
  - `.agentgitops/sync/outbox/`
  - `.agentgitops/verifications/`
  - `docs/internal/`
  - private handoff docs
  - private project prompts
  - commercial planning docs
- [ ] `.gitignore` still excludes runtime data and internal docs.

## 2. Privacy And Security

- [ ] Search for personal identifiers, private paths, and private repo URLs.
- [ ] Search for token-like strings and private key material.
- [ ] Confirm examples use placeholders such as `your-username`, `your-org`, or `example-org`.
- [ ] Confirm docs do not include private customer, local machine, or unreleased commercial strategy details.

Suggested checks:

```bash
rg -n -F -e your-private-handle -e your-local-username -e /Users/ -e "C:\\Users" -e github.com/your-private-org .
rg -n -i "ghp_|github_pat_|api[_-]?key|password=|BEGIN PRIVATE KEY|BEGIN OPENSSH" .
git ls-files | rg '(^\.agentgitops/(closeouts|handoffs|packages|sync|tasks|verifications)/|^docs/internal/|^docs/handoff-|^docs/kateagent-|^docs/dual-machine-)'
```

## 3. Quality Gate

Run the full local gate:

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
pnpm validate:release -- --public
pnpm validate:release:history
```

Optional smoke tests:

```bash
pnpm smoke:git-native-sync
pnpm smoke:pr-body-template
pnpm smoke:multi-project-isolation
```

## 4. Package Readiness

- [ ] `apps/cli/package.json` has the intended public package name, version, license, repository, and `bin`.
- [ ] Workspace packages have `publishConfig.access = public` if they are meant to publish.
- [ ] `pnpm-lock.yaml` is committed and current.
- [ ] `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, and `LICENSE` are present.
- [ ] CLI help output matches README examples.

## 5. GitHub Release

- [ ] Tag version from `main`.
- [ ] Release notes include:
  - headline capability summary
  - install command
  - breaking changes, if any
  - verification commands run
  - known limitations
- [ ] Attach screenshots or GIFs if available.
- [ ] Confirm the `public-main-governance` ruleset and required checks are active for `main`.

## 6. Post-Release

- [ ] Announce in the chosen community channels.
- [ ] Watch Issues and Discussions for install failures.
- [ ] Triage security reports privately according to `SECURITY.md`.
- [ ] Transfer public-safe fixes from private development only through a reviewed cherry-pick or clean snapshot; never mirror private refs.
