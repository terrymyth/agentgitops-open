import type { PolicyInheritanceLayer } from "@agentgitops/core";

/**
 * PolicyTemplateLibrary — EE 策略模板库（P2-001）
 *
 * 提供金融/医疗/通用企业策略模板，支持快速配置和自定义。
 *
 * 使用方式：
 *   const library = new PolicyTemplateLibrary();
 *   const template = library.getTemplate("financial");
 *   const policy = library.applyTemplate("financial", { organizationId: "org-1" });
 */
export interface PolicyTemplate {
  id: string;
  name: string;
  description: string;
  industry: "financial" | "healthcare" | "general" | "government" | "technology";
  policy: PolicyInheritanceLayer;
  tags: string[];
}

export class PolicyTemplateLibrary {
  private templates: Map<string, PolicyTemplate> = new Map();

  constructor() {
    this.registerBuiltInTemplates();
  }

  /**
   * 注册内置模板
   */
  private registerBuiltInTemplates(): void {
    // 金融行业模板
    this.register({
      id: "financial",
      name: "金融行业策略模板",
      description: "面向银行/证券/保险的严格策略：强保护分支、严格审批、禁止敏感路径",
      industry: "financial",
      tags: ["strict", "compliance", "audit"],
      policy: {
        protectedBranches: ["main", "master", "release/*", "hotfix/*"],
        forbiddenPaths: ["secrets/**", "*.pem", "*.key", "*.p12", "config/prod/**", ".env*"],
        forbiddenForAgentsPaths: ["db/migrations/**", "infra/terraform/**", "config/prod/**"],
        highRiskPaths: [
          "src/auth/**",
          "src/payment/**",
          "src/compliance/**",
          "db/migrations/**",
          "infra/**",
        ],
        forbiddenCommands: [
          "rm -rf",
          "git push --force",
          "git reset --hard",
          "DROP TABLE",
          "DROP DATABASE",
        ],
        requiredReviewers: {
          "src/auth/**": ["security-team", "architect"],
          "src/payment/**": ["payment-team", "security-team"],
        },
        requiredChecks: [
          { name: "lint", command: "npm run lint" },
          { name: "test", command: "npm test" },
          { name: "sast", command: "semgrep --config=auto" },
          { name: "secret-scan", command: "gitleaks detect" },
        ],
        mergeRules: {
          allowAutoMergeForLowRisk: false,
          blockMergeIfUnverifiedItemsExist: true,
          blockMergeIfConflictExists: true,
        },
        limits: { maxChangedFiles: 20, maxInsertions: 500, maxDeletions: 200 },
      },
    });

    // 医疗行业模板
    this.register({
      id: "healthcare",
      name: "医疗行业策略模板",
      description: "面向医疗/HIPAA 合规的策略：PHI 保护、严格审计、数据脱敏",
      industry: "healthcare",
      tags: ["hipaa", "phi", "compliance"],
      policy: {
        protectedBranches: ["main", "master", "release/*"],
        forbiddenPaths: ["secrets/**", "*.pem", "*.key", "data/phi/**", "data/patient/**"],
        forbiddenForAgentsPaths: ["db/migrations/**", "data/**"],
        highRiskPaths: ["src/phi/**", "src/patient/**", "src/auth/**", "db/migrations/**"],
        forbiddenCommands: ["rm -rf", "git push --force", "DROP TABLE", "DELETE FROM patients"],
        requiredReviewers: { "src/phi/**": ["compliance-officer", "architect"] },
        requiredChecks: [
          { name: "lint", command: "npm run lint" },
          { name: "test", command: "npm test" },
          { name: "secret-scan", command: "gitleaks detect" },
          { name: "dependency-scan", command: "npm audit --audit-level=high" },
        ],
        mergeRules: {
          allowAutoMergeForLowRisk: false,
          blockMergeIfUnverifiedItemsExist: true,
          blockMergeIfConflictExists: true,
        },
        limits: { maxChangedFiles: 15, maxInsertions: 400, maxDeletions: 150 },
      },
    });

    // 通用企业模板
    this.register({
      id: "general-enterprise",
      name: "通用企业策略模板",
      description: "面向一般企业的平衡策略：适度保护、常规审批",
      industry: "general",
      tags: ["balanced", "enterprise"],
      policy: {
        protectedBranches: ["main", "master", "release/*"],
        forbiddenPaths: ["secrets/**", "*.pem", "*.key", ".env*"],
        forbiddenForAgentsPaths: ["db/migrations/**", "infra/**"],
        highRiskPaths: ["src/auth/**", "db/migrations/**", "infra/**", ".github/**"],
        forbiddenCommands: ["rm -rf", "git push --force"],
        requiredReviewers: { "src/auth/**": ["security-team"] },
        requiredChecks: [
          { name: "lint", command: "npm run lint" },
          { name: "test", command: "npm test" },
        ],
        mergeRules: {
          allowAutoMergeForLowRisk: true,
          blockMergeIfUnverifiedItemsExist: true,
          blockMergeIfConflictExists: true,
        },
        limits: { maxChangedFiles: 30, maxInsertions: 800, maxDeletions: 300 },
      },
    });

    // 政府行业模板
    this.register({
      id: "government",
      name: "政府行业策略模板",
      description: "面向政府/公共部门的严格策略：等保合规、数据主权",
      industry: "government",
      tags: ["strict", "compliance", "data-sovereignty"],
      policy: {
        protectedBranches: ["main", "master", "release/*", "prod/*"],
        forbiddenPaths: ["secrets/**", "*.pem", "*.key", "config/prod/**", "data/classified/**"],
        forbiddenForAgentsPaths: ["db/migrations/**", "infra/**", "config/prod/**"],
        highRiskPaths: ["src/auth/**", "src/security/**", "db/migrations/**", "infra/**"],
        forbiddenCommands: ["rm -rf", "git push --force", "git reset --hard", "DROP TABLE"],
        requiredReviewers: { "src/security/**": ["security-officer", "architect"] },
        requiredChecks: [
          { name: "lint", command: "npm run lint" },
          { name: "test", command: "npm test" },
          { name: "sast", command: "semgrep --config=auto" },
          { name: "secret-scan", command: "gitleaks detect" },
        ],
        mergeRules: {
          allowAutoMergeForLowRisk: false,
          blockMergeIfUnverifiedItemsExist: true,
          blockMergeIfConflictExists: true,
        },
        limits: { maxChangedFiles: 15, maxInsertions: 300, maxDeletions: 100 },
      },
    });

    // 科技行业模板
    this.register({
      id: "technology",
      name: "科技行业策略模板",
      description: "面向科技公司的敏捷策略：快速迭代、自动化优先",
      industry: "technology",
      tags: ["agile", "automation"],
      policy: {
        protectedBranches: ["main", "release/*"],
        forbiddenPaths: ["secrets/**", "*.pem", "*.key"],
        forbiddenForAgentsPaths: ["db/migrations/**"],
        highRiskPaths: ["src/auth/**", "db/migrations/**"],
        forbiddenCommands: ["rm -rf /", "git push --force main"],
        requiredChecks: [
          { name: "lint", command: "npm run lint" },
          { name: "test", command: "npm test" },
        ],
        mergeRules: {
          allowAutoMergeForLowRisk: true,
          blockMergeIfUnverifiedItemsExist: true,
          blockMergeIfConflictExists: true,
        },
        limits: { maxChangedFiles: 50, maxInsertions: 1000, maxDeletions: 500 },
      },
    });
  }

