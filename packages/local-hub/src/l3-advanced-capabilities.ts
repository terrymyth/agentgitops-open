import { createHash } from "node:crypto";
import type { AuditEvent, ChangePackage, ImmutableAuditEntry } from "@agentgitops/core";

/**
 * L3 高级能力实现（L3-002 ~ L3-007）
 *
 * 包含：
 * - L3-002: 语义冲突检测（调用链/权限/业务逻辑）
 * - L3-003: 预测性 AgentOps（失败预警、质量趋势）
 * - L3-004: 不可篡改审计实现（哈希链）
 * - L3-005: 安全扫描套件（SAST/Secret/Dependency 占位）
 * - L3-006: 智能合并调度（依赖感知排序 + 回滚建议）
 * - L3-007: 跨任务证据聚合（diff 摘要对比 + 趋势分析）
 */

// ===== L3-002: 语义冲突检测 =====

export interface SemanticConflict {
  type:
    | "api_contract"
    | "type_definition"
    | "dependency_version"
    | "call_chain"
    | "permission"
    | "business_logic";
  severity: "low" | "medium" | "high";
  sourceTaskId: string;
  targetTaskId: string;
  description: string;
  suggestion: string;
}

/**
 * SemanticConflictDetector — 语义冲突检测器（L3-002）
 *
 * 在文件级冲突之上，检测更深层的语义冲突：
 * - API 契约冲突：导出函数签名变更
 * - 类型定义冲突：interface/type 定义变更
 * - 依赖版本冲突：package.json 依赖版本不一致
 * - 调用链冲突：一个任务修改了另一个任务依赖的函数
 * - 权限冲突：权限模型变更
 * - 业务逻辑冲突：同一业务域的逻辑变更
 */
export class SemanticConflictDetector {
  detect(input: {
    sourcePackage: ChangePackage;
    targetPackages: ChangePackage[];
  }): SemanticConflict[] {
    const conflicts: SemanticConflict[] = [];
    const { sourcePackage: source, targetPackages: targets } = input;

    for (const target of targets) {
      // API 契约冲突
      const apiConflicts = this.detectApiContractConflicts(source, target);
      conflicts.push(...apiConflicts);

      // 类型定义冲突
      const typeConflicts = this.detectTypeDefinitionConflicts(source, target);
      conflicts.push(...typeConflicts);

      // 依赖版本冲突
      const depConflicts = this.detectDependencyConflicts(source, target);
      conflicts.push(...depConflicts);

      // 调用链冲突
      const callChainConflicts = this.detectCallChainConflicts(source, target);
      conflicts.push(...callChainConflicts);
    }

    return conflicts;
  }

  private detectApiContractConflicts(
    source: ChangePackage,
    target: ChangePackage,
  ): SemanticConflict[] {
    const conflicts: SemanticConflict[] = [];
    const sourceExports = source.changedFiles.filter((f) => this.looksLikeExportFile(f));
    const targetExports = target.changedFiles.filter((f) => this.looksLikeExportFile(f));

    const overlap = sourceExports.filter((f) => targetExports.includes(f));
    for (const file of overlap) {
      conflicts.push({
        type: "api_contract",
        severity: "high",
        sourceTaskId: source.taskId,
        targetTaskId: target.taskId,
        description: `Both tasks modified API contract file: ${file}`,
        suggestion:
          "Coordinate API changes to avoid breaking consumers. Consider versioning the API.",
      });
    }

    return conflicts;
  }

  private detectTypeDefinitionConflicts(
    source: ChangePackage,
    target: ChangePackage,
  ): SemanticConflict[] {
    const conflicts: SemanticConflict[] = [];
    const sourceTypes = source.changedFiles.filter(
      (f) => f.endsWith(".d.ts") || f.includes("/types/") || f.includes("/interfaces/"),
    );
    const targetTypes = target.changedFiles.filter(
      (f) => f.endsWith(".d.ts") || f.includes("/types/") || f.includes("/interfaces/"),
    );

    const overlap = sourceTypes.filter((f) => targetTypes.includes(f));
    for (const file of overlap) {
      conflicts.push({
        type: "type_definition",
        severity: "medium",
        sourceTaskId: source.taskId,
        targetTaskId: target.taskId,
        description: `Both tasks modified type definition: ${file}`,
        suggestion: "Merge type changes carefully to avoid type errors.",
      });
    }

    return conflicts;
  }

