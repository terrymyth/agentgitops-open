import type { PolicyViolation, RiskLevel } from "@agentgitops/core";
import {
  DEFAULT_MAX_CHANGED_FILES,
  DEFAULT_MAX_DELETIONS,
  DEFAULT_MAX_INSERTIONS,
} from "@agentgitops/core";
import type { AgentgitopsConfig } from "./config-loader.js";

export interface PolicyEvaluationInput {
  changedFiles: string[];
  allowedPaths?: string[];
  targetBranch: string;
  insertions: number;
  deletions: number;
  checksPassed: boolean;
  unverifiedItems: string[];
  hasConflict: boolean;
}

export interface PolicyEvaluationResult {
  allowed: boolean;
  violations: PolicyViolation[];
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  requiredReviewers: string[];
  canAutoMerge: boolean;
  highRiskFilesTouched: boolean;
  forbiddenFilesTouched: boolean;
}

export type PathRisk = "forbidden" | "high_risk" | "normal";

export interface CommandPolicyResult {
  allowed: boolean;
  violations: PolicyViolation[];
}

export class PolicyEngine {
  constructor(private readonly policies: AgentgitopsConfig["policies"] = {}) {}

  evaluate(input: PolicyEvaluationInput): PolicyEvaluationResult {
    const violations: PolicyViolation[] = [];
    const highRiskFiles = input.changedFiles.filter(
      (filePath) => this.getPathRisk(filePath) === "high_risk",
    );
    const forbiddenFiles = input.changedFiles.filter(
      (filePath) => this.getPathRisk(filePath) === "forbidden",
    );
    const outOfScopeFiles = this.getOutOfScopeFiles(input.changedFiles, input.allowedPaths ?? []);

    if (this.isProtectedBranch(input.targetBranch)) {
      violations.push({
        rule: "protected_branch",
        message: `Target branch ${input.targetBranch} is protected`,
        severity: "error",
      });
    }

    for (const file of forbiddenFiles) {
      violations.push({
        rule: "forbidden_paths",
        file,
        message: `Forbidden path touched: ${file}`,
        severity: "error",
      });
    }
    for (const file of outOfScopeFiles) {
      violations.push({
        rule: "task.allowed_paths",
        file,
        message: `Changed file is outside task allowed paths: ${file}`,
        severity: "error",
      });
    }

    if (input.changedFiles.length > this.maxChangedFiles) {
      violations.push({
        rule: "limits.max_changed_files",
        message: `Changed files ${input.changedFiles.length} exceeds limit ${this.maxChangedFiles}`,
        severity: "warning",
      });
    }
    if (input.insertions > this.maxInsertions) {
      violations.push({
        rule: "limits.max_insertions",
        message: `Insertions ${input.insertions} exceeds limit ${this.maxInsertions}`,
        severity: "warning",
      });
    }
    if (input.deletions > this.maxDeletions) {
      violations.push({
        rule: "limits.max_deletions",
        message: `Deletions ${input.deletions} exceeds limit ${this.maxDeletions}`,
        severity: "warning",
      });
    }
    if (!input.checksPassed) {
      violations.push({
        rule: "checks.required",
        message: "One or more required checks failed",
        severity: "error",
      });
    }

    const riskLevel = this.calculateRiskLevel({
      forbiddenFilesTouched: forbiddenFiles.length > 0,
      highRiskFilesTouched: highRiskFiles.length > 0,
      hasLimitViolation: violations.some((violation) => violation.rule.startsWith("limits.")),
      hasUnverifiedItems: input.unverifiedItems.length > 0,
      hasConflict: input.hasConflict,
    });
    const requiredReviewers = this.getRequiredReviewers(input.changedFiles);
    const requiresApproval =
      riskLevel === "high" ||
      riskLevel === "critical" ||
      (this.policies?.approval?.high_risk_paths_require_review === true &&
        highRiskFiles.length > 0);
    const allowed = !violations.some((violation) => violation.severity === "error");
    const canAutoMerge =
      allowed &&
      riskLevel === "low" &&
      this.policies?.merge?.allow_auto_merge_for_low_risk === true &&
      !(
        this.policies?.merge?.block_merge_if_unverified_items_exist === true &&
        input.unverifiedItems.length > 0
      ) &&
      !(this.policies?.merge?.block_merge_if_conflict_exists === true && input.hasConflict);

    return {
      allowed,
      violations,
      riskLevel,
      requiresApproval,
      requiredReviewers,
      canAutoMerge,
      highRiskFilesTouched: highRiskFiles.length > 0,
      forbiddenFilesTouched: forbiddenFiles.length > 0,
    };
  }

  isProtectedBranch(branch: string): boolean {
    return (this.policies?.branch?.protected ?? []).some((pattern) => matchGlob(pattern, branch));
  }

