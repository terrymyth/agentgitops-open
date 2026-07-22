import fs from "node:fs/promises";
import path from "node:path";
import type { ChangePackage, TaskContract, VerificationRun } from "@agentgitops/core";
import { CHANGE_PACKAGE_VERSION, CONFIG_DIR } from "@agentgitops/core";
import { DiffService } from "@agentgitops/git";
import { ConfigLoader } from "./config-loader.js";
import { ChangeIntentsExtractor } from "./change-intents-extractor.js";
import { ConflictDetector } from "./conflict-detector.js";
import type { ExtensionRegistry } from "./extension-registry.js";
import { PolicyEngine } from "./policy-engine.js";
import type { PolicyEvaluationResult } from "./policy-engine.js";

/**
 * ChangePackageGenerator - 生成 Change Package
 */
export class ChangePackageGenerator {
  constructor(
    private readonly diffService: DiffService,
    private readonly projectPath: string,
    private readonly extensions?: ExtensionRegistry,
  ) {}

  async generate(
    task: TaskContract,
    checks: VerificationRun[] = [],
    unverifiedItems: string[] = [],
  ): Promise<ChangePackage> {
    const diffResult = await this.diffService.getDiff(task.baseBranch);

    const allChecksPassed = checks.length === 0 || checks.every((c) => c.status === "passed");
    const policyResult = await this.evaluatePolicy(task, {
      changedFiles: diffResult.changedFiles,
      targetBranch: task.targetBranch,
      insertions: diffResult.insertions,
      deletions: diffResult.deletions,
      checksPassed: allChecksPassed,
      unverifiedItems,
      hasConflict: false,
    });

    const risk = {
      level: maxRisk(task.riskLevel, policyResult.riskLevel),
      domains: [...new Set([...(task.riskDomains ?? []), ...policyResult.requiredReviewers])],
      highRiskFilesTouched: policyResult.highRiskFilesTouched,
      forbiddenFilesTouched: policyResult.forbiddenFilesTouched,
      requiredReviewers: policyResult.requiredReviewers,
      violations: policyResult.violations,
    };
    const intentsExtractor = new ChangeIntentsExtractor();
    const { changeIntents, impactedAreas, breakingChanges } = intentsExtractor.extract(
      diffResult.diff,
      {
        objective: task.objective,
      },
    );

    const existingPackages = await this.loadExistingPackages(task.id);
    const conflictDetector = this.extensions?.conflictDetector ?? new ConflictDetector();
    const conflicts = await conflictDetector.detect(
      {
        id: `pkg_${task.id}`,
        taskId: task.id,
        projectId: task.projectId,
        version: CHANGE_PACKAGE_VERSION,
        agent: { name: task.agentId, adapter: "generic-cli" },
        baseBranch: task.baseBranch,
        targetBranch: task.targetBranch,
        objective: task.objective,
        summary: "",
        changedFiles: diffResult.changedFiles,
        stats: {
          filesChanged: diffResult.changedFiles.length,
          insertions: diffResult.insertions,
          deletions: diffResult.deletions,
        },
        changeIntents,
        impactedAreas,
        breakingChanges,
        checks,
        risk,
        evidence: this.buildEvidence(diffResult, existingPackages),
        unverifiedItems,
        conflicts: [],
        mergeRecommendation: "",
        createdAt: new Date().toISOString(),
      },
      existingPackages,
    );

    const mergeRecommendation = this.getMergeRecommendation(
      risk.level,
      allChecksPassed,
      policyResult.allowed,
      conflicts.length > 0,
    );

    const pkg: ChangePackage = {
      id: `pkg_${task.id}`,
      taskId: task.id,
      projectId: task.projectId,
      version: CHANGE_PACKAGE_VERSION,
      agent: {
        name: task.agentId,
        adapter: "generic-cli",
      },
      baseBranch: task.baseBranch,
      targetBranch: task.targetBranch,
      objective: task.objective,
      background: task.background,
      summary: `${diffResult.changedFiles.length} files changed (+${diffResult.insertions} -${diffResult.deletions})`,
      changedFiles: diffResult.changedFiles,
      stats: {
        filesChanged: diffResult.changedFiles.length,
        insertions: diffResult.insertions,
        deletions: diffResult.deletions,
      },
      checks,
      risk,
      evidence: this.buildEvidence(diffResult, existingPackages),
      unverifiedItems,
      conflicts,
      changeIntents,
      impactedAreas,
      breakingChanges,
      mergeRecommendation,
      createdAt: new Date().toISOString(),
    };

    // 持久化到文件
    const packagesDir = path.join(this.projectPath, CONFIG_DIR, "packages");
    await fs.mkdir(packagesDir, { recursive: true });
    const pkgPath = path.join(packagesDir, `${task.id}.json`);
    await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2), "utf-8");

    return pkg;
  }

  private getMergeRecommendation(
    riskLevel: ChangePackage["risk"]["level"],
    allChecksPassed: boolean,
    policyAllowed: boolean,
    hasConflict: boolean,
  ): string {
    if (!policyAllowed) return "策略校验未通过，不允许合并";
    if (!allChecksPassed) return "检查未通过，不建议合并";
    if (hasConflict) return "检测到潜在冲突，需要串行合并或人工确认";
    switch (riskLevel) {
      case "low":
        return "测试通过，可自动合并";
      case "medium":
        return "需要至少一个 Owner 审核后合并";
      case "high":
        return "需要指定 Reviewer 审批后合并";
      case "critical":
        return "不建议合并，请人工评估";
      default:
        return "需要人工审核";
    }
  }

  private async evaluatePolicy(
    task: TaskContract,
    input: {
      changedFiles: string[];
      targetBranch: string;
      insertions: number;
      deletions: number;
      checksPassed: boolean;
      unverifiedItems: string[];
      hasConflict: boolean;
    },
  ): Promise<PolicyEvaluationResult> {
    const policyProvider = this.extensions?.policyProvider;
    if (policyProvider) {
      const result = await policyProvider.evaluate({ task, ...input });
      return {
        allowed: result.allowed,
        violations: result.violations,
        riskLevel: result.riskLevel,
        requiresApproval: result.requiresApproval,
        requiredReviewers: result.requiredReviewers,
        canAutoMerge: result.canAutoMerge ?? false,
        highRiskFilesTouched: result.highRiskFilesTouched ?? false,
        forbiddenFilesTouched: result.forbiddenFilesTouched ?? false,
      };
    }

    const policyEngine = await this.loadPolicyEngine();
    return policyEngine.evaluate({
      ...input,
      allowedPaths: task.allowedPaths,
    });
  }

  private async loadPolicyEngine(): Promise<PolicyEngine> {
    try {
      const config = await ConfigLoader.load(this.projectPath);
      return new PolicyEngine(config.policies);
    } catch {
      return new PolicyEngine();
    }
  }

  private async loadExistingPackages(currentTaskId: string): Promise<ChangePackage[]> {
    const packagesDir = path.join(this.projectPath, CONFIG_DIR, "packages");
    let files: string[];
    try {
      files = await fs.readdir(packagesDir);
    } catch {
      return [];
    }

    const packages = await Promise.all(
      files
        .filter((file) => file.endsWith(".json"))
        .filter((file) => file !== `${currentTaskId}.json`)
        .map(async (file) => {
          try {
            const content = await fs.readFile(path.join(packagesDir, file), "utf-8");
            return JSON.parse(content) as ChangePackage;
          } catch {
            return null;
          }
        }),
    );
    return packages.filter((pkg): pkg is ChangePackage => pkg !== null);
  }

  private buildEvidence(
    diffResult: { changedFiles: string[]; insertions: number; deletions: number },
    existingPackages: ChangePackage[],
  ): ChangePackage["evidence"] {
    const existingFiles = new Set(existingPackages.flatMap((pkg) => pkg.changedFiles));
    const overlappingFiles = diffResult.changedFiles
      .filter((filePath) => existingFiles.has(filePath))
      .sort();
    const previousInsertions = existingPackages.reduce((sum, pkg) => sum + pkg.stats.insertions, 0);
    const previousDeletions = existingPackages.reduce((sum, pkg) => sum + pkg.stats.deletions, 0);
    return {
      securityScan: {
        status: "not_configured",
        findings: 0,
        summary: "No security scanner configured for this project.",
      },
      comparison: {
        comparedPackages: existingPackages.length,
        overlappingFiles,
        insertionDelta: diffResult.insertions - previousInsertions,
        deletionDelta: diffResult.deletions - previousDeletions,
      },
    };
  }
}

function maxRisk(
  current: ChangePackage["risk"]["level"],
  evaluated: ChangePackage["risk"]["level"],
): ChangePackage["risk"]["level"] {
  const order: ChangePackage["risk"]["level"][] = ["low", "medium", "high", "critical"];
  return order.indexOf(evaluated) > order.indexOf(current) ? evaluated : current;
}
