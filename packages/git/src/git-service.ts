import { execa } from "execa";

/**
 * GitService - 封装系统 git 命令
 *
 * MVP 阶段优先调用系统 git 二进制，行为最可靠。
 */
export class GitService {
  constructor(private readonly repoPath: string) {}

  /** 执行 git 命令 */
  private async git(args: string[]): Promise<string> {
    const result = await execa("git", args, { cwd: this.repoPath });
    return result.stdout;
  }

  /** git clone */
  async clone(repoUrl: string, targetPath: string): Promise<void> {
    await execa("git", ["clone", repoUrl, targetPath]);
  }

  /** git fetch */
  async fetch(remote = "origin"): Promise<void> {
    await this.git(["fetch", remote]);
  }

  /** git checkout */
  async checkout(branch: string): Promise<void> {
    await this.git(["checkout", branch]);
  }

  /** git branch */
  async createBranch(branch: string, baseBranch?: string): Promise<void> {
    const args = ["branch", branch];
    if (baseBranch) args.push(baseBranch);
    await this.git(args);
  }

  /** git branch --show-current */
  async getCurrentBranch(): Promise<string> {
    return (await this.git(["branch", "--show-current"])).trim();
  }

  /** git branch --list */
  async listBranches(): Promise<string[]> {
    const output = await this.git(["branch", "--list"]);
    return output
      .split("\n")
      .map((l) => l.trim().replace("* ", ""))
      .filter((l) => l.length > 0);
  }

  /** git status --porcelain */
  async status(): Promise<string> {
    return this.git(["status", "--porcelain"]);
  }

  /** git diff */
  async diff(baseBranch: string, targetBranch: string): Promise<string> {
    return this.git(["diff", `${baseBranch}...${targetBranch}`]);
  }

  /** git diff --stat */
  async diffStat(baseBranch: string, targetBranch: string): Promise<string> {
    return this.git(["diff", "--stat", `${baseBranch}...${targetBranch}`]);
  }

  /** git commit */
  async commit(message: string, files?: string[]): Promise<void> {
    if (files && files.length > 0) {
      await this.git(["add", ...files]);
    } else {
      await this.git(["add", "-A"]);
    }
    await this.git(["commit", "-m", message]);
  }

  /** git push */
  async push(remote: string, branch: string, force = false): Promise<void> {
    const args = ["push", remote, branch];
    if (force) args.push("--force");
    await this.git(args);
  }

  /** git remote get-url */
  async getRemoteUrl(remote = "origin"): Promise<string> {
    return (await this.git(["remote", "get-url", remote])).trim();
  }

  /** git rev-parse HEAD */
  async getHeadSha(): Promise<string> {
    return (await this.git(["rev-parse", "HEAD"])).trim();
  }
}