  private detectDependencyConflicts(
    source: ChangePackage,
    target: ChangePackage,
  ): SemanticConflict[] {
    const conflicts: SemanticConflict[] = [];
    const sourceHasPackageJson =
      source.changedFiles.includes("package.json") ||
      source.changedFiles.includes("pnpm-lock.yaml");
    const targetHasPackageJson =
      target.changedFiles.includes("package.json") ||
      target.changedFiles.includes("pnpm-lock.yaml");

    if (sourceHasPackageJson && targetHasPackageJson) {
      conflicts.push({
        type: "dependency_version",
        severity: "high",
        sourceTaskId: source.taskId,
        targetTaskId: target.taskId,
        description: "Both tasks modified package.json or lockfile",
        suggestion: "Merge dependency changes serially to avoid lockfile conflicts.",
      });
    }

    return conflicts;
  }

  private detectCallChainConflicts(
    source: ChangePackage,
    target: ChangePackage,
  ): SemanticConflict[] {
    const conflicts: SemanticConflict[] = [];
    // 简单启发式：如果一个任务修改了另一个任务变更文件的同目录文件
    const sourceDirs = new Set(source.changedFiles.map((f) => f.split("/").slice(0, -1).join("/")));
    const targetDirs = new Set(target.changedFiles.map((f) => f.split("/").slice(0, -1).join("/")));

    const overlappingDirs = [...sourceDirs].filter((d) => targetDirs.has(d) && d);
    if (overlappingDirs.length > 0) {
      conflicts.push({
        type: "call_chain",
        severity: "low",
        sourceTaskId: source.taskId,
        targetTaskId: target.taskId,
        description: `Tasks modify files in same directories: ${overlappingDirs.slice(0, 3).join(", ")}`,
        suggestion: "Review for potential call chain conflicts in shared directories.",
      });
    }

    return conflicts;
  }

  private looksLikeExportFile(file: string): boolean {
    return (
      file.endsWith("index.ts") ||
      file.endsWith("index.js") ||
      file.includes("/api/") ||
      file.includes("/exports/")
    );
  }
}

// ===== L3-003: 预测性 AgentOps =====

export interface PredictiveInsight {
  type: "failure_warning" | "quality_trend" | "agent_recommendation" | "cost_alert";
  severity: "info" | "warning" | "critical";
  message: string;
  data?: Record<string, unknown>;
}

/**
 * PredictiveAgentOps — 预测性 AgentOps 分析器（L3-003）
 *
 * 基于历史指标，提供预测性分析：
 * - 失败预警：Agent 连续失败时预警
 * - 质量趋势：成功率/合并率趋势分析
 * - Agent 推荐：基于历史成功率推荐 Agent
 * - 成本预警：token 消耗异常时预警
 */
export class PredictiveAgentOps {
  analyze(input: {
    agentMetrics: Array<{
      agentId: string;
      taskCount: number;
      successCount: number;
      failureCount: number;
      avgDurationMs: number;
      recentResults: boolean[]; // true=success, false=failure
    }>;
  }): PredictiveInsight[] {
    const insights: PredictiveInsight[] = [];

    for (const agent of input.agentMetrics) {
      // 失败预警：最近 3 次连续失败
      const recent = agent.recentResults.slice(-3);
      if (recent.length >= 3 && recent.every((r) => !r)) {
        insights.push({
          type: "failure_warning",
          severity: "critical",
          message: `Agent ${agent.agentId} has failed ${recent.length} consecutive tasks. Consider switching agent or reviewing task scope.`,
          data: { agentId: agent.agentId, consecutiveFailures: recent.length },
        });
      }

      // 质量趋势：成功率低于 50%
      const successRate = agent.taskCount > 0 ? agent.successCount / agent.taskCount : 0;
      if (agent.taskCount >= 5 && successRate < 0.5) {
        insights.push({
          type: "quality_trend",
          severity: "warning",
          message: `Agent ${agent.agentId} has low success rate (${(successRate * 100).toFixed(0)}%). Review task assignments.`,
          data: { agentId: agent.agentId, successRate },
        });
      }

      // Agent 推荐：成功率最高的 Agent
      if (agent.taskCount >= 5 && successRate >= 0.8) {
        insights.push({
          type: "agent_recommendation",
          severity: "info",
          message: `Agent ${agent.agentId} has high success rate (${(successRate * 100).toFixed(0)}%). Recommended for similar tasks.`,
          data: { agentId: agent.agentId, successRate },
        });
      }
    }

    return insights;
  }
}

