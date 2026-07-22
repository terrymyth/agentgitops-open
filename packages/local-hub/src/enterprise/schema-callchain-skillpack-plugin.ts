import { createHash } from "node:crypto";

/**
 * SchemaConflictDetector — EE 数据库 Schema 冲突检测（P3-004）
 *
 * Migration 依赖分析，DDL 冲突检测。
 *
 * 使用方式：
 *   const detector = new SchemaConflictDetector();
 *   const conflicts = detector.detect([
 *     { taskId: "task-1", migrations: [{ file: "001_add_users.sql", operations: ["CREATE TABLE users"] }] },
 *     { taskId: "task-2", migrations: [{ file: "001_add_users.sql", operations: ["CREATE TABLE users"] }] },
 *   ]);
 */
export interface MigrationFile {
  file: string;
  operations: string[];
  /** 依赖的前序 migration */
  dependsOn?: string[];
}

export interface SchemaConflictInput {
  taskId: string;
  migrations: MigrationFile[];
}

export interface SchemaConflict {
  type:
    | "same_migration_file"
    | "ddl_conflict"
    | "dependency_cycle"
    | "dependency_missing"
    | "table_overlap";
  severity: "high" | "medium" | "low";
  sourceTaskId: string;
  targetTaskId: string;
  description: string;
  file?: string;
  suggestion: string;
}

export class SchemaConflictDetector {
  /**
   * 检测 Schema 冲突
   */
  detect(inputs: SchemaConflictInput[]): SchemaConflict[] {
    const conflicts: SchemaConflict[] = [];

    // 1. 同一 migration 文件被多个任务修改
    conflicts.push(...this.detectSameMigrationFile(inputs));

    // 2. DDL 冲突（同一表的 DDL 被多个任务修改）
    conflicts.push(...this.detectDdlConflicts(inputs));

    // 3. 依赖缺失
    conflicts.push(...this.detectMissingDependencies(inputs));

    // 4. 依赖循环
    conflicts.push(...this.detectDependencyCycles(inputs));

    // 5. 表重叠
    conflicts.push(...this.detectTableOverlap(inputs));

    return conflicts;
  }

  /**
   * 检测同一 migration 文件被多个任务修改
   */
  private detectSameMigrationFile(inputs: SchemaConflictInput[]): SchemaConflict[] {
    const conflicts: SchemaConflict[] = [];
    const fileMap = new Map<string, string[]>();

    for (const input of inputs) {
      for (const migration of input.migrations) {
        const tasks = fileMap.get(migration.file) ?? [];
        tasks.push(input.taskId);
        fileMap.set(migration.file, tasks);
      }
    }

    for (const [file, tasks] of fileMap) {
      if (tasks.length > 1) {
        for (let i = 1; i < tasks.length; i++) {
          conflicts.push({
            type: "same_migration_file",
            severity: "high",
            sourceTaskId: tasks[0],
            targetTaskId: tasks[i],
            description: `Multiple tasks modify the same migration file: ${file}`,
            file,
            suggestion:
              "Serialize migration changes. Only one task should modify a migration file at a time.",
          });
        }
      }
    }

    return conflicts;
  }

  /**
   * 检测 DDL 冲突
   */
  private detectDdlConflicts(inputs: SchemaConflictInput[]): SchemaConflict[] {
    const conflicts: SchemaConflict[] = [];
    const tableMap = new Map<string, Array<{ taskId: string; file: string; operation: string }>>();

    for (const input of inputs) {
      for (const migration of input.migrations) {
        const tables = this.extractTableNames(migration.operations);
        for (const table of tables) {
          const entries = tableMap.get(table) ?? [];
          for (const op of migration.operations) {
            entries.push({ taskId: input.taskId, file: migration.file, operation: op });
          }
          tableMap.set(table, entries);
        }
      }
    }

    for (const [table, entries] of tableMap) {
      const taskIds = new Set(entries.map((e) => e.taskId));
      if (taskIds.size > 1) {
        const taskIdArray = Array.from(taskIds);
        for (let i = 1; i < taskIdArray.length; i++) {
          conflicts.push({
            type: "ddl_conflict",
            severity: "high",
            sourceTaskId: taskIdArray[0],
            targetTaskId: taskIdArray[i],
            description: `Multiple tasks modify table "${table}" with DDL operations`,
            suggestion: `Coordinate DDL changes to table "${table}". Consider serializing schema changes.`,
          });
        }
      }
    }

    return conflicts;
  }

