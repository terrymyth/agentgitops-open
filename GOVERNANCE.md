# Project Governance

AgentGitOps is maintained in public at `terrymyth/agentgitops-open`. The public repository and its issue, pull-request, release, and security records are the source of truth for the open-source project.

## Roles and decisions

- **Maintainer:** owns releases, repository settings, security coordination, roadmap decisions, and final merge responsibility.
- **Contributor:** anyone who opens an issue, discussion, documentation change, test, or code contribution.
- **Reviewer:** a maintainer or invited subject-matter expert who assesses correctness, safety, compatibility, and licensing.

The current project has a solo maintainer. GitHub therefore requires pull requests and successful automated checks but does not require an approving review that the author cannot provide to themself. Review conversations must be resolved before merge. As the maintainer group grows, the required approval count will be raised and CODEOWNERS review enabled.

## Pull-request policy

All changes to `main` use pull requests. A merge requires:

1. A clear objective, scope, risk statement, and verification evidence.
2. Passing Linux, macOS, and Windows CI checks.
3. Tests and documentation appropriate to the change.
4. Resolution of review conversations and security or license concerns.
5. Squash or rebase merge; merge commits and force pushes are disabled.

Maintainers may close changes that are unsafe, out of scope, unmaintainable, incompatible with Apache-2.0 distribution, or dependent on unpublished private code.

## Public/private boundary

Private development is performed in a separate repository with a separate Git history. Public changes are transferred by a reviewed clean snapshot or cherry-pick, never by mirroring branches or pushing all refs. The public gate rejects runtime data, internal documentation, credentials, private paths, and contaminated history.

Code already published in this repository remains available under its published Apache-2.0 terms. Future private or customer-specific modules are not automatically part of this project unless they are deliberately contributed here.

## Releases and changes

Releases are tagged from protected `main` after the release checklist passes. Breaking changes require migration notes. Security fixes may use a private advisory fork before coordinated publication.

Governance changes are made through a public pull request. Material policy changes should remain open long enough for community feedback unless an urgent security or legal issue requires immediate action.
