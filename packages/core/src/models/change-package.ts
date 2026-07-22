import type { RiskLevel } from "./task.js";
import type { VerificationRun } from "./verification-run.js";
import type { ChangeIntentEntry } from "./team-sync.js";

/**
 * ChangePackage 数据模型
 */
export interface ChangePackage {
  id: string;
  taskId: string;
  projectId: string;
  version: string;
  agent: ChangePackageAgent;
  baseBranch: string;
  targetBranch: string;
  objective: string;
  background?: string;
  summary: string;
  changedFiles: string[];
  stats: ChangePackageStats;
  diffSummary?: Record<string, FileDiffSummary>;
  checks: VerificationRun[];
  risk: RiskAssessment;
  evidence?: ChangePackageEvidence;
  unverifiedItems: string[];
  conflicts: ChangePackageConflict[];
  /** 变更意图：每个文件的修改意图（Sprint B3） */
  changeIntents?: ChangeIntentEntry[];
  /** 影响范围（Sprint B3） */
  impactedAreas?: string[];
  /** 是否有破坏性变更（Sprint B3） */
  breakingChanges?: boolean;
  mergeRecommendation: string;
  prUrl?: string;
  prNumber?: number;
  createdAt: string;
}

export interface ChangePackageAgent {
  name: string;
  adapter: string;
  sessionId?: string;
}

export interface ChangePackageStats {
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export interface FileDiffSummary {
  insertions: number;
  deletions: number;
  hunks: number;
}

export interface RiskAssessment {
  level: RiskLevel;
  domains: string[];
  highRiskFilesTouched: boolean;
  forbiddenFilesTouched: boolean;
  requiredReviewers?: string[];
  violations: PolicyViolation[];
}

export interface ChangePackageEvidence {
  securityScan: {
    status: "not_configured" | "passed" | "failed";
    findings: number;
    provider?: string;
    summary: string;
  };
  comparison: {
    comparedPackages: number;
    overlappingFiles: string[];
    insertionDelta: number;
    deletionDelta: number;
  };
}

export interface PolicyViolation {
  rule: string;
  file?: string;
  message: string;
  severity: "error" | "warning";
}

export interface ChangePackageConflict {
  id: string;
  type: ConflictType;
  conflictingTaskId: string;
  filePath?: string;
  severity: "low" | "medium" | "high";
  suggestion: ConflictSuggestion;
  status: "open" | "resolved";
}

export type ConflictType =
  | "same_file"
  | "same_risk_domain"
  | "dependency"
  | "migration"
  | "ci_config"
  | "high_risk_concurrent"
  | "api_contract"
  | "type_definition"
  | "schema"
  | "call_chain"
  | "test_coverage"
  | "permission_logic"
  | "dependency_version";

export type ConflictSuggestion =
  "serial_merge" | "rebase" | "retest" | "human_takeover" | "mark_false_positive";