  /**
   * 从 DDL 操作中提取表名
   */
  private extractTableNames(operations: string[]): string[] {
    const tables = new Set<string>();
    for (const op of operations) {
      const matches = op.match(
        /(?:CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE|CREATE\s+INDEX|DROP\s+INDEX)\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?(\w+)/gi,
      );
      if (matches) {
        for (const match of matches) {
          const parts = match.split(/\s+/);
          const tableName = parts[parts.length - 1];
          tables.add(tableName);
        }
      }
    }
    return Array.from(tables);
  }

  /**
   * 检测依赖缺失
   */
  private detectMissingDependencies(inputs: SchemaConflictInput[]): SchemaConflict[] {
    const conflicts: SchemaConflict[] = [];
    const allFiles = new Set<string>();
    for (const input of inputs) {
      for (const migration of input.migrations) {
        allFiles.add(migration.file);
      }
    }

    for (const input of inputs) {
      for (const migration of input.migrations) {
        if (migration.dependsOn) {
          for (const dep of migration.dependsOn) {
            if (!allFiles.has(dep)) {
              conflicts.push({
                type: "dependency_missing",
                severity: "medium",
                sourceTaskId: input.taskId,
                targetTaskId: input.taskId,
                description: `Migration ${migration.file} depends on ${dep}, but ${dep} is not present in any task`,
                file: migration.file,
                suggestion: `Ensure migration ${dep} is included before ${migration.file}`,
              });
            }
          }
        }
      }
    }

    return conflicts;
  }

  /**
   * 检测依赖循环
   */
  private detectDependencyCycles(inputs: SchemaConflictInput[]): SchemaConflict[] {
    const conflicts: SchemaConflict[] = [];
    const graph = new Map<string, string[]>();

    for (const input of inputs) {
      for (const migration of input.migrations) {
        graph.set(migration.file, migration.dependsOn ?? []);
      }
    }

    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const hasCycle = (node: string, path: string[]): boolean => {
      visited.add(node);
      recursionStack.add(node);

      const deps = graph.get(node) ?? [];
      for (const dep of deps) {
        if (!visited.has(dep)) {
          if (hasCycle(dep, [...path, dep])) return true;
        } else if (recursionStack.has(dep)) {
          conflicts.push({
            type: "dependency_cycle",
            severity: "high",
            sourceTaskId:
              inputs.find((i) => i.migrations.some((m) => m.file === node))?.taskId ?? "unknown",
            targetTaskId:
              inputs.find((i) => i.migrations.some((m) => m.file === dep))?.taskId ?? "unknown",
            description: `Migration dependency cycle detected: ${[...path, dep].join(" → ")}`,
            suggestion: "Break the circular dependency in migration files",
          });
          return true;
        }
      }

      recursionStack.delete(node);
      return false;
    };

    for (const node of graph.keys()) {
      if (!visited.has(node)) {
        hasCycle(node, [node]);
      }
    }

    return conflicts;
  }

  /**
   * 检测表重叠（不同任务修改同一表的不同 migration）
   */
  private detectTableOverlap(inputs: SchemaConflictInput[]): SchemaConflict[] {
    const conflicts: SchemaConflict[] = [];
    const tableTaskMap = new Map<string, Set<string>>();

    for (const input of inputs) {
      for (const migration of input.migrations) {
        const tables = this.extractTableNames(migration.operations);
        for (const table of tables) {
          const taskSet = tableTaskMap.get(table) ?? new Set<string>();
          taskSet.add(input.taskId);
          tableTaskMap.set(table, taskSet);
        }
      }
    }

    for (const [table, taskSet] of tableTaskMap) {
      if (taskSet.size > 1) {
        const tasks = Array.from(taskSet);
        conflicts.push({
          type: "table_overlap",
          severity: "medium",
          sourceTaskId: tasks[0],
          targetTaskId: tasks[1],
          description: `Table "${table}" is modified by multiple tasks (${tasks.join(", ")})`,
          suggestion: `Coordinate changes to table "${table}" to avoid schema conflicts`,
        });
      }
    }

    return conflicts;
  }
}