  getPathRisk(filePath: string): PathRisk {
    const forbidden = [
      ...(this.policies?.paths?.forbidden ?? []),
      ...(this.policies?.paths?.forbidden_for_agents ?? []),
    ];
    if (forbidden.some((pattern) => matchGlob(pattern, filePath))) return "forbidden";
    if ((this.policies?.paths?.high_risk ?? []).some((pattern) => matchGlob(pattern, filePath))) {
      return "high_risk";
    }
    return "normal";
  }

  getRequiredReviewers(changedFiles: string[]): string[] {
    const reviewerMap = this.policies?.approval?.required_reviewers ?? {};
    const reviewers = new Set<string>();
    for (const [pattern, mappedReviewers] of Object.entries(reviewerMap)) {
      if (changedFiles.some((filePath) => matchGlob(pattern, filePath))) {
        for (const reviewer of mappedReviewers) reviewers.add(reviewer);
      }
    }
    return [...reviewers].sort();
  }

  /**
   * 检查命令是否被禁止
   *
   * 匹配规则：命令字符串以 forbidden 列表中的任一项开头（忽略首尾空白）。
   * 例如 forbidden: ["git push origin main", "rm -rf"] 会拦截：
   *   - "git push origin main"
   *   - "git push origin main --force"
   *   - "rm -rf /"
   *
   * @returns 命中则返回命中的禁止规则，否则返回 null
   */
  isForbiddenCommand(command: string): string | null {
    const forbidden = this.policies?.commands?.forbidden ?? [];
    const normalized = command.trim();
    for (const rule of forbidden) {
      if (normalized.startsWith(rule.trim())) {
        return rule;
      }
    }
    return null;
  }

  evaluateCommand(command: string, args: string[] = []): CommandPolicyResult {
    const violations: PolicyViolation[] = [];
    const fullCommand = [command, ...args].filter(Boolean).join(" ");
    const executable = normalizeCommandName(command);
    const allowed = this.policies?.commands?.allowed ?? [];
    const forbidden = this.policies?.commands?.forbidden ?? [];

    for (const pattern of forbidden) {
      if (commandMatches(pattern, executable, fullCommand)) {
        violations.push({
          rule: "commands.forbidden",
          message: `Forbidden command matched policy '${pattern}': ${fullCommand}`,
          severity: "error",
        });
      }
    }

    if (
      allowed.length > 0 &&
      !allowed.some((pattern) => commandMatches(pattern, executable, fullCommand))
    ) {
      violations.push({
        rule: "commands.allowed",
        message: `Command is not in allowed command policy: ${executable}`,
        severity: "error",
      });
    }

    return {
      allowed: !violations.some((violation) => violation.severity === "error"),
      violations,
    };
  }

  private getOutOfScopeFiles(changedFiles: string[], allowedPaths: string[]): string[] {
    if (allowedPaths.length === 0) return [];
    return changedFiles.filter(
      (filePath) => !allowedPaths.some((pattern) => matchGlob(pattern, filePath)),
    );
  }

  private calculateRiskLevel(input: {
    forbiddenFilesTouched: boolean;
    highRiskFilesTouched: boolean;
    hasLimitViolation: boolean;
    hasUnverifiedItems: boolean;
    hasConflict: boolean;
  }): RiskLevel {
    if (input.forbiddenFilesTouched) return "critical";
    if (input.highRiskFilesTouched) return "high";
    if (input.hasLimitViolation || input.hasUnverifiedItems || input.hasConflict) return "medium";
    return "low";
  }

  private get maxChangedFiles(): number {
    return this.policies?.limits?.max_changed_files ?? DEFAULT_MAX_CHANGED_FILES;
  }

  private get maxInsertions(): number {
    return this.policies?.limits?.max_insertions ?? DEFAULT_MAX_INSERTIONS;
  }

  private get maxDeletions(): number {
    return this.policies?.limits?.max_deletions ?? DEFAULT_MAX_DELETIONS;
  }
}

function normalizeCommandName(command: string): string {
  const normalized = command.replace(/\\/g, "/");
  const baseName = normalized.slice(normalized.lastIndexOf("/") + 1);
  return baseName.replace(/\.(?:cmd|bat|exe)$/i, "");
}

function commandMatches(pattern: string, executable: string, fullCommand: string): boolean {
  const normalizedPattern = pattern.trim();
  if (!normalizedPattern) return false;
  if (!/[ *?[\]]/.test(normalizedPattern)) {
    return executable === normalizedPattern || fullCommand === normalizedPattern;
  }
  return matchGlob(normalizedPattern, executable) || matchGlob(normalizedPattern, fullCommand);
}

export function matchGlob(pattern: string, value: string): boolean {
  const globstarPlaceholder = "__AGENTGITOPS_GLOBSTAR__";
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, globstarPlaceholder)
    .replace(/\*/g, "[^/]*")
    .replace(new RegExp(globstarPlaceholder, "g"), ".*");
  return new RegExp(`^${escaped}$`).test(value);
}