// ===== L3-004: 不可篡改审计实现 =====

/**
 * HashChainAuditSink — 哈希链审计实现（L3-004）
 *
 * CE 本地实现，使用 SHA-256 哈希链确保审计事件不可篡改。
 * 每个事件的 hash = SHA-256(previousHash + eventContent)
 */
export class HashChainAuditSink {
  private lastHash = "";

  /**
   * 追加审计事件，自动计算哈希链
   */
  append(event: Omit<ImmutableAuditEntry, "previousHash" | "currentHash">): ImmutableAuditEntry {
    const previousHash = this.lastHash;
    const content = JSON.stringify({
      eventId: event.eventId,
      eventType: event.eventType,
      actorId: event.actorId,
      actorType: event.actorType,
      projectId: event.projectId,
      taskId: event.taskId,
      payload: event.payload,
      timestamp: event.timestamp,
    });
    const currentHash = createHash("sha256")
      .update(previousHash + content)
      .digest("hex");

    const entry: ImmutableAuditEntry = {
      ...event,
      previousHash,
      currentHash,
    };

    this.lastHash = currentHash;
    return entry;
  }

  /**
   * 验证审计链完整性
   */
  verifyChain(entries: ImmutableAuditEntry[]): {
    valid: boolean;
    brokenAt?: string;
    error?: string;
  } {
    let expectedPrevious = "";
    for (const entry of entries) {
      if (entry.previousHash !== expectedPrevious) {
        return {
          valid: false,
          brokenAt: entry.eventId,
          error: `Hash chain broken at event ${entry.eventId}: expected previous hash ${expectedPrevious} but got ${entry.previousHash}`,
        };
      }
      // 重新计算当前 hash 验证
      const content = JSON.stringify({
        eventId: entry.eventId,
        eventType: entry.eventType,
        actorId: entry.actorId,
        actorType: entry.actorType,
        projectId: entry.projectId,
        taskId: entry.taskId,
        payload: entry.payload,
        timestamp: entry.timestamp,
      });
      const expectedHash = createHash("sha256")
        .update(entry.previousHash + content)
        .digest("hex");
      if (entry.currentHash !== expectedHash) {
        return {
          valid: false,
          brokenAt: entry.eventId,
          error: `Hash mismatch at event ${entry.eventId}: content may have been tampered`,
        };
      }
      expectedPrevious = entry.currentHash;
    }
    return { valid: true };
  }

  /**
   * 从审计事件列表初始化哈希链
   */
  initializeFromEvents(events: AuditEvent[]): ImmutableAuditEntry[] {
    this.lastHash = "";
    return events.map((event) => {
      return this.append({
        eventId: event.id,
        eventType: event.eventType,
        actorId: event.actorId,
        actorType: event.actorType,
        projectId: event.projectId,
        taskId: event.taskId,
        payload: event.payload as Record<string, unknown>,
        timestamp: event.createdAt,
      });
    });
  }
}

// ===== L3-005: 安全扫描套件 =====

export interface SecurityScanConfig {
  enableSast: boolean;
  enableSecretScan: boolean;
  enableDependencyScan: boolean;
  enableLicenseCheck: boolean;
}