/**
 * CallChainConflictDetector — EE 调用链冲突检测（P3-005）
 *
 * 服务依赖图分析，接口签名变更影响范围。
 *
 * 使用方式：
 *   const detector = new CallChainConflictDetector();
 *   detector.buildGraph([
 *     { service: "auth-service", exports: ["login", "logout"], imports: [] },
 *     { service: "api-gateway", exports: [], imports: [{ service: "auth-service", functions: ["login"] }] },
 *   ]);
 *   const impacts = detector.analyzeImpact("auth-service", "login");
 */
export interface ServiceNode {
  service: string;
  exports: string[];
  imports: Array<{ service: string; functions: string[] }>;
}

export interface CallChainConflict {
  type:
    "interface_breaking_change" | "circular_dependency" | "missing_service" | "function_removed";
  severity: "high" | "medium" | "low";
  sourceService: string;
  targetService: string;
  description: string;
  affectedFunctions: string[];
  suggestion: string;
}

export class CallChainConflictDetector {
  private services: Map<string, ServiceNode> = new Map();
  private dependencyGraph: Map<string, Map<string, string[]>> = new Map();

  /**
   * 构建服务依赖图
   */
  buildGraph(nodes: ServiceNode[]): void {
    this.services.clear();
    this.dependencyGraph.clear();

    for (const node of nodes) {
      this.services.set(node.service, node);
    }

    // 构建反向依赖图：被依赖方 → 依赖方列表
    for (const node of nodes) {
      for (const imp of node.imports) {
        const dependents = this.dependencyGraph.get(imp.service) ?? new Map();
        dependents.set(node.service, imp.functions);
        this.dependencyGraph.set(imp.service, dependents);
      }
    }
  }

  /**
   * 分析接口变更的影响范围
   *
   * 当一个服务修改了导出函数签名时，检测所有依赖该函数的服务。
   */
  analyzeImpact(service: string, changedFunction: string): string[] {
    const dependents = this.dependencyGraph.get(service);
    if (!dependents) return [];

    const affected: string[] = [];
    for (const [dependentService, functions] of dependents) {
      if (functions.includes(changedFunction) || functions.includes("*")) {
        affected.push(dependentService);
      }
    }

    return affected;
  }

  /**
   * 检测调用链冲突
   *
   * 对比两个任务的变更，检测接口签名变更是否影响对方。
   */
  detectConflicts(
    task1Changes: { service: string; modifiedFunctions: string[]; removedFunctions: string[] },
    task2Changes: { service: string; modifiedFunctions: string[]; removedFunctions: string[] },
  ): CallChainConflict[] {
    const conflicts: CallChainConflict[] = [];

    // 检测 task1 修改的函数是否被 task2 依赖
    const task1Impacts = task1Changes.modifiedFunctions.flatMap((fn) =>
      this.analyzeImpact(task1Changes.service, fn).map((dep) => ({ dep, fn })),
    );

    for (const { dep, fn } of task1Impacts) {
      if (dep === task2Changes.service) {
        conflicts.push({
          type: "interface_breaking_change",
          severity: "high",
          sourceService: task1Changes.service,
          targetService: task2Changes.service,
          description: `Task 1 modifies function "${fn}" in ${task1Changes.service}, which is imported by ${task2Changes.service} (Task 2)`,
          affectedFunctions: [fn],
          suggestion: `Coordinate the interface change for "${fn}" between both tasks, or version the API`,
        });
      }
    }

    // 检测函数被移除
    for (const removedFn of task1Changes.removedFunctions) {
      const affected = this.analyzeImpact(task1Changes.service, removedFn);
      if (affected.includes(task2Changes.service)) {
        conflicts.push({
          type: "function_removed",
          severity: "high",
          sourceService: task1Changes.service,
          targetService: task2Changes.service,
          description: `Task 1 removes function "${removedFn}" from ${task1Changes.service}, which is used by ${task2Changes.service}`,
          affectedFunctions: [removedFn],
          suggestion: `Do not remove "${removedFn}" or update ${task2Changes.service} to use an alternative`,
        });
      }
    }

    // 检测循环依赖
    const cycle = this.detectCircularDependency();
    if (cycle) {
      conflicts.push({
        type: "circular_dependency",
        severity: "medium",
        sourceService: task1Changes.service,
        targetService: task2Changes.service,
        description: `Circular dependency detected: ${cycle.join(" → ")}`,
        affectedFunctions: [],
        suggestion:
          "Break the circular dependency by extracting shared logic to a separate service",
      });
    }

    return conflicts;
  }

