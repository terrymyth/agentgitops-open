import type {
  ChangePackage,
  ChangePackageConflict,
  ConflictDetector as ConflictDetectorPort,
} from "@agentgitops/core";

export class ConflictDetector implements ConflictDetectorPort {
  detect(current: ChangePackage, candidates: ChangePackage[]): ChangePackageConflict[] {
    const conflicts: ChangePackageConflict[] = [];
    for (const candidate of candidates) {
      if (candidate.taskId === current.taskId) continue;
      conflicts.push(...this.detectPair(current, candidate));
    }
    return dedupeConflicts(conflicts);
  }

  private detectPair(current: ChangePackage, candidate: ChangePackage): ChangePackageConflict[] {
    const conflicts: ChangePackageConflict[] = [];
    const currentFiles = new Set(current.changedFiles);

    for (const filePath of candidate.changedFiles) {
      if (currentFiles.has(filePath)) {
        conflicts.push({
          id: conflictId(current.taskId, candidate.taskId, "same_file", filePath),
          type: "same_file",
          conflictingTaskId: candidate.taskId,
          filePath,
          severity: "high",
          suggestion: "serial_merge",
          status: "open",
        });
      }
    }

    const sharedDomains = current.risk.domains.filter((domain) =>
      candidate.risk.domains.includes(domain),
    );
    for (const domain of sharedDomains) {
      conflicts.push({
        id: conflictId(current.taskId, candidate.taskId, "same_risk_domain", domain),
        type: "same_risk_domain",
        conflictingTaskId: candidate.taskId,
        severity: "medium",
        suggestion: "retest",
        status: "open",
      });
    }

    if (isHighRisk(current) && isHighRisk(candidate)) {
      conflicts.push({
        id: conflictId(current.taskId, candidate.taskId, "high_risk_concurrent"),
        type: "high_risk_concurrent",
        conflictingTaskId: candidate.taskId,
        severity: "high",
        suggestion: "serial_merge",
        status: "open",
      });
    }

    conflicts.push(...this.detectPathCategoryConflicts(current, candidate));

    return conflicts;
  }

  private detectPathCategoryConflicts(
    current: ChangePackage,
    candidate: ChangePackage,
  ): ChangePackageConflict[] {
    const conflicts: ChangePackageConflict[] = [];
    for (const rule of pathConflictRules) {
      const currentTouched = current.changedFiles.some((filePath) => rule.matches(filePath));
      const candidateTouched = candidate.changedFiles.some((filePath) => rule.matches(filePath));
      if (!currentTouched || !candidateTouched) continue;

      conflicts.push({
        id: conflictId(current.taskId, candidate.taskId, rule.type),
        type: rule.type,
        conflictingTaskId: candidate.taskId,
        severity: rule.severity,
        suggestion: rule.suggestion,
        status: "open",
      });
    }
    return conflicts;
  }
}

const pathConflictRules: Array<{
  type: ChangePackageConflict["type"];
  severity: ChangePackageConflict["severity"];
  suggestion: ChangePackageConflict["suggestion"];
  matches: (filePath: string) => boolean;
}> = [
  {
    type: "migration",
    severity: "high",
    suggestion: "serial_merge",
    matches: (filePath) => /(^|\/)(migrations?|db\/migrate|prisma\/migrations)\//.test(filePath),
  },
  {
    type: "ci_config",
    severity: "medium",
    suggestion: "retest",
    matches: (filePath) =>
      filePath.startsWith(".github/workflows/") ||
      filePath === ".gitlab-ci.yml" ||
      filePath === "circle.yml" ||
      filePath.startsWith(".circleci/"),
  },
  {
    type: "schema",
    severity: "high",
    suggestion: "serial_merge",
    matches: (filePath) =>
      /(^|\/)(schema|schemas)\//.test(filePath) ||
      filePath.endsWith(".graphql") ||
      filePath.endsWith("schema.prisma") ||
      filePath.endsWith("openapi.yml") ||
      filePath.endsWith("openapi.yaml"),
  },
  {
    type: "api_contract",
    severity: "high",
    suggestion: "human_takeover",
    matches: (filePath) =>
      /(^|\/)(api|routes|controllers)\//.test(filePath) ||
      filePath.includes("openapi") ||
      filePath.includes("swagger"),
  },
  {
    type: "type_definition",
    severity: "medium",
    suggestion: "retest",
    matches: (filePath) => filePath.endsWith(".d.ts") || /(^|\/)(types|models)\//.test(filePath),
  },
  {
    type: "permission_logic",
    severity: "high",
    suggestion: "human_takeover",
    matches: (filePath) =>
      /(^|\/)(auth|acl|rbac|permissions?)\//.test(filePath) ||
      /(auth|permission|rbac|policy)/i.test(filePath),
  },
  {
    type: "dependency_version",
    severity: "medium",
    suggestion: "retest",
    matches: (filePath) =>
      [
        "package.json",
        "pnpm-lock.yaml",
        "package-lock.json",
        "yarn.lock",
        "Cargo.toml",
        "Cargo.lock",
        "go.mod",
        "go.sum",
        "requirements.txt",
        "poetry.lock",
      ].includes(filePath),
  },
];

function isHighRisk(pkg: ChangePackage): boolean {
  return pkg.risk.level === "high" || pkg.risk.level === "critical";
}

function conflictId(
  taskId: string,
  conflictingTaskId: string,
  type: ChangePackageConflict["type"],
  discriminator = "",
): string {
  const slug = [taskId, conflictingTaskId, type, discriminator]
    .join("_")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return `conflict_${slug}`;
}

function dedupeConflicts(conflicts: ChangePackageConflict[]): ChangePackageConflict[] {
  const byId = new Map<string, ChangePackageConflict>();
  for (const conflict of conflicts) byId.set(conflict.id, conflict);
  return [...byId.values()];
}
