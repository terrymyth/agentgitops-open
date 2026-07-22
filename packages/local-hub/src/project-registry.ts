import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { execCommand } from "./cross-platform-shell.js";
import { ConfigLoader } from "./config-loader.js";

/**
 * 全局项目注册表（MP-001）
 *
 * 管理 ~/.agentgitops/projects.json，维护所有已关联的本地 Git 仓库。
 *
 * 设计原则：
 * - 全局唯一注册表，所有项目共享
 * - 每个项目独立隔离（各自 .agentgitops/ 目录）
 * - 记住最后活跃项目，启动时直接进入
 * - 端口自动分配（4789 起，递增）
 */

const DEFAULT_REGISTRY_DIR = path.join(os.homedir(), ".agentgitops");
const PORT_RANGE_START = 4789;
const PORT_RANGE_END = 4899;

export interface ProjectRegistryOptions {
  registryDir?: string;
  registryFile?: string;
}

export interface ProjectEntry {
  id: string;
  name: string;
  path: string;
  gitRemote?: string;
  gitProvider?: string;
  defaultBranch?: string;
  serverPort?: number;
  lastActiveAt?: string;
  status: "active" | "inactive" | "error";
  createdAt: string;
  updatedAt: string;
}

export interface ProjectRegistryData {
  version: number;
  projects: ProjectEntry[];
  lastActiveProjectId?: string;
  portRange: { start: number; end: number };
}

export class ProjectRegistry {
  private data: ProjectRegistryData | null = null;
  private readonly registryDir: string;
  private readonly registryFile: string;

  constructor(options: ProjectRegistryOptions = {}) {
    this.registryFile = options.registryFile
      ? path.resolve(options.registryFile)
      : path.resolve(options.registryDir ?? DEFAULT_REGISTRY_DIR, "projects.json");
    this.registryDir = options.registryDir
      ? path.resolve(options.registryDir)
      : path.dirname(this.registryFile);
  }

  /**
   * 加载注册表
   */
  async load(): Promise<ProjectRegistryData> {
    if (this.data) return this.data;
    try {
      const content = await fs.readFile(this.registryFile, "utf-8");
      this.data = JSON.parse(content) as ProjectRegistryData;
    } catch {
      this.data = {
        version: 1,
        projects: [],
        portRange: { start: PORT_RANGE_START, end: PORT_RANGE_END },
      };
    }
    return this.data;
  }

  /**
   * 保存注册表（原子写入：先写临时文件再重命名）
   */
  async save(): Promise<void> {
    if (!this.data) return;
    await fs.mkdir(this.registryDir, { recursive: true });
    const tmpFile = this.registryFile + ".tmp";
    await fs.writeFile(tmpFile, JSON.stringify(this.data, null, 2), "utf-8");
    await fs.rename(tmpFile, this.registryFile);
  }

  /**
   * 列出所有项目
   */
  async list(): Promise<ProjectEntry[]> {
    const data = await this.load();
    return data.projects;
  }

  /**
   * 获取单个项目
   */
  async get(projectId: string): Promise<ProjectEntry | null> {
    const data = await this.load();
    return data.projects.find((p) => p.id === projectId) ?? null;
  }

  /**
   * 添加项目（关联本地 Git 仓库）
   *
   * 自动检测 Git remote 和 default branch。
   * 如果路径不是 Git 仓库，抛出错误。
   */
  async add(input: { path: string; name?: string }): Promise<ProjectEntry> {
    const data = await this.load();
    const projectPath = path.resolve(input.path);

    // 验证是 Git 仓库
    const gitInfo = await this.detectGitInfo(projectPath);

    // 检查是否已注册
    const existing = data.projects.find((p) => p.path === projectPath);
    if (existing) {
      throw new Error(`Project already registered: ${existing.name} (${existing.id})`);
    }

    // 分配端口
    const serverPort = this.allocatePort(data);

    const now = new Date().toISOString();
    const entry: ProjectEntry = {
      id: `proj_${randomUUID().slice(0, 8)}`,
      name: input.name ?? path.basename(projectPath),
      path: projectPath,
      gitRemote: gitInfo.remote,
      gitProvider: gitInfo.provider,
      defaultBranch: gitInfo.defaultBranch,
      serverPort,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };

    data.projects.push(entry);
    data.lastActiveProjectId = entry.id;
    await this.save();
    return entry;
  }

