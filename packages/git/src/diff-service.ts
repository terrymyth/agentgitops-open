import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";

export interface DiffResult {
  changedFiles: string[];
  insertions: number;
  deletions: number;
  diff: string;
}

/**
 * DiffService - 生成和分析 git diff
 */
export class DiffService {
  constructor(
    private readonly repoPath: string,
    private readonly fixedTargetBranch?: string,
  ) {}

  /**
   * 创建一个固定 targetBranch 的 DiffService（跨机器模式）
   *
   * 用于 worktree 不存在时，在主仓库直接对比 baseBranch..targetBranch。
   */
  static forGitDiff(repoPath: string, _baseBranch: string, targetBranch: string): DiffService {
    return new DiffService(repoPath, targetBranch);
  }

  /** 获取完整 diff（对比两个分支） */
  async getDiff(baseBranch: string, targetBranch?: string): Promise<DiffResult> {
    const effectiveTarget = targetBranch ?? this.fixedTargetBranch;
    const ref = effectiveTarget ? `${baseBranch}...${effectiveTarget}` : baseBranch;
    const diffResult = await execa("git", ["diff", ref], { cwd: this.repoPath });
    const statResult = await execa("git", ["diff", "--numstat", ref], {
      cwd: this.repoPath,
    });

    const changedFiles: string[] = [];
    let insertions = 0;
    let deletions = 0;

    for (const line of statResult.stdout.split("\n")) {
      if (!line.trim()) continue;
      const parts = line.split("\t");
      if (parts.length >= 3) {
        const added = parts[0] === "-" ? 0 : parseInt(parts[0], 10);
        const deleted = parts[1] === "-" ? 0 : parseInt(parts[1], 10);
        insertions += added;
        deletions += deleted;
        changedFiles.push(parts[2]);
      }
    }

    const untrackedFiles = await this.getUntrackedFiles();
    for (const file of untrackedFiles) {
      if (changedFiles.includes(file)) continue;
      changedFiles.push(file);
      insertions += await this.countFileLines(file);
    }

    return {
      changedFiles,
      insertions,
      deletions,
      diff: diffResult.stdout,
    };
  }

  /** 获取变更文件列表 */
  async getChangedFiles(baseBranch: string, targetBranch?: string): Promise<string[]> {
    const ref = targetBranch ? `${baseBranch}...${targetBranch}` : baseBranch;
    const result = await execa("git", ["diff", "--name-only", ref], {
      cwd: this.repoPath,
    });
    const files = result.stdout.split("\n").filter((line: string) => line.trim());
    for (const file of await this.getUntrackedFiles()) {
      if (!files.includes(file)) files.push(file);
    }
    return files;
  }

  /** 获取 diff 统计 */
  async getDiffStat(baseBranch: string, targetBranch?: string): Promise<DiffResult> {
    return this.getDiff(baseBranch, targetBranch);
  }

  private async getUntrackedFiles(): Promise<string[]> {
    const result = await execa("git", ["ls-files", "--others", "--exclude-standard"], {
      cwd: this.repoPath,
    });
    return result.stdout.split("\n").filter((line: string) => line.trim());
  }

  private async countFileLines(filePath: string): Promise<number> {
    const content = await fs.readFile(path.join(this.repoPath, filePath), "utf-8");
    if (content.length === 0) return 0;
    const lines = content.split(/\r\n|\r|\n/);
    if (lines.at(-1) === "") lines.pop();
    return lines.length;
  }
}
