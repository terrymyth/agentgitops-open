/**
 * MergeRecord 数据模型
 */
export interface MergeRecord {
  id: string;
  changePackageId: string;
  taskId: string;
  mergeStrategy: "auto" | "manual";
  squash: boolean;
  mergedBy: string;
  mergedAt: string;
  commitSha?: string;
  reverted: boolean;
  revertedAt?: string;
}
