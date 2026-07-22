import type {
  ComplianceReportFormat,
  ComplianceReportOptions,
  ComplianceReportProvider,
  ComplianceReportResult,
  ComplianceStandard,
} from "@agentgitops/core";

/**
 * EnterpriseComplianceReportProvider — EE 合规报告 Provider（P1-006）
 *
 * 实现 ComplianceReportProvider 端口，生成 SOC2/ISO27001/GDPR 友好的合规报告。
 *
 * 设计原则：
 * 1. 从审计事件、策略变更、权限变更聚合数据
 * 2. 按合规标准组织报告结构
 * 3. 支持 JSON/CSV/PDF 格式
 * 4. 报告可追溯、可审计
 *
 * 使用方式：
 *   const provider = new EnterpriseComplianceReportProvider({
 *     storageAdapter,
 *     auditSink,
 *   });
 *   const report = await provider.generate({
 *     format: "json",
 *     standard: "soc2",
 *     startDate: "2026-01-01",
 *     endDate: "2026-07-12",
 *   });
 */
export interface ComplianceReportConfig {
  /** 存储适配器（查询审计事件） */
  storageAdapter?: {
    query: (text: string, params?: unknown[]) => Promise<unknown[]> | unknown[];
  };
  /** 审计 Sink（获取审计条目） */
  auditSink?: {
    getEntries?: () => unknown[];
    export?: (options: unknown) => Promise<string> | string;
  };
  /** 报告存储目录 */
  reportStorageDir?: string;
}

export class EnterpriseComplianceReportProvider implements ComplianceReportProvider {
  private config: ComplianceReportConfig;
  private reports: Map<string, ComplianceReportResult> = new Map();

  constructor(config: ComplianceReportConfig = {}) {
    this.config = config;
  }