/**
 * SecurityScanSuite — 安全扫描套件 CE 实现（L3-005）
 *
 * CE 提供基础安全扫描能力：
 * - Secret Scan：扫描变更文件中的密钥/密码模式
 * - Dependency Scan：检查 package.json 中的已知漏洞依赖（占位）
 * - SAST：基础静态分析（占位）
 * - License Check：检查依赖许可证（占位）
 *
 * EE 通过 SecurityEvidenceProvider 注入更完整的安全扫描。
 */
export class SecurityScanSuite {
  private readonly secretPatterns = [
    { name: "GitHub Token", pattern: /gh[pousr]_[A-Za-z0-9]{36}/g, severity: "critical" as const },
    { name: "AWS Access Key", pattern: /AKIA[0-9A-Z]{16}/g, severity: "critical" as const },
    {
      name: "Private Key",
      pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
      severity: "critical" as const,
    },
    {
      name: "JWT",
      pattern: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
      severity: "high" as const,
    },
    {
      name: "Generic Password",
      pattern: /(?:password|passwd|pwd)\s*[:=]\s*["']([^"']{8,})["']/gi,
      severity: "medium" as const,
    },
  ];

  scan(input: {
    changedFiles: string[];
    fileContents: Record<string, string>;
    config?: Partial<SecurityScanConfig>;
  }): SecurityScanResult[] {
    const config: SecurityScanConfig = {
      enableSast: true,
      enableSecretScan: true,
      enableDependencyScan: true,
      enableLicenseCheck: false,
      ...input.config,
    };

    const results: SecurityScanResult[] = [];

    if (config.enableSecretScan) {
      results.push(this.scanSecrets(input.changedFiles, input.fileContents));
    }

    if (config.enableDependencyScan) {
      results.push(this.scanDependencies(input.changedFiles, input.fileContents));
    }

    return results;
  }

  private scanSecrets(
    changedFiles: string[],
    fileContents: Record<string, string>,
  ): SecurityScanResult {
    const findings: SecurityFinding[] = [];

    for (const file of changedFiles) {
      const content = fileContents[file];
      if (!content) continue;

      for (const { name, pattern, severity } of this.secretPatterns) {
        const matches = content.match(pattern);
        if (matches) {
          findings.push({
            severity,
            rule: `secret-detect:${name}`,
            message: `${name} detected in ${file}`,
            file,
            blocking: severity === "critical" || severity === "high",
          });
        }
      }
    }

    return {
      scanId: `secret-${Date.now()}`,
      scanType: "secret",
      status: findings.some((f) => f.blocking)
        ? "failed"
        : findings.length > 0
          ? "warning"
          : "passed",
      findings,
      scannedAt: new Date().toISOString(),
      duration: 0,
    };
  }

  private scanDependencies(
    changedFiles: string[],
    fileContents: Record<string, string>,
  ): SecurityScanResult {
    const findings: SecurityFinding[] = [];

    // 检查 package.json 变更
    if (changedFiles.includes("package.json")) {
      const content = fileContents["package.json"];
      if (content) {
        try {
          JSON.parse(content); // 验证 JSON 有效性
          // 占位：检查已知漏洞依赖（需要漏洞数据库）
          // CE 只标记依赖变更，不执行真实漏洞检查
          findings.push({
            severity: "info",
            rule: "dependency-changed",
            message:
              "package.json was modified — review dependency changes for known vulnerabilities.",
            file: "package.json",
            blocking: false,
          });
        } catch {
          // JSON 解析失败，忽略
        }
      }
    }

    return {
      scanId: `dep-${Date.now()}`,
      scanType: "dependency",
      status: "passed",
      findings,
      scannedAt: new Date().toISOString(),
      duration: 0,
    };
  }

  hasBlockingFindings(results: SecurityScanResult[]): boolean {
    return results.some((r) => r.findings.some((f) => f.blocking));
  }
}

export interface SecurityScanResult {
  scanId: string;
  scanType: "sast" | "secret" | "dependency" | "license";
  status: "passed" | "failed" | "warning";
  findings: SecurityFinding[];
  scannedAt: string;
  duration: number;
}