  /**
   * 检测循环依赖
   */
  private detectCircularDependency(): string[] | null {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (node: string, path: string[]): string[] | null => {
      visited.add(node);
      recursionStack.add(node);

      const deps = this.dependencyGraph.get(node);
      if (deps) {
        for (const dependent of deps.keys()) {
          if (!visited.has(dependent)) {
            const result = dfs(dependent, [...path, dependent]);
            if (result) return result;
          } else if (recursionStack.has(dependent)) {
            return [...path, dependent];
          }
        }
      }

      recursionStack.delete(node);
      return null;
    };

    for (const service of this.services.keys()) {
      if (!visited.has(service)) {
        const cycle = dfs(service, [service]);
        if (cycle) return cycle;
      }
    }

    return null;
  }
}

/**
 * SkillPackFramework — EE Skill Pack 框架（P3-006）
 *
 * 代码规范包/Review 规范包框架。
 *
 * 使用方式：
 *   const framework = new SkillPackFramework();
 *   framework.registerPack({ id: "typescript-best-practices", name: "TS 最佳实践", rules: [...] });
 *   const pack = framework.getPack("typescript-best-practices");
 *   const violations = framework.checkFile("src/index.ts", fileContent);
 */
export interface SkillPack {
  id: string;
  name: string;
  description: string;
  version: string;
  rules: SkillRule[];
  language?: string;
  tags: string[];
}

export interface SkillRule {
  id: string;
  name: string;
  description: string;
  severity: "error" | "warning" | "info";
  pattern: string;
  suggestion: string;
}

export interface SkillViolation {
  ruleId: string;
  ruleName: string;
  severity: SkillRule["severity"];
  file: string;
  line?: number;
  match: string;
  suggestion: string;
}

export class SkillPackFramework {
  private packs: Map<string, SkillPack> = new Map();
  private activePacks: Set<string> = new Set();

  constructor() {
    this.registerBuiltInPacks();
  }

  /**
   * 注册内置 Skill Pack
   */
  private registerBuiltInPacks(): void {
    this.register({
      id: "typescript-best-practices",
      name: "TypeScript 最佳实践",
      description: "TypeScript 代码规范包",
      version: "1.0.0",
      language: "typescript",
      tags: ["typescript", "best-practices"],
      rules: [
        {
          id: "no-any",
          name: "禁止 any",
          description: "不应使用 any 类型",
          severity: "warning",
          pattern: ":\\s*any\\b",
          suggestion: "使用具体类型替代 any",
        },
        {
          id: "no-console",
          name: "禁止 console",
          description: "生产代码不应使用 console.log",
          severity: "warning",
          pattern: "console\\.(log|debug)\\(",
          suggestion: "使用结构化日志替代 console.log",
        },
        {
          id: "no-todo",
          name: "禁止 TODO",
          description: "不应遗留 TODO 注释",
          severity: "info",
          pattern: "//\\s*TODO",
          suggestion: "完成 TODO 或创建 Issue",
        },
      ],
    });

    this.register({
      id: "security-review",
      name: "安全 Review 规范",
      description: "安全代码审查规范包",
      version: "1.0.0",
      tags: ["security", "review"],
      rules: [
        {
          id: "no-eval",
          name: "禁止 eval",
          description: "不应使用 eval",
          severity: "error",
          pattern: "\\beval\\s*\\(",
          suggestion: "使用 JSON.parse 或其他安全替代",
        },
        {
          id: "no-innerhtml",
          name: "禁止 innerHTML",
          description: "不应使用 innerHTML（XSS 风险）",
          severity: "error",
          pattern: "\\.innerHTML\\s*=",
          suggestion: "使用 textContent 或 DOM API",
        },
        {
          id: "no-hardcoded-secrets",
          name: "禁止硬编码密钥",
          description: "不应硬编码密钥/密码",
          severity: "error",
          pattern: "(password|secret|token|api_key)\\s*=\\s*[\"'][^\"']+[\"']",
          suggestion: "使用环境变量存储密钥",
        },
      ],
    });

    this.register({
      id: "review-standards",
      name: "Review 标准规范",
      description: "代码 Review 标准规范包",
      version: "1.0.0",
      tags: ["review", "standards"],
      rules: [
        {
          id: "require-error-handling",
          name: "需要错误处理",
          description: "异步操作应有错误处理",
          severity: "warning",
          pattern: "await\\s+\\w+",
          suggestion: "为 await 操作添加 try-catch 或 .catch()",
        },
        {
          id: "no-long-functions",
          name: "函数长度限制",
          description: "函数不应过长",
          severity: "info",
          pattern: "",
          suggestion: "将长函数拆分为更小的函数",
        },
      ],
    });
  }

