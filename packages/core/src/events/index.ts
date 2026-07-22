import type { TaskStatus } from "../models/task.js";

/**
 * 任务状态变更事件
 */
export interface TaskStatusChangedEvent {
  type: "task.status_changed";
  data: {
    taskId: string;
    from: TaskStatus;
    to: TaskStatus;
    timestamp: string;
  };
}

/**
 * Change Package 生成事件
 */
export interface ChangePackageGeneratedEvent {
  type: "change_package.generated";
  data: {
    taskId: string;
    packageId: string;
    timestamp: string;
  };
}

/**
 * 冲突检测事件
 */
export interface ConflictDetectedEvent {
  type: "conflict.detected";
  data: {
    conflictId: string;
    taskIds: string[];
    filePath?: string;
    severity: "low" | "medium" | "high";
    timestamp: string;
  };
}

/**
 * 合并事件
 */
export interface MergeCompletedEvent {
  type: "merge.completed";
  data: {
    taskId: string;
    packageId: string;
    commitSha: string;
    mergedBy: string;
    timestamp: string;
  };
}

/**
 * 所有实时事件联合类型
 */
export type RealtimeEvent =
  | TaskStatusChangedEvent
  | ChangePackageGeneratedEvent
  | ConflictDetectedEvent
  | MergeCompletedEvent;
