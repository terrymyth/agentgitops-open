# Enterprise Edition

## Open Core Architecture

AgentGitOps uses Open Core architecture:

- **CE (Community Edition)**: Apache-2.0, full local governance, SQLite, local actor
- **EE (Enterprise Edition)**: Commercial license, PostgreSQL, SSO/RBAC, immutable audit, SIEM, compliance reports

CE defines interfaces and default implementations. EE provides enhanced implementations via injection. Server does not directly import enterprise packages; injection happens through `ExtensionRegistry`.

## EE Injection Factory

Use `createEnterpriseExtensions` to create extensions based on license and config:

```typescript
import { createEnterpriseExtensions } from "@agentgitops/local-hub";

// CE mode (default)
const ceExtensions = await createEnterpriseExtensions({ license: "ce" });

// EE mode
const eeExtensions = await createEnterpriseExtensions({
  license: "enterprise",
  storage: { type: "postgresql", url: "postgresql://user:pass@host:5432/agentgitops" },
  oidc: {
    issuer: "https://login.microsoftonline.com/{tenant}/v2.0",
    clientId: "your-client-id",
    clientSecret: "your-client-secret",
    audience: "api://agentgitops",
  },
  rbac: {
    projectAssignments: {
      "project-a": { alice: ["reviewer"], bob: ["developer"] },
    },
    superAdmins: ["admin"],
  },
  siem: {
    siemWebhookUrl: "https://http-inputs.splunkcloud.com/services/collector",
    siemType: "splunk",
    siemToken: "your-splunk-hec-token",
    autoPush: true,
  },
  compliance: {
    reportStorageDir: ".agentgitops/compliance-reports",
  },
});
```

### Degradation Behavior

EE modules degrade gracefully to CE defaults when unavailable:

| EE Module | Degradation Target | Condition |
| --- | --- | --- |
| PostgreSQL | SQLite (CeStorageAdapter) | pg module not installed or connection failed |
| OIDC/SAML | Local actor (CeIdentityProvider) | OIDC config missing or provider unreachable |
| RBAC | Allow all (CeAuthorizationProvider) | RBAC config missing |
| SIEM Audit | Basic audit (CeImmutableAuditSink) | SIEM config missing |
| Compliance Report | Not supported (CeComplianceReportProvider) | No storage adapter |

## EE Module List

### P1: EE Infrastructure

| Module | File | Description |
| --- | --- | --- |
| PostgreSQL Adapter | `postgres-storage-adapter.ts` | Connection pool, SSL, SQLite migration, schema creation |
| OIDC Identity | `oidc-identity-provider.ts` | OIDC (Okta/Entra ID/Google), JWT+JWKS+introspection, SAML 2.0 |
| RBAC Authorization | `rbac-authorization-provider.ts` | 5 roles, permission matrix, hierarchy inheritance, project-level assignment |
| SIEM Audit | `siem-audit-sink.ts` | Hash chain, Splunk/Datadog/Elastic/Chronicle webhook, multi-format export |
| Compliance Report | `compliance-report-provider.ts` | SOC2/ISO27001/GDPR reports, JSON/CSV/PDF export |

### P2: EE Governance + Operations + Integration

| Module | File | Description |
| --- | --- | --- |
| Policy Templates | `policy-templates.ts` | 5 industry templates (financial/healthcare/general/government/technology) |
| Policy Versioning | `policy-templates.ts` | Version history, diff, rollback |
| Token Analysis | `token-usage-analyzer.ts` | Multi-dimensional aggregation, daily trend, CSV export |
| Agent Vendor Comparison | `token-usage-analyzer.ts` | Claude vs Codex vs Cursor, scoring, recommendation |
| Gitea Integration | `gitea-codeowners.ts` | PR creation, status, merge, webhook, CI status |
| CODEOWNERS | `gitea-codeowners.ts` | Parse CODEOWNERS, glob matching, reviewer auto-match |
| Jira/Linear Sync | `jira-linear-im-sync.ts` | Issue creation, status sync, Jira REST API v3 + Linear API v1 |
| IM Notifications | `jira-linear-im-sync.ts` | Feishu/WeCom/DingTalk/Slack, 8 notification types |

