import type {
  AuthorizationProvider,
  AuthorizationResult,
  EnterpriseRole,
  EnterpriseUser,
} from "@agentgitops/core";

/**
 * RbacAuthorizationProvider — EE RBAC 权限 Provider（P1-004）
 *
 * 实现 AuthorizationProvider 端口，支持基于角色的访问控制。
 *
 * 设计原则：
 * 1. 五角色模型：viewer / developer / reviewer / owner / admin
 * 2. 权限矩阵：角色 × 资源 × 操作
 * 3. 项目级授权：可按项目分配角色
 * 4. 审计友好：权限拒绝时返回原因和所需角色
 *
 * 使用方式：
 *   const provider = new RbacAuthorizationProvider({
 *     projectAssignments: {
 *       "project-a": { "alice": ["developer"], "bob": ["reviewer"] }
 *     }
 *   });
 *   const result = await provider.checkPermission({
 *     user, resource: "task", action: "create", projectId: "project-a"
 *   });
 */

/**
 * 权限矩阵：角色 → 资源 → 允许的操作
 *
 * 层级继承：admin > owner > reviewer > developer > viewer
 * 高级角色自动继承低级角色的权限。
 */
const DEFAULT_PERMISSION_MATRIX: Record<EnterpriseRole, Record<string, string[]>> = {
  viewer: {
    task: ["read", "list"],
    workspace: ["read", "list"],
    change_package: ["read", "list"],
    review: ["read", "list"],
    merge: ["read", "list"],
    audit: ["read", "list"],
    agentops: ["read", "list"],
    policy: ["read"],
    project: ["read", "list"],
    team: ["read", "list"],
  },
  developer: {
    task: ["read", "list", "create", "update", "cancel", "start", "run", "test"],
    workspace: ["read", "list", "create", "open", "clean"],
    change_package: ["read", "list", "create", "package", "push", "pr"],
    agent: ["register", "list", "remove"],
    project: ["read", "list", "register"],
  },
  reviewer: {
    task: ["read", "list", "approve", "reject", "request_changes", "escalate"],
    review: ["read", "list", "submit", "approve", "reject", "request_changes"],
    change_package: ["read", "list", "review"],
    merge: ["read", "list"],
    conflict: ["read", "list", "resolve", "mark_false_positive", "escalate"],
  },
  owner: {
    task: ["read", "list", "create", "update", "cancel", "delete", "assign", "transfer"],
    workspace: ["read", "list", "create", "open", "clean", "delete"],
    policy: ["read", "list", "create", "update", "delete"],
    merge: ["read", "list", "approve", "block", "rebase", "force_merge"],
    conflict: ["read", "list", "resolve", "mark_false_positive", "rebase", "human_takeover"],
    project: ["read", "list", "register", "update", "archive"],
    team: ["read", "list", "create", "update", "manage_members"],
  },
  admin: {
    "*": ["*"], // admin 拥有所有权限
  },
};

/**
 * 角色层级（用于继承）
 *
 * 数字越大权限越高，高级角色继承低级角色的权限。
 */
const ROLE_LEVEL: Record<EnterpriseRole, number> = {
  viewer: 1,
  developer: 2,
  reviewer: 3,
  owner: 4,
  admin: 5,
};

/**
 * 获取角色层级以下的所有角色（含自身）
 *
 * 例如 owner → [viewer, developer, reviewer, owner]
 */
function getInheritedRoles(role: EnterpriseRole): EnterpriseRole[] {
  const level = ROLE_LEVEL[role];
  return (Object.entries(ROLE_LEVEL) as Array<[EnterpriseRole, number]>)
    .filter(([, l]) => l <= level)
    .map(([r]) => r)
    .sort((a, b) => ROLE_LEVEL[a] - ROLE_LEVEL[b]);
}

export interface RbacConfig {
  /** 项目级角色分配：projectId → userId → roles */
  projectAssignments?: Record<string, Record<string, EnterpriseRole[]>>;
  /** 全局角色分配：userId → roles（适用于所有项目） */
  globalAssignments?: Record<string, EnterpriseRole[]>;
  /** 自定义权限矩阵（覆盖默认） */
  permissionMatrix?: Record<EnterpriseRole, Record<string, string[]>>;
  /** 超级管理员用户 ID 列表（绕过所有检查） */
  superAdmins?: string[];
}

export class RbacAuthorizationProvider implements AuthorizationProvider {
  private config: RbacConfig;
  private matrix: Record<EnterpriseRole, Record<string, string[]>>;

  constructor(config: RbacConfig = {}) {
    this.config = config;
    this.matrix = config.permissionMatrix ?? DEFAULT_PERMISSION_MATRIX;
  }