  /**
   * 注册 Skill Pack
   */
  register(pack: SkillPack): void {
    this.packs.set(pack.id, pack);
  }

  /**
   * 激活 Skill Pack
   */
  activate(packId: string): void {
    if (this.packs.has(packId)) {
      this.activePacks.add(packId);
    }
  }

  /**
   * 停用 Skill Pack
   */
  deactivate(packId: string): void {
    this.activePacks.delete(packId);
  }

  /**
   * 获取 Skill Pack
   */
  getPack(packId: string): SkillPack | null {
    return this.packs.get(packId) ?? null;
  }

  /**
   * 列出所有 Skill Pack
   */
  listPacks(): SkillPack[] {
    return Array.from(this.packs.values());
  }

  /**
   * 列出已激活的 Skill Pack
   */
  listActivePacks(): SkillPack[] {
    return Array.from(this.activePacks)
      .map((id) => this.packs.get(id)!)
      .filter(Boolean);
  }

  /**
   * 检查文件内容，返回违规列表
   */
  checkFile(filePath: string, content: string): SkillViolation[] {
    const violations: SkillViolation[] = [];
    const lines = content.split("\n");

    for (const packId of this.activePacks) {
      const pack = this.packs.get(packId);
      if (!pack) continue;

      // 语言过滤
      if (pack.language && !filePath.endsWith(".ts") && pack.language === "typescript") {
        continue;
      }

      for (const rule of pack.rules) {
        if (!rule.pattern) continue;
        try {
          const regex = new RegExp(rule.pattern, "gi");
          for (let i = 0; i < lines.length; i++) {
            const matches = lines[i].match(regex);
            if (matches) {
              for (const match of matches) {
                violations.push({
                  ruleId: rule.id,
                  ruleName: rule.name,
                  severity: rule.severity,
                  file: filePath,
                  line: i + 1,
                  match,
                  suggestion: rule.suggestion,
                });
              }
            }
          }
        } catch {
          // 无效正则跳过
        }
      }
    }

    return violations;
  }
}

/**
 * PluginRegistry — EE 企业插件仓库 + 签名验证（P3-007）
 *
 * 企业插件仓库、签名验证、版本约束。
 *
 * 使用方式：
 *   const registry = new PluginRegistry({ trustedKeys: new Set(["key-1"]) });
 *   registry.registerPlugin(manifest, signature);
 *   const verified = registry.verifyPlugin(manifest, signature);
 *   const loaded = registry.loadPlugin("plugin-1", "1.0.0");
 */
export interface PluginManifest {
  pluginId: string;
  name: string;
  version: string;
  description: string;
  author: string;
  entry: string;
  capabilities: string[];
  agentgitopsVersionRange: string;
  signature?: string;
  signatureAlgorithm?: "sha256" | "sha512";
  signedByKey?: string;
  dependencies?: Array<{ pluginId: string; versionRange: string }>;
}

export interface PluginRegistryConfig {
  trustedKeys: Set<string>;
  /** 是否允许未签名插件 */
  allowUnsigned?: boolean;
  /** 版本兼容检查 */
  currentVersion: string;
}

export class PluginRegistry {
  private config: PluginRegistryConfig;
  private plugins: Map<string, Map<string, PluginManifest>> = new Map();
  private loadedPlugins: Map<string, PluginManifest> = new Map();

  constructor(config: PluginRegistryConfig) {
    this.config = config;
  }

  /**
   * 注册插件到仓库
   */
  registerPlugin(
    manifest: PluginManifest,
    signature?: string,
  ): { success: boolean; error?: string } {
    // 版本兼容检查
    if (!this.isVersionCompatible(manifest.agentgitopsVersionRange, this.config.currentVersion)) {
      return {
        success: false,
        error: `Plugin ${manifest.pluginId} requires agentgitops ${manifest.agentgitopsVersionRange}, current is ${this.config.currentVersion}`,
      };
    }

    // 签名验证
    if (signature) {
      const verified = this.verifySignature(manifest, signature);
      if (!verified.success) {
        return { success: false, error: verified.error };
      }
      manifest.signature = signature;
    } else if (!this.config.allowUnsigned) {
      return {
        success: false,
        error: `Plugin ${manifest.pluginId} is not signed and unsigned plugins are not allowed`,
      };
    }

    // 存储到版本映射
    const versionMap = this.plugins.get(manifest.pluginId) ?? new Map();
    versionMap.set(manifest.version, manifest);
    this.plugins.set(manifest.pluginId, versionMap);

    return { success: true };
  }

