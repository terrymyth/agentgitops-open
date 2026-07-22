import { execa } from "execa";

/**
 * WorktreeService - 管理 git worktree
 */
export class WorktreeService {
  constructor(private readonly repoPath: string) {}

  /** git worktree add */
  async add(worktreePath: string, branch: string, baseBranch?: string): Promise<void> {
    const args = ["worktree", "add", "-b", branch, worktreePath];
    if (baseBranch) args.push(baseBranch);
    await execa("git", args, {
      cwd: this.repoPath,
    });
  }

  /** git worktree add (existing branch) */
  async addExisting(worktreePath: string, branch: string): Promise<void> {
    await execa("git", ["worktree", "add", worktreePath, branch], {
      cwd: this.repoPath,
    });
  }

  /** git worktree list */
  async list(): Promise<string> {
    const result = await execa("git", ["worktree", "list", "--porcelain"], {
      cwd: this.repoPath,
    });
    return result.stdout;
  }

  /** git worktree remove */
  async remove(worktreePath: string, force = false): Promise<void> {
    const args = ["worktree", "remove", worktreePath];
    if (force) args.push("--force");
    await execa("git", args, { cwd: this.repoPath });
  }

  /** git worktree prune */
  async prune(): Promise<void> {
    await execa("git", ["worktree", "prune"], { cwd: this.repoPath });
  }
}
