import type { ChangePackage, Review, TaskContract } from "@agentgitops/core";

export interface MergeGateInput {
  task: TaskContract;
  changePackage: ChangePackage;
  reviews: Review[];
  /**
   * 必须 Reviewer 列表（由 PolicyEngine.getRequiredReviewers 计算）
   *
   * 当变更触及高风险路径时，PolicyEngine 会返回必须的 reviewer。
   * MergeGate 校验这些 reviewer 中是否有人 approve。
   */
  requiredReviewers?: string[];
}

export interface MergeGateResult {
  allowed: boolean;
  blockers: string[];
  warnings: string[];
}

export class MergeGate {
  evaluate(input: MergeGateInput): MergeGateResult {
    const blockers: string[] = [];
    const warnings: string[] = [];
    const pkg = input.changePackage;

    if (pkg.risk.forbiddenFilesTouched) {
      blockers.push("Forbidden files were touched.");
    }
    for (const violation of pkg.risk.violations) {
      if (violation.severity === "error") blockers.push(violation.message);
      else warnings.push(violation.message);
    }
    for (const check of pkg.checks) {
      if (check.status === "failed") {
        blockers.push(`Verification failed: ${check.name}`);
      }
    }
    for (const conflict of pkg.conflicts) {
      if (conflict.status === "open") {
        blockers.push(`Open conflict with ${conflict.conflictingTaskId}: ${conflict.type}`);
      }
    }
    if (pkg.unverifiedItems.length > 0) {
      warnings.push(`Unverified items remain: ${pkg.unverifiedItems.length}`);
    }

    const approvalRequired =
      input.task.approval.required || pkg.risk.level === "high" || pkg.risk.level === "critical";
    const approvals = input.reviews.filter((review) => review.action === "approve");
    const hasApproval = approvals.length > 0;
    const hasRejection = input.reviews.some((review) => review.action === "reject");
    const hasRequestedChanges = input.reviews.some(
      (review) => review.action === "request_changes" || review.action === "ask_agent_to_fix",
    );

    if (hasRejection) blockers.push("A reviewer rejected this change package.");
    if (hasRequestedChanges) blockers.push("A reviewer requested changes.");
    if (approvalRequired && !hasApproval) {
      blockers.push("Approval is required before merge.");
    }

    const requiredReviewers = [
      ...(input.requiredReviewers ?? []),
      ...(input.task.approval.reviewers ?? []),
      ...(pkg.risk.requiredReviewers ?? []),
    ];
    const missingRequiredReviewers = [...new Set(requiredReviewers)]
      .filter((reviewer) => reviewer.trim().length > 0)
      .filter(
        (reviewer) =>
          !input.reviews.some(
            (review) => review.action === "approve" && review.reviewerId === reviewer,
          ),
      );
    if (approvalRequired && missingRequiredReviewers.length > 0) {
      blockers.push(`Required reviewer approval missing: ${missingRequiredReviewers.join(", ")}`);
    }

    return {
      allowed: blockers.length === 0,
      blockers,
      warnings,
    };
  }
}