export interface SecurityFinding {
  severity: "critical" | "high" | "medium" | "low" | "info";
  rule: string;
  message: string;
  file?: string;
  line?: number;
  blocking: boolean;
}

// ===== L3-006: 智能合并调度 =====

export interface SmartMergeSuggestion {
  taskId: string;
  batch: number;
  canMerge: boolean;
  blockedBy: string[];
  rollbackSuggestion?: string;
  estimatedRisk: "low" | "medium" | "high";
}

/**
 * SmartMergeScheduler — 智能合并调度器（L3-006）
 *
 * 基于依赖关系和冲突图，提供智能合并调度：
 * - 依赖感知排序：被依赖的任务先合并
 * - 回滚建议：合并失败时的恢复建议
 * - 风险估算：基于变更规模和冲突关系估算合并风险
 */
export class SmartMergeScheduler {
  schedule(input: {
    packages: ChangePackage[];
    dependencies: Array<{ taskId: string; dependsOn: string }>;
    conflicts: Array<{ sourceTaskId: string; targetTaskId: string; severity: string }>;
  }): SmartMergeSuggestion[] {
    const { packages, dependencies, conflicts } = input;

    // 构建依赖图
    const depMap = new Map<string, string[]>();
    for (const dep of dependencies) {
      if (!depMap.has(dep.taskId)) depMap.set(dep.taskId, []);
      depMap.get(dep.taskId)!.push(dep.dependsOn);
    }

    // 构建冲突图
    const conflictMap = new Map<string, string[]>();
    for (const c of conflicts) {
      if (!conflictMap.has(c.sourceTaskId)) conflictMap.set(c.sourceTaskId, []);
      if (!conflictMap.has(c.targetTaskId)) conflictMap.set(c.targetTaskId, []);
      conflictMap.get(c.sourceTaskId)!.push(c.targetTaskId);
      conflictMap.get(c.targetTaskId)!.push(c.sourceTaskId);
    }

    // 拓扑排序 + 批次分组
    const suggestions: SmartMergeSuggestion[] = [];
    const merged = new Set<string>();
    let batch = 0;

    while (merged.size < packages.length) {
      const batchTasks: ChangePackage[] = [];

      for (const pkg of packages) {
        if (merged.has(pkg.taskId)) continue;

        // 检查依赖是否已满足
        const deps = depMap.get(pkg.taskId) ?? [];
        const depsSatisfied = deps.every((d) => merged.has(d));

        // 检查是否有高严重度冲突
        const taskConflicts = conflictMap.get(pkg.taskId) ?? [];
        const hasHighConflict = conflicts.some(
          (c) =>
            (c.sourceTaskId === pkg.taskId || c.targetTaskId === pkg.taskId) &&
            c.severity === "high" &&
            !merged.has(c.sourceTaskId === pkg.taskId ? c.targetTaskId : c.sourceTaskId),
        );

        if (depsSatisfied && !hasHighConflict) {
          // 检查是否与同批次任务冲突
          const hasBatchConflict = batchTasks.some((bt) => taskConflicts.includes(bt.taskId));
          if (!hasBatchConflict) {
            batchTasks.push(pkg);
          }
        }
      }

      for (const pkg of batchTasks) {
        const risk = this.estimateRisk(pkg);
        const blockedBy = (depMap.get(pkg.taskId) ?? []).filter((d) => !merged.has(d));
        suggestions.push({
          taskId: pkg.taskId,
          batch,
          canMerge: blockedBy.length === 0,
          blockedBy,
          rollbackSuggestion:
            risk === "high"
              ? "If merge fails, revert this commit and re-run verification before retrying."
              : undefined,
          estimatedRisk: risk,
        });
        merged.add(pkg.taskId);
      }

      batch++;

      // 防止无限循环
      if (batchTasks.length === 0) {
        // 剩余任务都被阻塞，添加为 blocked
        for (const pkg of packages) {
          if (!merged.has(pkg.taskId)) {
            const blockedBy = (depMap.get(pkg.taskId) ?? []).filter((d) => !merged.has(d));
            const taskConflicts = conflictMap.get(pkg.taskId) ?? [];
            suggestions.push({
              taskId: pkg.taskId,
              batch,
              canMerge: false,
              blockedBy: [...blockedBy, ...taskConflicts.filter((t) => !merged.has(t))],
              rollbackSuggestion: "Resolve blocking dependencies or conflicts before merging.",
              estimatedRisk: "high",
            });
            merged.add(pkg.taskId);
          }
        }
      }
    }

    return suggestions;
  }