### P3: EE Advanced + Ecosystem

| Module | File | Description |
| --- | --- | --- |
| SCIM | `scim-multitenant-approval.ts` | SCIM 2.0 user/group CRUD, Okta/Entra ID compatible |
| Multi-tenant | `scim-multitenant-approval.ts` | Tenant isolation, resource limits, data isolation enforcement |
| Approval Workflow | `scim-multitenant-approval.ts` | 6 high-risk operation types, multi-approver, TTL, configurable rules |
| Schema Conflict | `schema-callchain-skillpack-plugin.ts` | 5 conflict types, migration dependency graph |
| Call Chain Conflict | `schema-callchain-skillpack-plugin.ts` | Service dependency graph, interface impact analysis |
| Skill Pack | `schema-callchain-skillpack-plugin.ts` | 3 built-in packs, rule matching, violation detection |
| Plugin Registry | `schema-callchain-skillpack-plugin.ts` | Signature verification, version compatibility, dependency check |

## Extension Registry

`ExtensionRegistry` exposes all EE ports as getters:

```typescript
registry.licenseProvider          // LicenseProvider
registry.identityProvider         // IdentityProvider (OIDC/SAML)
registry.authorizationProvider    // AuthorizationProvider (RBAC)
registry.immutableAuditSink       // ImmutableAuditSink (hash chain + SIEM)
registry.storageAdapter           // StorageAdapter (PostgreSQL)
registry.complianceReportProvider // ComplianceReportProvider (SOC2/ISO27001/GDPR)
registry.organizationPolicyProvider
registry.multiRepoTaskOrchestrator
registry.crossRepoMergeOrchestrator
registry.enterpriseAgentOpsProvider
registry.enterpriseGitProvider
registry.securityEvidenceProvider

registry.isEnterpriseEnabled      // boolean: true if licenseProvider is set
```

## Extension Summary

Use `getExtensionSummary` for API/CLI queries:

```typescript
const summary = getExtensionSummary(extensions);
// {
//   isEnterprise: true,
//   storageType: "postgresql",
//   identityProviderType: "OidcIdentityProvider",
//   authorizationProviderType: "RbacAuthorizationProvider",
//   auditSinkType: "SiemAuditSink",
//   complianceReportType: "EnterpriseComplianceReportProvider",
//   enabledFeatures: ["postgresql", "sso", "rbac", "immutable-audit", "compliance-report"]
// }
```

## Agent Adapter Plugin Registry

Custom adapters can be registered:

```typescript
import { AgentAdapterRegistry } from "@agentgitops/local-hub";

const registry = new AgentAdapterRegistry();

// Register custom adapter
registry.register("my-agent", {
  create: (config) => new MyCustomAdapter(config),
}, "My custom agent adapter");

// Create adapter instance
const adapter = registry.create("my-agent", { type: "my-agent", command: "my-agent" });

// List all adapters
registry.listAdapters();
// [
//   { type: "generic-cli", description: "...", builtIn: true },
//   { type: "claude-code", description: "...", builtIn: true },
//   { type: "codex", description: "...", builtIn: true },
//   { type: "opencode", description: "...", builtIn: true },
//   { type: "my-agent", description: "My custom agent adapter", builtIn: false },
// ]
```

Built-in adapters cannot be overridden. Custom adapters can be unregistered.

## Deployment

### Docker Compose

```bash
docker-compose up
```

Starts CLI + Server + Web UI in one command.

### Kubernetes (Helm)

```bash
helm install agentgitops deploy/helm/agentgitops
```

### Relay Mode

```bash
agentgitops server start --mode relay
# Only exposes /api/sync/* and /api/team/* routes
```
