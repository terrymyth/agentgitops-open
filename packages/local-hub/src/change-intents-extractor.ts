import type { ChangeIntentEntry } from "@agentgitops/core";
import { ContextFeedPrivacyFilter } from "./context-feed-privacy-filter.js";

/**
 * ChangeIntentsExtractor - 从 git diff 中提取变更意图
 *
 * 解析 git diff 输出，为每个变更文件推断：
 * - changeType：add / modify / delete / rename
 * - intent：修改意图描述
 * - impactedAreas：影响的功能区域
 * - breakingChanges：是否有破坏性变更
 *
 * 推断策略：
 * - changeType：从 diff 头部（new file / deleted / rename）判断
 * - intent：从 commit message + 文件路径 + diff 内容推断
 * - impactedAreas：从文件路径的目录部分推断
 * - breakingChanges：检测 export 删除、函数签名变更、接口删除
 */
export class ChangeIntentsExtractor {
  private readonly privacyFilter = new ContextFeedPrivacyFilter();

  /**
   * 从 diff 中提取变更意图
   *
   * @param diffText git diff 原始输出
   * @param commitMessage 可选的 commit message，用于推断 intent
   * @param objective 可选的任务目标，用于推断 intent
   */
  extract(
    diffText: string,
    options: { commitMessage?: string; objective?: string } = {},
  ): {
    changeIntents: ChangeIntentEntry[];
    impactedAreas: string[];
    breakingChanges: boolean;
  } {
    const fileDiffs = this.parseDiffByFile(diffText);
    const commitMessage = options.commitMessage?.trim();
    const objective = options.objective?.trim();

    const changeIntents: ChangeIntentEntry[] = [];
    const impactedAreasSet = new Set<string>();
    let breakingChanges = false;

    for (const fileDiff of fileDiffs) {
      const changeType = this.inferChangeType(fileDiff);
      const intent = this.inferIntent(fileDiff, changeType, commitMessage, objective);
      const area = this.inferImpactedArea(fileDiff.filePath);

      if (area) impactedAreasSet.add(area);

      // 检测破坏性变更
      if (this.detectBreakingChanges(fileDiff)) {
        breakingChanges = true;
      }

      changeIntents.push({
        file: this.privacyFilter.redact(fileDiff.filePath).text,
        intent: this.privacyFilter.redact(intent).text,
        changeType,
      });
    }

    return {
      changeIntents,
      impactedAreas: [...impactedAreasSet],
      breakingChanges,
    };
  }

  /**
   * 解析 diff，按文件拆分
   */
  private parseDiffByFile(diffText: string): FileDiff[] {
    const files: FileDiff[] = [];
    const diffSections = diffText.split(/^diff --git /m);

    for (const section of diffSections) {
      if (!section.trim()) continue;
      const filePath = this.extractFilePath(section);
      if (!filePath) continue;

      files.push({
        filePath,
        header: this.extractHeader(section),
        content: section,
        isNewFile: /new file mode/.test(section),
        isDeletedFile: /deleted file mode/.test(section),
        isRename: /rename from/.test(section) || /rename to/.test(section),
        addedLines: this.countLines(section, /^\+/),
        removedLines: this.countLines(section, /^-/),
      });
    }

    return files;
  }

  private extractFilePath(section: string): string | undefined {
    // diff --git a/path b/path
    const match = section.match(/^a\/(?<path>\S+)/);
    return match?.groups?.path;
  }

  private extractHeader(section: string): string {
    const lines = section.split("\n").slice(0, 10);
    return lines.join("\n");
  }

  private countLines(section: string, pattern: RegExp): number {
    return section
      .split("\n")
      .filter((line) => pattern.test(line) && !pattern.test(line.replace(pattern, ""))).length;
  }

  /**
   * 推断变更类型
   */
  private inferChangeType(fileDiff: FileDiff): ChangeIntentEntry["changeType"] {
    if (fileDiff.isNewFile) return "add";
    if (fileDiff.isDeletedFile) return "delete";
    if (fileDiff.isRename) return "rename";
    return "modify";
  }

  /**
   * 推断修改意图
   */
  private inferIntent(
    fileDiff: FileDiff,
    changeType: ChangeIntentEntry["changeType"],
    commitMessage?: string,
    objective?: string,
  ): string {
    // 优先使用 commit message
    if (commitMessage) {
      return `${changeType} for: ${commitMessage}`;
    }

    // 其次使用任务目标
    if (objective) {
      return `${changeType} to support: ${objective}`;
    }

    // 从文件路径和变更类型推断
    const fileName = fileDiff.filePath.split("/").pop() ?? fileDiff.filePath;
    const ext = fileName.split(".").pop()?.toLowerCase();

    switch (changeType) {
      case "add":
        return `Add new file ${fileName}`;
      case "delete":
        return `Remove file ${fileName}`;
      case "rename":
        return `Rename file to ${fileName}`;
      case "modify":
        // 根据文件类型推断
        if (
          ext === "test" ||
          ext === "spec" ||
          fileName.includes(".test.") ||
          fileName.includes(".spec.")
        ) {
          return `Update tests in ${fileName}`;
        }
        if (ext === "md") {
          return `Update documentation in ${fileName}`;
        }
        if (fileName === "package.json" || fileName === "pnpm-lock.yaml") {
          return `Update dependencies in ${fileName}`;
        }
        if (ext === "yml" || ext === "yaml" || ext === "json") {
          return `Update configuration in ${fileName}`;
        }
        return `Modify ${fileName} (${fileDiff.addedLines} additions, ${fileDiff.removedLines} deletions)`;
      default:
        return `Change ${fileName}`;
    }
  }

  /**
   * 推断影响的功能区域
   *
   * 从文件路径的目录部分推断，如：
   * - src/auth/login.ts → "auth"
   * - packages/core/src/models/task.ts → "core/models"
   * - apps/web/src/pages/Dashboard.tsx → "web/pages"
   */
  private inferImpactedArea(filePath: string): string | undefined {
    const parts = filePath.split("/");
    if (parts.length <= 1) return undefined;

    // 去掉文件名，只保留目录部分
    const dirParts = parts.slice(0, -1);
    if (dirParts.length === 0) return undefined;

    // 跳过 src/、dist/、build/ 前缀，取有意义的目录
    const meaningfulParts = dirParts.filter((p) => p !== "src" && p !== "dist" && p !== "build");
    if (meaningfulParts.length === 0) return undefined;

    // 取前 2 个有意义的目录部分
    return meaningfulParts.slice(0, 2).join("/");
  }

  /**
   * 检测破坏性变更
   *
   * 检测模式：
   * - 删除 export 语句
   * - 删除 public 接口/类型定义
   * - 修改函数签名（删除参数）
   */
  private detectBreakingChanges(fileDiff: FileDiff): boolean {
    const removedLines = fileDiff.content
      .split("\n")
      .filter((line) => line.startsWith("-") && !line.startsWith("--"))
      .join("\n");

    // 检测删除 export
    if (/^-\s*export\s+/.test(removedLines)) return true;

    // 检测删除 interface/type 定义
    if (/^-\s*(export\s+)?(interface|type)\s+\w+/.test(removedLines)) return true;

    // 检测删除函数声明
    if (/^-\s*(export\s+)?(async\s+)?function\s+\w+/.test(removedLines)) return true;

    return false;
  }
}

interface FileDiff {
  filePath: string;
  header: string;
  content: string;
  isNewFile: boolean;
  isDeletedFile: boolean;
  isRename: boolean;
  addedLines: number;
  removedLines: number;
}