  /**
   * 移除项目
   */
  async remove(projectId: string): Promise<boolean> {
    const data = await this.load();
    const index = data.projects.findIndex((p) => p.id === projectId);
    if (index === -1) return false;
    data.projects.splice(index, 1);
    if (data.lastActiveProjectId === projectId) {
      data.lastActiveProjectId = data.projects[0]?.id;
    }
    await this.save();
    return true;
  }

  /**
   * 切换活跃项目
   */
  async setActive(projectId: string): Promise<void> {
    const data = await this.load();
    const project = data.projects.find((p) => p.id === projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    project.lastActiveAt = new Date().toISOString();
    project.updatedAt = new Date().toISOString();
    data.lastActiveProjectId = projectId;
    await this.save();
  }

  /**
   * 获取最后活跃项目
   */
  async getLastActive(): Promise<ProjectEntry | null> {
    const data = await this.load();
    if (!data.lastActiveProjectId) return null;
    const project = data.projects.find((p) => p.id === data.lastActiveProjectId);
    if (!project) return null;

    // 验证路径仍然存在
    try {
      await fs.access(project.path);
    } catch {
      return null;
    }
    return project;
  }

  /**
   * 检测 Git 仓库信息
   */
  private async detectGitInfo(projectPath: string): Promise<{
    remote?: string;
    provider?: string;
    defaultBranch?: string;
  }> {
    // 验证是 Git 仓库
    try {
      await fs.access(path.join(projectPath, ".git"));
    } catch {
      throw new Error(`Path is not a Git repository: ${projectPath}`);
    }

    let remote: string | undefined;
    let defaultBranch: string | undefined;

    try {
      const remoteResult = await execCommand("git", ["remote", "get-url", "origin"], {
        cwd: projectPath,
      });
      remote = remoteResult.stdout.trim() || undefined;
    } catch {
      // 无 remote 也可接受（本地仓库）
    }

    try {
      const config = await ConfigLoader.load(projectPath);
      defaultBranch = config.project.default_branch;
    } catch {
      try {
        const branchResult = await execCommand("git", ["symbolic-ref", "--short", "HEAD"], {
          cwd: projectPath,
        });
        defaultBranch = branchResult.stdout.trim() || undefined;
      } catch {
        // 无法获取分支名
      }
    }

    const provider = remote ? this.detectProvider(remote) : undefined;

    return { remote, provider, defaultBranch };
  }

  /**
   * 从 remote URL 检测 Git provider
   */
  private detectProvider(remote: string): string | undefined {
    if (remote.includes("github.com")) return "github";
    if (remote.includes("gitlab.com")) return "gitlab";
    if (remote.includes("gitea.com")) return "gitea";
    return undefined;
  }

  /**
   * 分配端口
   */
  private allocatePort(data: ProjectRegistryData): number {
    const usedPorts = new Set(
      data.projects.map((p) => p.serverPort).filter((p): p is number => p !== undefined),
    );
    for (let port = data.portRange.start; port <= data.portRange.end; port++) {
      if (!usedPorts.has(port)) return port;
    }
    throw new Error(`No available port in range ${data.portRange.start}-${data.portRange.end}`);
  }
}

/**
 * 获取注册表文件路径
 */
export function getRegistryFilePath(options: ProjectRegistryOptions = {}): string {
  return options.registryFile
    ? path.resolve(options.registryFile)
    : path.resolve(options.registryDir ?? DEFAULT_REGISTRY_DIR, "projects.json");
}