  /**
   * 检查用户是否有权限执行操作
   */
  checkPermission(input: {
    user: EnterpriseUser;
    resource: string;
    action: string;
    projectId?: string;
  }): AuthorizationResult {
    // 超级管理员绕过
    if (this.config.superAdmins?.includes(input.user.userId)) {
      return { allowed: true };
    }

    // 获取用户在当前项目中的有效角色
    const effectiveRoles = this.getEffectiveRoles(input.user, input.projectId);

    // 检查每个角色（含继承）是否有权限
    for (const role of effectiveRoles) {
      if (this.hasPermission(role, input.resource, input.action)) {
        return { allowed: true };
      }
    }

    // 拒绝：返回所需角色
    const requiredRole = this.findRequiredRole(input.resource, input.action);
    return {
      allowed: false,
      reason:
        `User "${input.user.username}" does not have permission to "${input.action}" on "${input.resource}"` +
        (input.projectId ? ` in project "${input.projectId}"` : "") +
        (requiredRole ? `. Required role: ${requiredRole}` : ""),
      requiredRole,
    };
  }

  /**
   * 获取用户角色
   */
  getUserRoles(userId: string): EnterpriseRole[] {
    // 全局角色
    const globalRoles = this.config.globalAssignments?.[userId] ?? [];

    // 所有项目中的角色
    const projectRoles: EnterpriseRole[] = [];
    if (this.config.projectAssignments) {
      for (const projectAssignments of Object.values(this.config.projectAssignments)) {
        const roles = projectAssignments[userId];
        if (roles) projectRoles.push(...roles);
      }
    }

    // 合并去重
    const allRoles = new Set<EnterpriseRole>([...globalRoles, ...projectRoles]);
    return Array.from(allRoles);
  }

  /**
   * 获取用户在指定项目中的有效角色（含全局角色）
   */
  private getEffectiveRoles(user: EnterpriseUser, projectId?: string): EnterpriseRole[] {
    const roles = new Set<EnterpriseRole>();

    // 用户自带的角色（来自 IdP）
    for (const role of user.roles) {
      roles.add(role);
    }

    // 全局角色分配
    const globalRoles = this.config.globalAssignments?.[user.userId];
    if (globalRoles) {
      for (const role of globalRoles) roles.add(role);
    }

    // 项目级角色分配
    if (projectId && this.config.projectAssignments?.[projectId]) {
      const projectRoles = this.config.projectAssignments[projectId][user.userId];
      if (projectRoles) {
        for (const role of projectRoles) roles.add(role);
      }
    }

    // 展开继承的角色
    const expanded = new Set<EnterpriseRole>();
    for (const role of roles) {
      for (const inherited of getInheritedRoles(role)) {
        expanded.add(inherited);
      }
    }

    return Array.from(expanded);
  }

  /**
   * 检查指定角色是否有权限
   */
  private hasPermission(role: EnterpriseRole, resource: string, action: string): boolean {
    const rolePermissions = this.matrix[role];
    if (!rolePermissions) return false;

    // admin 通配符
    if (rolePermissions["*"]?.includes("*")) return true;

    // 精确匹配
    const resourcePermissions = rolePermissions[resource];
    if (resourcePermissions?.includes(action)) return true;
    if (resourcePermissions?.includes("*")) return true;

    // 通配符资源
    if (rolePermissions["*"]?.includes(action)) return true;

    return false;
  }

  /**
   * 查找执行某操作所需的最低角色
   */
  private findRequiredRole(resource: string, action: string): EnterpriseRole | undefined {
    // 从低到高查找第一个有权限的角色
    const roleOrder: EnterpriseRole[] = ["viewer", "developer", "reviewer", "owner", "admin"];
    for (const role of roleOrder) {
      if (this.hasPermission(role, resource, action)) {
        return role;
      }
    }
    return undefined;
  }

  /**
   * 分配项目角色
   */
  assignProjectRole(projectId: string, userId: string, role: EnterpriseRole): void {
    if (!this.config.projectAssignments) this.config.projectAssignments = {};
    if (!this.config.projectAssignments[projectId]) {
      this.config.projectAssignments[projectId] = {};
    }
    const existing = this.config.projectAssignments[projectId][userId] ?? [];
    if (!existing.includes(role)) {
      existing.push(role);
      this.config.projectAssignments[projectId][userId] = existing;
    }
  }

  /**
   * 撤销项目角色
   */
  revokeProjectRole(projectId: string, userId: string, role: EnterpriseRole): void {
    if (!this.config.projectAssignments?.[projectId]) return;
    const existing = this.config.projectAssignments[projectId][userId];
    if (!existing) return;
    this.config.projectAssignments[projectId][userId] = existing.filter((r) => r !== role);
  }

  /**
   * 获取项目的所有成员
   */
  getProjectMembers(projectId: string): Array<{ userId: string; roles: EnterpriseRole[] }> {
    const assignments = this.config.projectAssignments?.[projectId];
    if (!assignments) return [];
    return Object.entries(assignments).map(([userId, roles]) => ({ userId, roles }));
  }
}