  /**
   * 注册自定义模板
   */
  register(template: PolicyTemplate): void {
    this.templates.set(template.id, template);
  }

  /**
   * 获取模板
   */
  getTemplate(id: string): PolicyTemplate | null {
    return this.templates.get(id) ?? null;
  }

  /**
   * 列出所有模板
   */
  listTemplates(): PolicyTemplate[] {
    return Array.from(this.templates.values());
  }

  /**
   * 按行业筛选模板
   */
  getByIndustry(industry: PolicyTemplate["industry"]): PolicyTemplate[] {
    return this.listTemplates().filter((t) => t.industry === industry);
  }

  /**
   * 应用模板到组织
   *
   * 返回 PolicyInheritanceLayer，可直接用于 OrganizationPolicyProvider。
   */
  applyTemplate(
    templateId: string,
    overrides?: Partial<PolicyInheritanceLayer>,
  ): PolicyInheritanceLayer {
    const template = this.getTemplate(templateId);
    if (!template) {
      throw new Error(
        `Policy template "${templateId}" not found. Available: ${this.listTemplateIds().join(", ")}`,
      );
    }

    return {
      ...template.policy,
      ...overrides,
    };
  }

  /**
   * 列出所有模板 ID
   */
  listTemplateIds(): string[] {
    return Array.from(this.templates.keys());
  }
}

/**
 * PolicyVersionManager — EE 策略版本管理（P2-002）
 *
 * 策略变更历史、变更 diff、回滚。
 *
 * 使用方式：
 *   const manager = new PolicyVersionManager();
 *   manager.saveVersion("org-1", policy);
 *   const history = manager.getHistory("org-1");
 *   const diff = manager.diff("org-1", "v1", "v2");
 *   manager.rollback("org-1", "v1");
 */
export interface PolicyVersion {
  versionId: string;
  organizationId: string;
  policy: PolicyInheritanceLayer;
  changedBy: string;
  changedAt: string;
  changeDescription?: string;
  previousVersionId?: string;
}

