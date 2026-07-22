import type { ChangePackageConflict, ConflictSuggestion } from "@agentgitops/core";

/**
 * ConflictResolver - 冲突仲裁建议可执行化
 *
 * 将 ConflictDetector 检测到的冲突建议（serial_merge/rebase/retest/human_takeover/mark_false_positive）
 * 转化为可执行的动作指令，供 CLI/Server 直接触发。
 */

export type ConflictAction =
  | { action: "serial_merge"; order: string[]; reason: string }
  | { action: "rebase"; taskId: string; ontoBranch: string; reason: string }
  | { action: "retest"; taskId: string; reason: string }
  | { action: "human_takeover"; taskId: string; reason: string }
  | { action: "mark_false_positive"; conflictId: string; reason: string };

export interface ConflictResolutionResult {
  conflictId: string;
  action: ConflictAction;
  resolved: boolean;
}

export class ConflictResolver {
  /**
   * 根据单个冲突的建议生成可执行动作
   */
  resolve(
    conflict: ChangePackageConflict,
    context: { currentTaskId: string; baseBranch: string },
  ): ConflictResolutionResult {
    const action = this.toAction(conflict, context);
    return {
      conflictId: conflict.id,
      action,
      resolved: conflict.status === "resolved",
    };
  }

  /**
   * 批量解决冲突，返回动作列表
   *
   * 对于 serial_merge 建议，会聚合计算合并顺序；
   * 对于其他建议，逐个生成动作。
   */
  resolveAll(
    conflicts: ChangePackageConflict[],
    context: { currentTaskId: string; baseBranch: string },
  ): ConflictResolutionResult[] {
    const results: ConflictResolutionResult[] = [];

    // 聚合 serial_merge：计算合并顺序
    const serialConflicts = conflicts.filter(
      (c) => c.suggestion === "serial_merge" && c.status === "open",
    );
    if (serialConflicts.length > 0) {
      const order = this.computeSerialOrder(serialConflicts, context.currentTaskId);
      for (const conflict of serialConflicts) {
        results.push({
          conflictId: conflict.id,
          action: {
            action: "serial_merge",
            order,
            reason: `Conflict ${conflict.type} requires serial merge. Suggested order: ${order.join(" → ")}`,
          },
          resolved: false,
        });
      }
    }

    // 处理其他建议
    for (const conflict of conflicts) {
      if (conflict.suggestion === "serial_merge") continue; // 已聚合处理
      if (conflict.status !== "open") continue;
      results.push(this.resolve(conflict, context));
    }

    return results;
  }

  private toAction(
    conflict: ChangePackageConflict,
    context: { currentTaskId: string; baseBranch: string },
  ): ConflictAction {
    const suggestion: ConflictSuggestion = conflict.suggestion;
    const reason = `Conflict ${conflict.type} (${conflict.severity}) with ${conflict.conflictingTaskId}`;

    switch (suggestion) {
      case "serial_merge":
        return {
          action: "serial_merge",
          order: [context.currentTaskId, conflict.conflictingTaskId],
          reason: `${reason}. Merge ${context.currentTaskId} first, then ${conflict.conflictingTaskId}.`,
        };
      case "rebase":
        return {
          action: "rebase",
          taskId: context.currentTaskId,
          ontoBranch: context.baseBranch,
          reason: `${reason}. Rebase ${context.currentTaskId} onto ${context.baseBranch} after ${conflict.conflictingTaskId} merges.`,
        };
      case "retest":
        return {
          action: "retest",
          taskId: context.currentTaskId,
          reason: `${reason}. Re-run verification checks after ${conflict.conflictingTaskId} merges.`,
        };
      case "human_takeover":
        return {
          action: "human_takeover",
          taskId: context.currentTaskId,
          reason: `${reason}. High-severity conflict requires human review before merge.`,
        };
      case "mark_false_positive":
        return {
          action: "mark_false_positive",
          conflictId: conflict.id,
          reason: `${reason}. Marked as false positive — no action needed.`,
        };
      default:
        return {
          action: "human_takeover",
          taskId: context.currentTaskId,
          reason: `${reason}. Unknown suggestion, defaulting to human takeover.`,
        };
    }
  }

  /**
   * 计算串行合并顺序
   *
   * 简单策略：当前任务优先合并，冲突任务按 severity 降序排列。
   * 高 severity 的冲突任务应后合并（先合并低风险的）。
   */
  private computeSerialOrder(conflicts: ChangePackageConflict[], currentTaskId: string): string[] {
    const order = [currentTaskId];
    const others = [...new Set(conflicts.map((c) => c.conflictingTaskId))];
    // 按 severity 排序：low 先合并，high 后合并
    const severityRank = { low: 0, medium: 1, high: 2 };
    const sorted = others.sort((a, b) => {
      const sevA = conflicts.find((c) => c.conflictingTaskId === a)?.severity ?? "medium";
      const sevB = conflicts.find((c) => c.conflictingTaskId === b)?.severity ?? "medium";
      return severityRank[sevA] - severityRank[sevB];
    });
    order.push(...sorted);
    return order;
  }
}

/**
 * 将冲突动作格式化为人类可读的指令
 */
export function formatConflictAction(result: ConflictResolutionResult): string {
  const { action } = result;
  switch (action.action) {
    case "serial_merge":
      return `Serial merge required. Order: ${action.order.join(" → ")}. ${action.reason}`;
    case "rebase":
      return `Rebase task ${action.taskId} onto ${action.ontoBranch}. ${action.reason}`;
    case "retest":
      return `Re-run verification for task ${action.taskId}. ${action.reason}`;
    case "human_takeover":
      return `Human takeover required for task ${action.taskId}. ${action.reason}`;
    case "mark_false_positive":
      return `Conflict ${action.conflictId} marked as false positive. ${action.reason}`;
  }
}
