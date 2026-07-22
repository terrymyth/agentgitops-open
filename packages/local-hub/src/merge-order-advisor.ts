import type { ChangePackage, ChangePackageConflict } from "@agentgitops/core";

/**
 * MergeOrderAdvisor - 合并顺序建议
 *
 * 基于 Change Package 之间的冲突关系图，推荐串行/并行合并顺序。
 * 无冲突的任务可并行合并，有冲突的任务需串行合并。
 */

export interface MergeOrderGroup {
  /** 并行批次序号（0 表示第一批，可同时合并） */
  batch: number;
  /** 该批次可并行合并的任务 ID */
  taskIds: string[];
  /** 该批次的冲突说明 */
  conflicts: MergeOrderConflict[];
}

export interface MergeOrderConflict {
  taskId: string;
  conflictingTaskId: string;
  type: string;
  severity: string;
}

export interface MergeOrderResult {
  groups: MergeOrderGroup[];
  /** 总批次数 */
  totalBatches: number;
  /** 是否存在需串行处理的冲突 */
  hasSerialConflicts: boolean;
  /** 推荐说明 */
  recommendation: string;
}

/**
 * 计算合并顺序
 *
 * 算法：贪心批次分组
 * 1. 构建冲突邻接表：有 open 冲突的任务对不能并行
 * 2. 每轮选出与已分批任务无冲突的任务，归入同一批次
 * 3. 重复直到所有任务分批完成
 *
 * @param packages 待合并的 Change Package 列表
 * @param conflicts 所有检测到的冲突（含跨包）
 */
export function computeMergeOrder(
  packages: ChangePackage[],
  conflicts: ChangePackageConflict[],
): MergeOrderResult {
  if (packages.length === 0) {
    return {
      groups: [],
      totalBatches: 0,
      hasSerialConflicts: false,
      recommendation: "No packages to merge.",
    };
  }

  const taskIds = packages.map((p) => p.taskId);
  const openConflicts = conflicts.filter((c) => c.status === "open");

  // 构建冲突邻接表：taskId → Set<冲突的 taskId>
  const conflictMap = new Map<string, Set<string>>();
  for (const id of taskIds) conflictMap.set(id, new Set());
  for (const c of openConflicts) {
    // 双向记录冲突关系（仅记录双方都在待合并列表中的）
    if (conflictMap.has(c.conflictingTaskId)) {
      const a = findConflictOwner(c.id, taskIds);
      if (a && conflictMap.has(a)) {
        conflictMap.get(a)!.add(c.conflictingTaskId);
        conflictMap.get(c.conflictingTaskId)!.add(a);
      }
    }
  }

  // 贪心批次分组
  const assigned = new Set<string>();
  const groups: MergeOrderGroup[] = [];
  let batch = 0;

  while (assigned.size < taskIds.length) {
    const currentBatch: string[] = [];
    const batchConflicts: MergeOrderConflict[] = [];

    for (const id of taskIds) {
      if (assigned.has(id)) continue;
      const conflicts = conflictMap.get(id) ?? new Set();
      const hasConflictInBatch = [...currentBatch].some((b) => conflicts.has(b));
      if (hasConflictInBatch) continue;

      currentBatch.push(id);
      assigned.add(id);

      for (const c of openConflicts) {
        const a = findConflictOwner(c.id, taskIds);
        if (a === id && !assigned.has(c.conflictingTaskId)) {
          batchConflicts.push({
            taskId: id,
            conflictingTaskId: c.conflictingTaskId,
            type: c.type,
            severity: c.severity,
          });
        }
      }
    }

    if (currentBatch.length === 0) break;

    groups.push({ batch, taskIds: currentBatch, conflicts: batchConflicts });
    batch++;
  }

  const hasSerial = openConflicts.length > 0;
  return {
    groups,
    totalBatches: groups.length,
    hasSerialConflicts: hasSerial,
    recommendation: buildRecommendation(groups),
  };
}

function findConflictOwner(conflictId: string, taskIds: string[]): string | undefined {
  return taskIds.find((id) => conflictId.includes(id));
}

function buildRecommendation(groups: MergeOrderGroup[]): string {
  if (groups.length === 0) return "No packages to merge.";
  if (groups.length === 1) {
    return `All ${groups[0].taskIds.length} package(s) can be merged in parallel (no conflicts).`;
  }
  const parts = groups.map((g) => `Batch ${g.batch + 1}: ${g.taskIds.join(", ")}`);
  return `Serial merge required (${groups.length} batches due to conflicts).\n${parts.join("\n")}`;
}
