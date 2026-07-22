/**
 * VerificationRun 数据模型
 */
export interface VerificationRun {
  id: string;
  taskId: string;
  name: string;
  command: string;
  status: VerificationStatus;
  exitCode?: number;
  durationMs?: number;
  outputPath?: string;
  /** 解析后的检查摘要（lint/test 计数等） */
  summary?: VerificationSummary;
  outputSummary?: VerificationOutputSummary;
  externalUrl?: string;
  startedAt: string;
  endedAt?: string;
}

export type VerificationStatus = "passed" | "failed" | "skipped";

/**
 * 验证检查摘要
 *
 * 由 lint-log-parser 从命令输出中解析得到，
 * 包含 error/warning 计数和测试统计。
 */
export interface VerificationSummary {
  /** 检查类型 */
  kind: "lint" | "test" | "generic";
  /** 错误数 */
  errors: number;
  /** 警告数 */
  warnings: number;
  /** 测试总数（仅 test 类型） */
  testsTotal?: number;
  /** 测试通过数（仅 test 类型） */
  testsPassed?: number;
  /** 测试失败数（仅 test 类型） */
  testsFailed?: number;
  /** 解析出的关键消息（前 N 条） */
  messages?: string[];
}

export interface VerificationOutputSummary {
  errors: number;
  warnings: number;
  testsPassed?: number;
  testsFailed?: number;
  testsSkipped?: number;
}
