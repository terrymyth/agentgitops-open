import { randomUUID } from "node:crypto";
import type { BranchAdoption } from "@agentgitops/core";
import { TeamSyncStore } from "./team-sync-store.js";

/**
 * BranchOwnershipManager - 分支所有权软锁管理
 *
 * 减少 adopt 后原 owner 继续 push 导致的冲突：
 * 1. adopt 时设置分支所有权软锁（记录新 owner）
 * 2. push 前检查当前操作者是否是分支的活跃 owner
 * 3. 非活跃 owner push 时发出警告（soft lock，不硬阻断）
 *
 * 设计原则：
 * - Soft Lock 不硬阻断，只警告（避免阻断合法的协作流程）
 * - 支持释放锁（release）和转移锁（transfer）
 * - 锁有 TTL，超时自动过期
 */
export class BranchOwnershipManager {
  private readonly store: TeamSyncStore;

  constructor(projectPath: string) {
    this.store = new TeamSyncStore(projectPath);
  }

  close(): void {
    this.store.close();
  }

  /**
   * 设置分支所有权软锁
   *
   * 在 adopt 时调用，记录新的分支 owner。
   * 如果已有活跃锁且 owner 不同，返回冲突提示。
   */
  acquireLock(input: {
    teamId: string;
    taskId: string;
    branch: string;
    owner: string;
    previousOwner?: string;
  }):
    { ok: true; adoption: BranchAdoption } | { ok: false; reason: string; existingOwner?: string } {
    const existing = this.store.getActiveBranchAdoption(input.teamId, input.taskId);
    if (existing && existing.status === "active" && existing.adoptedBy !== input.owner) {
      return {
        ok: false,
        reason: `Branch ${input.branch} is currently locked by ${existing.adoptedBy}. Use 'team release' to release the lock or coordinate with the current owner.`,
        existingOwner: existing.adoptedBy,
      };
    }

    const adoption: BranchAdoption = {
      adoptionId: `adopt_${randomUUID()}`,
      teamId: input.teamId,
      taskId: input.taskId,
      sourceBranch: input.branch,
      adoptedBy: input.owner,
      previousOwner: input.previousOwner ?? existing?.adoptedBy,
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.store.upsertBranchAdoption(adoption);
    return { ok: true, adoption };
  }

  /**
   * 释放分支所有权软锁
   *
   * 在任务完成、合并或主动放弃时调用。
   */
  releaseLock(input: { teamId: string; taskId: string; owner: string }): {
    ok: boolean;
    reason?: string;
  } {
    const existing = this.store.getActiveBranchAdoption(input.teamId, input.taskId);
    if (!existing) {
      return { ok: true, reason: "No active lock found." };
    }
    if (existing.adoptedBy !== input.owner) {
      return { ok: false, reason: `Lock is held by ${existing.adoptedBy}, not ${input.owner}.` };
    }

    this.store.upsertBranchAdoption({
      ...existing,
      status: "released",
      updatedAt: new Date().toISOString(),
    });
    return { ok: true };
  }

  /**
   * 检查分支所有权
   *
   * 在 push 前调用，返回当前操作者是否是分支的活跃 owner。
   * 不硬阻断，只返回警告信息。
   */
  checkOwnership(input: { teamId: string; taskId: string; operator: string }): {
    isOwner: boolean;
    warning?: string;
    currentOwner?: string;
  } {
    const existing = this.store.getActiveBranchAdoption(input.teamId, input.taskId);
    if (!existing) {
      return { isOwner: true };
    }
    if (existing.adoptedBy === input.operator) {
      return { isOwner: true };
    }
    return {
      isOwner: false,
      currentOwner: existing.adoptedBy,
      warning: `Warning: Branch for task ${input.taskId} is currently owned by ${existing.adoptedBy} (since ${existing.createdAt}). Pushing may cause conflicts. Consider coordinating or using 'task continue' instead.`,
    };
  }

  /**
   * 转移分支所有权
   *
   * 在 continue 或显式转移时调用。
   */
  transferLock(input: {
    teamId: string;
    taskId: string;
    newOwner: string;
    currentOwner: string;
  }): { ok: true; adoption: BranchAdoption } | { ok: false; reason: string } {
    const existing = this.store.getActiveBranchAdoption(input.teamId, input.taskId);
    if (!existing) {
      return { ok: false, reason: "No active lock found to transfer." };
    }
    if (existing.adoptedBy !== input.currentOwner) {
      return {
        ok: false,
        reason: `Lock is held by ${existing.adoptedBy}, not ${input.currentOwner}.`,
      };
    }

    const adoption: BranchAdoption = {
      ...existing,
      adoptedBy: input.newOwner,
      previousOwner: input.currentOwner,
      updatedAt: new Date().toISOString(),
    };

    this.store.upsertBranchAdoption(adoption);
    return { ok: true, adoption };
  }

  /**
   * 列出所有活跃的分支锁
   */
  listActiveLocks(teamId?: string): BranchAdoption[] {
    return this.store.listBranchAdoptions(teamId, "active");
  }
}
