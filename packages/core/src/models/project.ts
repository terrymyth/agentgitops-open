/**
 * Project 数据模型
 */
export interface Project {
  id: string;
  name: string;
  rootPath: string;
  repoUrl: string;
  defaultBranch: string;
  gitProvider?: GitProvider;
  worktreeRoot?: string;
  createdAt: string;
  updatedAt: string;
}

export type GitProvider = "github" | "gitlab" | "gitea" | "local";