  /**
   * 生成合规报告
   *
   * 1. 从审计事件聚合数据
   * 2. 按合规标准组织结构
   * 3. 生成摘要
   * 4. 按格式输出
   */
  async generate(options: ComplianceReportOptions): Promise<ComplianceReportResult> {
    const reportId = `report-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const generatedAt = new Date().toISOString();

    // 聚合审计数据
    const auditData = await this.aggregateAuditData(options);

    // 按合规标准组织
    const reportData = this.organizeByStandard(options.standard, auditData, options);

    const result: ComplianceReportResult = {
      reportId,
      standard: options.standard,
      format: options.format,
      generatedAt,
      period: { start: options.startDate, end: options.endDate },
      summary: auditData.summary,
      data: reportData,
    };

    // 持久化报告
    this.reports.set(reportId, result);

    return result;
  }

  /**
   * 聚合审计数据
   *
   * 从存储或审计 Sink 获取审计事件，统计：
   * - 审计事件总数
   * - 策略变更数
   * - 权限变更数
   * - 高风险操作数
   * - 验证失败数
   */
  private async aggregateAuditData(options: ComplianceReportOptions): Promise<{
    events: Array<Record<string, unknown>>;
    summary: ComplianceReportResult["summary"];
  }> {
    let events: Array<Record<string, unknown>> = [];

    // 优先从存储适配器查询
    if (this.config.storageAdapter) {
      const params: unknown[] = [options.startDate, options.endDate];
      let projectFilter = "";
      if (options.projectId) {
        projectFilter = " AND project_id = $3";
        params.push(options.projectId);
      }

      events = (await this.config.storageAdapter.query(
        `SELECT * FROM audit_events WHERE timestamp >= $1 AND timestamp <= $2${projectFilter} ORDER BY timestamp ASC`,
        params,
      )) as Array<Record<string, unknown>>;
    } else if (this.config.auditSink?.getEntries) {
      // 降级：从审计 Sink 内存获取
      const allEntries = this.config.auditSink.getEntries() as Array<Record<string, unknown>>;
      events = allEntries.filter((e) => {
        const ts = e.timestamp as string;
        if (ts < options.startDate || ts > options.endDate) return false;
        if (options.projectId && e.projectId !== options.projectId) return false;
        return true;
      });
    }

    // 统计摘要
    const summary: ComplianceReportResult["summary"] = {
      totalAuditEvents: events.length,
      totalPolicyChanges: this.countEvents(events, [
        "policy.update",
        "policy.create",
        "policy.delete",
      ]),
      totalAccessChanges: this.countEvents(events, [
        "user.role.assign",
        "user.role.revoke",
        "rbac.update",
        "sso.config",
      ]),
      highRiskActions: this.countEvents(events, [
        "merge.force",
        "policy.violation",
        "task.escalate",
        "high_risk",
      ]),
      failedVerifications: this.countEvents(events, [
        "verification.failed",
        "check.failed",
        "gate.blocked",
      ]),
    };

    return { events, summary };
  }

  /**
   * 统计匹配事件类型的事件数
   *
   * 兼容两种字段名：
   * - event_type（数据库行字段名，来自 PostgreSQL/SQLite 查询）
   * - eventType（TypeScript 属性名，来自 SiemAuditSink entries）
   */
  private countEvents(events: Array<Record<string, unknown>>, eventTypes: string[]): number {
    return events.filter((e) => {
      const eventType = (e.event_type ?? e.eventType) as string | undefined;
      if (!eventType) return false;
      return eventTypes.some((t) => eventType.includes(t));
    }).length;
  }

  /**
   * 按合规标准组织报告数据
   *
   * SOC2：安全、可用性、处理完整性、保密性、隐私性
   * ISO27001：信息安全管理体系（ISMS）控制项
   * GDPR：数据保护、用户权利、数据泄露通知
   */
  private organizeByStandard(
    standard: ComplianceStandard,
    auditData: {
      events: Array<Record<string, unknown>>;
      summary: ComplianceReportResult["summary"];
    },
    options: ComplianceReportOptions,
  ): unknown {
    const { events, summary } = auditData;

    switch (standard) {
      case "soc2":
        return this.organizeSoc2(events, summary, options);

      case "iso27001":
        return this.organizeIso27001(events, summary, options);

      case "gdpr":
        return this.organizeGdpr(events, summary, options);

      case "custom":
      default:
        return {
          standard: "custom",
          period: { start: options.startDate, end: options.endDate },
          summary,
          events: options.includeAuditEvents ? events : undefined,
          policyChanges: options.includePolicyChanges
            ? events.filter((e) => String(e.event_type ?? e.eventType).includes("policy"))
            : undefined,
          accessChanges: options.includeAccessChanges
            ? events.filter((e) =>
                ["user.role", "rbac", "sso"].some((t) =>
                  String(e.event_type ?? e.eventType).includes(t),
                ),
              )
            : undefined,
        };
    }
  }

  /**
   * SOC2 报告结构
   *
   * 五个信任服务标准：
   * - Security（安全）
   * - Availability（可用性）
   * - Processing Integrity（处理完整性）
   * - Confidentiality（保密性）
   * - Privacy（隐私性）
   */
  private organizeSoc2(
    events: Array<Record<string, unknown>>,
    summary: ComplianceReportResult["summary"],
    options: ComplianceReportOptions,
  ): unknown {
    return {
      standard: "SOC2",
      trustServiceCriteria: {
        security: {
          description: "Information and systems are protected against unauthorized access",
          controls: [
            {
              id: "CC6.1",
              description: "Logical and physical access controls",
              evidence: this.filterEvents(events, ["auth", "login", "access", "rbac", "sso"]),
              status: "operational",
            },
            {
              id: "CC6.6",
              description: "Access restrictions to protect against unauthorized access",
              evidence: this.filterEvents(events, ["policy.violation", "forbidden", "deny"]),
              status: summary.highRiskActions > 0 ? "exceptions_noted" : "operational",
            },
          ],
        },
        availability: {
          description: "Information and systems are available for operation and use",
          controls: [
            {
              id: "A1.1",
              description: "System availability monitoring",
              evidence: this.filterEvents(events, ["health", "system", "server"]),
              status: "operational",
            },
          ],
        },
        processingIntegrity: {
          description: "System processing is complete, valid, accurate, timely, and authorized",
          controls: [
            {
              id: "PI1.1",
              description: "Processing validation and error handling",
              evidence: this.filterEvents(events, ["verification", "check", "gate"]),
              status: summary.failedVerifications > 0 ? "exceptions_noted" : "operational",
            },
          ],
        },
        confidentiality: {
          description: "Information designated as confidential is protected",
          controls: [
            {
              id: "C1.1",
              description: "Confidentiality controls",
              evidence: this.filterEvents(events, ["secret", "scan", "security"]),
              status: "operational",
            },
          ],
        },
        privacy: {
          description:
            "Personal information is collected, used, retained, and disclosed in accordance with commitments",
          controls: [
            {
              id: "P1.1",
              description: "Privacy policy and notices",
              evidence: this.filterEvents(events, ["privacy", "data", "redact"]),
              status: "operational",
            },
          ],
        },
      },
      summary,
      period: { start: options.startDate, end: options.endDate },
    };
  }

  /**
   * ISO27001 报告结构
   *
   * 基于 Annex A 控制项：
   * - A.5 信息安全策略
   * - A.6 组织信息安全
   * - A.8 资产管理
   * - A.9 访问控制
   * - A.12 运营安全
   */
  private organizeIso27001(
    events: Array<Record<string, unknown>>,
    summary: ComplianceReportResult["summary"],
    options: ComplianceReportOptions,
  ): unknown {
    return {
      standard: "ISO27001",
      ismsControls: {
        "A.5": {
          title: "Information security policies",
          evidence: this.filterEvents(events, ["policy"]),
          status: summary.totalPolicyChanges > 0 ? "updated" : "stable",
        },
        "A.6": {
          title: "Organization of information security",
          evidence: this.filterEvents(events, ["organization", "team"]),
          status: "operational",
        },
        "A.8": {
          title: "Asset management",
          evidence: this.filterEvents(events, ["asset", "repo", "project"]),
          status: "operational",
        },
        "A.9": {
          title: "Access control",
          evidence: this.filterEvents(events, ["access", "rbac", "sso", "auth"]),
          status: summary.totalAccessChanges > 0 ? "updated" : "stable",
        },
        "A.12": {
          title: "Operations security",
          evidence: this.filterEvents(events, ["verification", "check", "merge", "gate"]),
          status: summary.failedVerifications > 0 ? "exceptions_noted" : "operational",
        },
      },
      summary,
      period: { start: options.startDate, end: options.endDate },
    };
  }

  /**
   * GDPR 报告结构
   *
   * 关键条款：
   * - Art. 5 数据处理原则
   * - Art. 15-22 数据主体权利
   * - Art. 25 隐私设计
   * - Art. 32 安全处理
   * - Art. 33-34 数据泄露通知
   */
  private organizeGdpr(
    events: Array<Record<string, unknown>>,
    summary: ComplianceReportResult["summary"],
    options: ComplianceReportOptions,
  ): unknown {
    return {
      standard: "GDPR",
      articles: {
        "Art.5": {
          title: "Principles relating to processing of personal data",
          evidence: this.filterEvents(events, ["data", "redact", "privacy"]),
          status: "compliant",
        },
        "Art.15-22": {
          title: "Data subject rights",
          evidence: this.filterEvents(events, ["access", "export", "delete"]),
          status: "operational",
        },
        "Art.25": {
          title: "Data protection by design and by default",
          evidence: this.filterEvents(events, ["policy", "config"]),
          status: "operational",
        },
        "Art.32": {
          title: "Security of processing",
          evidence: this.filterEvents(events, ["security", "scan", "secret", "auth"]),
          status: summary.highRiskActions > 0 ? "review_required" : "compliant",
        },
        "Art.33-34": {
          title: "Notification of personal data breach",
          evidence: this.filterEvents(events, ["breach", "incident", "violation"]),
          status: summary.highRiskActions > 0 ? "review_required" : "no_breaches",
        },
      },
      summary,
      period: { start: options.startDate, end: options.endDate },
    };
  }

  /**
   * 过滤事件（按关键词匹配 event_type）
   */
  private filterEvents(
    events: Array<Record<string, unknown>>,
    keywords: string[],
  ): Array<Record<string, unknown>> {
    return events.filter((e) => {
      const eventType = String(e.event_type ?? e.eventType ?? "").toLowerCase();
      return keywords.some((k) => eventType.includes(k));
    });
  }

  /**
   * 获取已生成的报告列表
   */
  listReports(): ComplianceReportResult[] {
    return Array.from(this.reports.values());
  }

  /**
   * 下载报告
   */
  download(reportId: string): { data: string; format: ComplianceReportFormat } {
    const report = this.reports.get(reportId);
    if (!report) {
      return { data: JSON.stringify({ error: "Report not found" }), format: "json" };
    }

    switch (report.format) {
      case "json":
        return { data: JSON.stringify(report, null, 2), format: "json" };

      case "csv": {
        // 将 summary 和 data 扁平化为 CSV
        const rows = [
          [
            "reportId",
            "standard",
            "format",
            "generatedAt",
            "periodStart",
            "periodEnd",
            "totalAuditEvents",
            "totalPolicyChanges",
            "totalAccessChanges",
            "highRiskActions",
            "failedVerifications",
          ],
          [
            report.reportId,
            report.standard,
            report.format,
            report.generatedAt,
            report.period.start,
            report.period.end,
            String(report.summary.totalAuditEvents),
            String(report.summary.totalPolicyChanges),
            String(report.summary.totalAccessChanges),
            String(report.summary.highRiskActions),
            String(report.summary.failedVerifications),
          ],
        ];
        return { data: rows.map((r) => r.join(",")).join("\n"), format: "csv" };
      }

      case "pdf":
        // PDF 生成需要额外依赖，这里返回 JSON 格式（实际 EE 环境可注入 PDF 生成器）
        return {
          data: JSON.stringify({
            ...report,
            note: "PDF generation requires PDF library in EE environment",
          }),
          format: "pdf",
        };

      default:
        return { data: JSON.stringify(report), format: "json" };
    }
  }
}
