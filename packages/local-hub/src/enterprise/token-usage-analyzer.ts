/**
 * TokenUsageAnalyzer — EE Token 使用分析（P2-003）
 *
 * 按团队/项目/Agent 类型分析 Token 使用。
 *
 * 使用方式：
 *   const analyzer = new TokenUsageAnalyzer();
 *   analyzer.record({ agentId: "claude-code", projectId: "p1", teamId: "t1", inputTokens: 1000, outputTokens: 500, cost: 0.015 });
 *   const summary = analyzer.getSummary({ startDate: "2026-07-01", endDate: "2026-07-12" });
 */
export interface TokenUsageRecord {
  recordId: string;
  agentId: string;
  agentType: string;
  projectId: string;
  teamId?: string;
  taskId?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cost: number;
  duration: number;
  timestamp: string;
}

export interface TokenUsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCost: number;
  totalDuration: number;
  recordCount: number;
  byAgent: Array<{
    agentId: string;
    agentType: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cost: number;
    taskCount: number;
    avgCostPerTask: number;
  }>;
  byProject: Array<{
    projectId: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cost: number;
  }>;
  byTeam: Array<{
    teamId: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cost: number;
  }>;
  byModel: Array<{
    model: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cost: number;
  }>;
  dailyTrend: Array<{
    date: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
  }>;
}

export interface TokenUsageFilter {
  startDate?: string;
  endDate?: string;
  agentId?: string;
  projectId?: string;
  teamId?: string;
  model?: string;
}

export class TokenUsageAnalyzer {
  private records: TokenUsageRecord[] = [];