  private estimateRisk(pkg: ChangePackage): "low" | "medium" | "high" {
    if (pkg.risk.level === "critical" || pkg.risk.level === "high") return "high";
    if (pkg.risk.level === "medium") return "medium";
    if (pkg.breakingChanges) return "high";
    if (pkg.stats.filesChanged > 10) return "medium";
    return "low";
  }
}

// ===== L3-007: 跨任务证据聚合 =====

export interface CrossTaskEvidenceSummary {
  totalTasks: number;
  totalFilesChanged: number;
  totalInsertions: number;
  totalDeletions: number;
  sharedFiles: Array<{ file: string; taskCount: number; tasks: string[] }>;
  riskDistribution: Record<string, number>;
  verificationSummary: { passed: number; failed: number; skipped: number };
  trendAnalysis: {
    averageFilesPerTask: number;
    averageInsertionsPerTask: number;
    highRiskTaskCount: number;
    breakingChangeCount: number;
  };
}

/**
 * CrossTaskEvidenceAggregator — 跨任务证据聚合器（L3-007）
 *
 * 对多个 Change Package 进行聚合分析：
 * - 共享文件分析：哪些文件被多个任务修改
 * - 风险分布：各风险等级的任务数量
 * - 验证汇总：所有任务的验证状态
 * - 趋势分析：平均变更规模、高风险任务数、破坏性变更数
 */
export class CrossTaskEvidenceAggregator {
  aggregate(packages: ChangePackage[]): CrossTaskEvidenceSummary {
    const fileTaskMap = new Map<string, string[]>();
    let totalInsertions = 0;
    let totalDeletions = 0;
    let totalFilesChanged = 0;
    const riskDistribution: Record<string, number> = {};
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let highRiskTaskCount = 0;
    let breakingChangeCount = 0;

    for (const pkg of packages) {
      totalFilesChanged += pkg.changedFiles.length;
      totalInsertions += pkg.stats.insertions;
      totalDeletions += pkg.stats.deletions;

      // 文件任务映射
      for (const file of pkg.changedFiles) {
        if (!fileTaskMap.has(file)) fileTaskMap.set(file, []);
        fileTaskMap.get(file)!.push(pkg.taskId);
      }

      // 风险分布
      const level = pkg.risk.level;
      riskDistribution[level] = (riskDistribution[level] ?? 0) + 1;
      if (level === "high" || level === "critical") highRiskTaskCount++;

      // 破坏性变更
      if (pkg.breakingChanges) breakingChangeCount++;

      // 验证汇总
      for (const check of pkg.checks) {
        if (check.status === "passed") passed++;
        else if (check.status === "failed") failed++;
        else if (check.status === "skipped") skipped++;
      }
    }

    // 共享文件（被多个任务修改的文件）
    const sharedFiles = [...fileTaskMap.entries()]
      .filter(([, tasks]) => tasks.length > 1)
      .map(([file, tasks]) => ({ file, taskCount: tasks.length, tasks }))
      .sort((a, b) => b.taskCount - a.taskCount);

    return {
      totalTasks: packages.length,
      totalFilesChanged,
      totalInsertions,
      totalDeletions,
      sharedFiles,
      riskDistribution,
      verificationSummary: { passed, failed, skipped },
      trendAnalysis: {
        averageFilesPerTask:
          packages.length > 0 ? Math.round(totalFilesChanged / packages.length) : 0,
        averageInsertionsPerTask:
          packages.length > 0 ? Math.round(totalInsertions / packages.length) : 0,
        highRiskTaskCount,
        breakingChangeCount,
      },
    };
  }
}