export class PolicyVersionManager {
  private versions: Map<string, PolicyVersion[]> = new Map();
  private currentVersions: Map<string, string> = new Map();

  /**
   * 保存策略版本
   */
  saveVersion(
    organizationId: string,
    policy: PolicyInheritanceLayer,
    changedBy: string,
    changeDescription?: string,
  ): PolicyVersion {
    const history = this.versions.get(organizationId) ?? [];
    const previousVersionId = this.currentVersions.get(organizationId);
    const versionId = `v${history.length + 1}-${Date.now()}`;

    const version: PolicyVersion = {
      versionId,
      organizationId,
      policy: { ...policy },
      changedBy,
      changedAt: new Date().toISOString(),
      changeDescription,
      previousVersionId,
    };

    history.push(version);
    this.versions.set(organizationId, history);
    this.currentVersions.set(organizationId, versionId);

    return version;
  }

  /**
   * 获取策略变更历史
   */
  getHistory(organizationId: string): PolicyVersion[] {
    return this.versions.get(organizationId) ?? [];
  }

  /**
   * 获取当前版本
   */
  getCurrentVersion(organizationId: string): PolicyVersion | null {
    const versionId = this.currentVersions.get(organizationId);
    if (!versionId) return null;
    const history = this.versions.get(organizationId) ?? [];
    return history.find((v) => v.versionId === versionId) ?? null;
  }

  /**
   * 获取指定版本
   */
  getVersion(organizationId: string, versionId: string): PolicyVersion | null {
    const history = this.versions.get(organizationId) ?? [];
    return history.find((v) => v.versionId === versionId) ?? null;
  }

  /**
   * 对比两个版本的策略差异
   */
  diff(organizationId: string, versionId1: string, versionId2: string): PolicyDiffResult {
    const v1 = this.getVersion(organizationId, versionId1);
    const v2 = this.getVersion(organizationId, versionId2);
    if (!v1 || !v2) {
      return { changes: [], error: "Version not found" };
    }

    const changes: PolicyDiffChange[] = [];
    const p1 = v1.policy;
    const p2 = v2.policy;

    // 对比各字段
    const fields: Array<{ key: keyof PolicyInheritanceLayer; label: string }> = [
      { key: "protectedBranches", label: "受保护分支" },
      { key: "forbiddenPaths", label: "禁止路径" },
      { key: "forbiddenForAgentsPaths", label: "Agent 禁止路径" },
      { key: "highRiskPaths", label: "高风险路径" },
      { key: "forbiddenCommands", label: "禁止命令" },
      { key: "requiredChecks", label: "必须检查" },
    ];

    for (const { key, label } of fields) {
      const val1 = p1[key] as unknown[] | undefined;
      const val2 = p2[key] as unknown[] | undefined;
      const json1 = JSON.stringify(val1 ?? []);
      const json2 = JSON.stringify(val2 ?? []);
      if (json1 !== json2) {
        changes.push({
          field: label,
          fieldKey: key,
          from: val1,
          to: val2,
          changeType: "modified",
        });
      }
    }

    // 对比 mergeRules
    const r1 = JSON.stringify(p1.mergeRules ?? {});
    const r2 = JSON.stringify(p2.mergeRules ?? {});
    if (r1 !== r2) {
      changes.push({
        field: "合并规则",
        fieldKey: "mergeRules",
        from: p1.mergeRules,
        to: p2.mergeRules,
        changeType: "modified",
      });
    }

    // 对比 limits
    const l1 = JSON.stringify(p1.limits ?? {});
    const l2 = JSON.stringify(p2.limits ?? {});
    if (l1 !== l2) {
      changes.push({
        field: "变更规模限制",
        fieldKey: "limits",
        from: p1.limits,
        to: p2.limits,
        changeType: "modified",
      });
    }

    return { changes };
  }

  /**
   * 回滚到指定版本
   */
  rollback(organizationId: string, targetVersionId: string, changedBy: string): PolicyVersion {
    const target = this.getVersion(organizationId, targetVersionId);
    if (!target) {
      throw new Error(
        `Version "${targetVersionId}" not found for organization "${organizationId}"`,
      );
    }

    // 保存回滚后的版本（创建新版本，内容是目标版本的策略）
    return this.saveVersion(
      organizationId,
      target.policy,
      changedBy,
      `Rollback to ${targetVersionId}`,
    );
  }
}

export interface PolicyDiffResult {
  changes: PolicyDiffChange[];
  error?: string;
}

export interface PolicyDiffChange {
  field: string;
  fieldKey: keyof PolicyInheritanceLayer;
  from: unknown;
  to: unknown;
  changeType: "added" | "removed" | "modified";
}
