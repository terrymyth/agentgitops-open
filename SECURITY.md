# Security Policy

## Supported Versions

Security fixes are applied to the latest supported public release line.

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1   | :x:                |

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security vulnerability in agentgitops, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

### How to Report

1. Open a private report through [GitHub Private Vulnerability Reporting](https://github.com/terrymyth/agentgitops-open/security/advisories/new).
2. Include the following information:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)
   - Your name/handle for acknowledgment (optional)

### Response Timeline

| Action | Expected Time |
| --- | --- |
| Acknowledge receipt | Target: within 3 business days |
| Initial assessment | Target: within 7 business days |
| Fix or mitigation | Based on severity and coordinated disclosure plan |
| Public disclosure | After fix is released, coordinated with reporter |

### Scope

In scope:
- Vulnerabilities in agentgitops core (CLI, server, packages)
- Authentication / authorization bypass
- Credential leakage
- Webhook signature bypass
- Policy engine bypass

Out of scope:
- Vulnerabilities in dependencies (report to upstream)
- Social engineering
- Physical attacks
- DoS without proof of concept

## Security Design

See [`docs/security.md`](./docs/security.md) for the full security design, including:
- Execution isolation (worktree)
- Path & command policies
- Credential management
- Webhook verification
- Audit & compliance

## Acknowledgments

We thank all security researchers who responsibly report vulnerabilities. Contributors will be acknowledged here (with their permission) after the fix is released.