  /**
   * 记录 Token 使用
   */
  record(
    input: Omit<TokenUsageRecord, "recordId" | "timestamp"> & { timestamp?: string },
  ): TokenUsageRecord {
    const record: TokenUsageRecord = {
      ...input,
      recordId: `tu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: input.timestamp ?? new Date().toISOString(),
    };
    this.records.push(record);
    return record;
  }

  /**
   * 获取汇总分析
   */
  getSummary(filter?: TokenUsageFilter): TokenUsageSummary {
    const filtered = this.filterRecords(filter);

    const byAgentMap = new Map<string, TokenUsageSummary["byAgent"][number]>();
    const byProjectMap = new Map<string, TokenUsageSummary["byProject"][number]>();
    const byTeamMap = new Map<string, TokenUsageSummary["byTeam"][number]>();
    const byModelMap = new Map<string, TokenUsageSummary["byModel"][number]>();
    const dailyMap = new Map<string, { inputTokens: number; outputTokens: number; cost: number }>();

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCost = 0;
    let totalDuration = 0;

    for (const r of filtered) {
      totalInputTokens += r.inputTokens;
      totalOutputTokens += r.outputTokens;
      totalCost += r.cost;
      totalDuration += r.duration;

      // by agent
      const agentKey = r.agentId;
      const agent = byAgentMap.get(agentKey) ?? {
        agentId: r.agentId,
        agentType: r.agentType,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cost: 0,
        taskCount: 0,
        avgCostPerTask: 0,
      };
      agent.inputTokens += r.inputTokens;
      agent.outputTokens += r.outputTokens;
      agent.totalTokens += r.inputTokens + r.outputTokens;
      agent.cost += r.cost;
      agent.taskCount += 1;
      byAgentMap.set(agentKey, agent);

      // by project
      const proj = byProjectMap.get(r.projectId) ?? {
        projectId: r.projectId,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cost: 0,
      };
      proj.inputTokens += r.inputTokens;
      proj.outputTokens += r.outputTokens;
      proj.totalTokens += r.inputTokens + r.outputTokens;
      proj.cost += r.cost;
      byProjectMap.set(r.projectId, proj);

      // by team
      if (r.teamId) {
        const team = byTeamMap.get(r.teamId) ?? {
          teamId: r.teamId,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cost: 0,
        };
        team.inputTokens += r.inputTokens;
        team.outputTokens += r.outputTokens;
        team.totalTokens += r.inputTokens + r.outputTokens;
        team.cost += r.cost;
        byTeamMap.set(r.teamId, team);
      }

      // by model
      const model = byModelMap.get(r.model) ?? {
        model: r.model,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cost: 0,
      };
      model.inputTokens += r.inputTokens;
      model.outputTokens += r.outputTokens;
      model.totalTokens += r.inputTokens + r.outputTokens;
      model.cost += r.cost;
      byModelMap.set(r.model, model);

      // daily trend
      const date = r.timestamp.slice(0, 10);
      const daily = dailyMap.get(date) ?? { inputTokens: 0, outputTokens: 0, cost: 0 };
      daily.inputTokens += r.inputTokens;
      daily.outputTokens += r.outputTokens;
      daily.cost += r.cost;
      dailyMap.set(date, daily);
    }

    // 计算平均每任务成本
    const byAgent = Array.from(byAgentMap.values()).map((a) => ({
      ...a,
      avgCostPerTask: a.taskCount > 0 ? a.cost / a.taskCount : 0,
    }));

    return {
      totalInputTokens,
      totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
      totalCost,
      totalDuration,
      recordCount: filtered.length,
      byAgent: byAgent.sort((a, b) => b.cost - a.cost),
      byProject: Array.from(byProjectMap.values()).sort((a, b) => b.cost - a.cost),
      byTeam: Array.from(byTeamMap.values()).sort((a, b) => b.cost - a.cost),
      byModel: Array.from(byModelMap.values()).sort((a, b) => b.cost - a.cost),
      dailyTrend: Array.from(dailyMap.entries())
        .map(([date, v]) => ({ date, ...v }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    };
  }

  /**
   * 过滤记录
   */
  private filterRecords(filter?: TokenUsageFilter): TokenUsageRecord[] {
    if (!filter) return [...this.records];
    return this.records.filter((r) => {
      if (filter.startDate && r.timestamp < filter.startDate) return false;
      if (filter.endDate && r.timestamp > filter.endDate) return false;
      if (filter.agentId && r.agentId !== filter.agentId) return false;
      if (filter.projectId && r.projectId !== filter.projectId) return false;
      if (filter.teamId && r.teamId !== filter.teamId) return false;
      if (filter.model && r.model !== filter.model) return false;
      return true;
    });
  }

  /**
   * 导出 CSV
   */
  exportCsv(filter?: TokenUsageFilter): string {
    const records = this.filterRecords(filter);
    const headers = [
      "recordId",
      "timestamp",
      "agentId",
      "agentType",
      "projectId",
      "teamId",
      "taskId",
      "model",
      "inputTokens",
      "outputTokens",
      "cost",
      "duration",
    ];
    const rows = records.map((r) => [
      r.recordId,
      r.timestamp,
      r.agentId,
      r.agentType,
      r.projectId,
      r.teamId ?? "",
      r.taskId ?? "",
      r.model,
      String(r.inputTokens),
      String(r.outputTokens),
      String(r.cost),
      String(r.duration),
    ]);
    return [headers, ...rows].map((row) => row.join(",")).join("\n");
  }
}

/**
 * AgentVendorComparator — EE Agent 供应商对比（P2-004）
 *
 * 对比不同 Agent（Claude vs Codex vs Cursor）的质量、成本、速度。
 *
 * 使用方式：
 *   const comparator = new AgentVendorComparator(tokenAnalyzer);
 *   const comparison = comparator.compare({
 *     startDate: "2026-07-01",
 *     endDate: "2026-07-12",
 *   });
 */
export interface AgentVendorComparison {
  vendors: Array<{
    agentId: string;
    agentType: string;
    taskCount: number;
    successRate: number;
    reworkRate: number;
    avgMergeTimeHours: number;
    avgCostPerTask: number;
    totalCost: number;
    avgTokensPerTask: number;
    avgDuration: number;
    conflictRate: number;
    score: number;
  }>;
  recommendation: string;
  bestForCost: string;
  bestForQuality: string;
  bestForSpeed: string;
}

export interface AgentVendorComparatorConfig {
  tokenAnalyzer: TokenUsageAnalyzer;
  /** 任务结果数据源（成功率/返工率等） */
  taskResults?: Array<{
    agentId: string;
    agentType: string;
    success: boolean;
    reworked: boolean;
    mergeTimeHours?: number;
    hadConflict: boolean;
    duration: number;
  }>;
}

export class AgentVendorComparator {
  private config: AgentVendorComparatorConfig;

  constructor(config: AgentVendorComparatorConfig) {
    this.config = config;
  }

  /**
   * 对比不同 Agent 供应商
   */
  compare(filter?: TokenUsageFilter): AgentVendorComparison {
    const tokenSummary = this.config.tokenAnalyzer.getSummary(filter);
    const taskResults = this.config.taskResults ?? [];

    // 按 agent 聚合任务结果
    const taskStatsMap = new Map<
      string,
      {
        total: number;
        success: number;
        reworked: number;
        mergeTimeSum: number;
        mergeTimeCount: number;
        conflict: number;
        durationSum: number;
      }
    >();

    for (const tr of taskResults) {
      const stats = taskStatsMap.get(tr.agentId) ?? {
        total: 0,
        success: 0,
        reworked: 0,
        mergeTimeSum: 0,
        mergeTimeCount: 0,
        conflict: 0,
        durationSum: 0,
      };
      stats.total += 1;
      if (tr.success) stats.success += 1;
      if (tr.reworked) stats.reworked += 1;
      if (tr.mergeTimeHours !== undefined) {
        stats.mergeTimeSum += tr.mergeTimeHours;
        stats.mergeTimeCount += 1;
      }
      if (tr.hadConflict) stats.conflict += 1;
      stats.durationSum += tr.duration;
      taskStatsMap.set(tr.agentId, stats);
    }

    const vendors: AgentVendorComparison["vendors"] = tokenSummary.byAgent.map((agent) => {
      const stats = taskStatsMap.get(agent.agentId);
      const taskCount = stats?.total ?? agent.taskCount;
      const successRate = stats ? stats.success / stats.total : 0;
      const reworkRate = stats ? stats.reworked / stats.total : 0;
      const avgMergeTimeHours =
        stats && stats.mergeTimeCount > 0 ? stats.mergeTimeSum / stats.mergeTimeCount : 0;
      const conflictRate = stats ? stats.conflict / stats.total : 0;
      const avgDuration = taskCount > 0 ? (stats?.durationSum ?? 0) / taskCount : 0;

      // 综合评分（0-100）：成功率 40% + 成本效率 30% + 速度 20% + 低冲突 10%
      const costEfficiency =
        agent.avgCostPerTask > 0 ? Math.min(100, 10 / agent.avgCostPerTask) : 50;
      const speedScore = avgDuration > 0 ? Math.min(100, 60000 / avgDuration) : 50;
      const score =
        successRate * 100 * 0.4 +
        costEfficiency * 0.3 +
        speedScore * 0.2 +
        (1 - conflictRate) * 100 * 0.1;

      return {
        agentId: agent.agentId,
        agentType: agent.agentType,
        taskCount,
        successRate,
        reworkRate,
        avgMergeTimeHours,
        avgCostPerTask: agent.avgCostPerTask,
        totalCost: agent.cost,
        avgTokensPerTask: agent.taskCount > 0 ? agent.totalTokens / agent.taskCount : 0,
        avgDuration,
        conflictRate,
        score: Math.round(score * 10) / 10,
      };
    });

    vendors.sort((a, b) => b.score - a.score);

    const bestForCost =
      vendors.length > 0
        ? [...vendors].sort((a, b) => a.avgCostPerTask - b.avgCostPerTask)[0].agentId
        : "";
    const bestForQuality =
      vendors.length > 0
        ? [...vendors].sort((a, b) => b.successRate - a.successRate)[0].agentId
        : "";
    const bestForSpeed =
      vendors.length > 0
        ? [...vendors].sort((a, b) => a.avgDuration - b.avgDuration)[0].agentId
        : "";

    const recommendation =
      vendors.length > 0
        ? `推荐使用 ${vendors[0].agentId}（综合评分 ${vendors[0].score}）。成本最优：${bestForCost}；质量最优：${bestForQuality}；速度最优：${bestForSpeed}。`
        : "无足够数据进行对比";

    return {
      vendors,
      recommendation,
      bestForCost,
      bestForQuality,
      bestForSpeed,
    };
  }
}