  /**
   * 验证签名
   */
  verifySignature(
    manifest: PluginManifest,
    signature: string,
  ): { success: boolean; error?: string } {
    if (!manifest.signedByKey) {
      return { success: false, error: "Plugin manifest does not specify signedByKey" };
    }

    if (!this.config.trustedKeys.has(manifest.signedByKey)) {
      return {
        success: false,
        error: `Signing key ${manifest.signedByKey} is not in trusted keys`,
      };
    }

    // 模拟签名验证（实际应使用非对称加密验证）
    const expectedSig = this.computeSignature(manifest, manifest.signedByKey);
    if (signature !== expectedSig) {
      return { success: false, error: "Signature verification failed" };
    }

    return { success: true };
  }

  /**
   * 计算签名（模拟）
   */
  private computeSignature(manifest: PluginManifest, key: string): string {
    const data = JSON.stringify({
      pluginId: manifest.pluginId,
      version: manifest.version,
      entry: manifest.entry,
      capabilities: manifest.capabilities,
    });
    return createHash("sha256").update(`${data}:${key}`).digest("hex");
  }

  /**
   * 加载插件
   */
  loadPlugin(
    pluginId: string,
    version?: string,
  ): { success: boolean; manifest?: PluginManifest; error?: string } {
    const versionMap = this.plugins.get(pluginId);
    if (!versionMap || versionMap.size === 0) {
      return { success: false, error: `Plugin ${pluginId} not found in registry` };
    }

    const manifest = version ? versionMap.get(version) : this.getLatestVersion(versionMap);
    if (!manifest) {
      return { success: false, error: `Plugin ${pluginId} version ${version} not found` };
    }

    // 检查依赖
    if (manifest.dependencies) {
      for (const dep of manifest.dependencies) {
        const depLoaded = this.loadedPlugins.get(dep.pluginId);
        if (!depLoaded) {
          return {
            success: false,
            error: `Plugin ${pluginId} requires dependency ${dep.pluginId} which is not loaded`,
          };
        }
        if (!this.isVersionCompatible(dep.versionRange, depLoaded.version)) {
          return {
            success: false,
            error: `Plugin ${pluginId} requires ${dep.pluginId} ${dep.versionRange}, but ${depLoaded.version} is loaded`,
          };
        }
      }
    }

    this.loadedPlugins.set(pluginId, manifest);
    return { success: true, manifest };
  }

  /**
   * 卸载插件
   */
  unloadPlugin(pluginId: string): boolean {
    return this.loadedPlugins.delete(pluginId);
  }

  /**
   * 列出仓库中的所有插件
   */
  listPlugins(): Array<{ pluginId: string; versions: string[] }> {
    return Array.from(this.plugins.entries()).map(([pluginId, versionMap]) => ({
      pluginId,
      versions: Array.from(versionMap.keys()),
    }));
  }

  /**
   * 列出已加载的插件
   */
  listLoadedPlugins(): PluginManifest[] {
    return Array.from(this.loadedPlugins.values());
  }

  /**
   * 获取最新版本
   */
  private getLatestVersion(versionMap: Map<string, PluginManifest>): PluginManifest | null {
    const versions = Array.from(versionMap.keys()).sort((a, b) => this.compareVersions(b, a));
    return versionMap.get(versions[0]) ?? null;
  }

  /**
   * 版本兼容检查（简化实现）
   */
  private isVersionCompatible(range: string, version: string): boolean {
    // 简化：支持 "^1.0.0" 和 "*"
    if (range === "*") return true;
    if (range.startsWith("^")) {
      const required = range.slice(1);
      return version.startsWith(required.split(".")[0] + ".");
    }
    return version === range;
  }

  /**
   * 比较版本号
   */
  private compareVersions(a: string, b: string): number {
    const partsA = a.split(".").map(Number);
    const partsB = b.split(".").map(Number);
    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const va = partsA[i] ?? 0;
      const vb = partsB[i] ?? 0;
      if (va > vb) return 1;
      if (va < vb) return -1;
    }
    return 0;
  }
}
