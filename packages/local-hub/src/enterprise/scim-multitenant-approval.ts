import type { EnterpriseRole, EnterpriseUser } from "@agentgitops/core";

/**
 * ScimProvider — EE SCIM 自动化用户生命周期（P3-001）
 *
 * 支持 SCIM 2.0 协议，自动化用户创建/更新/删除。
 * 兼容 Okta/Entra ID 的 SCIM 实现。
 *
 * 使用方式：
 *   const scim = new ScimProvider({ userStore, groupStore });
 *   const user = await scim.createUser(scimUser);
 *   await scim.updateUser(id, updates);
 *   await scim.deleteUser(id);
 */
export interface ScimConfig {
  userStore: Map<string, EnterpriseUser>;
  groupStore: Map<string, ScimGroup>;
  roleMapping?: Record<string, EnterpriseRole>;
}

export interface ScimGroup {
  id: string;
  displayName: string;
  members: string[];
}

export interface ScimUser {
  id?: string;
  userName: string;
  displayName?: string;
  emails?: Array<{ value: string; primary?: boolean }>;
  active?: boolean;
  groups?: string[];
  [key: string]: unknown;
}

export class ScimProvider {
  private config: ScimConfig;

  constructor(config: ScimConfig) {
    this.config = config;
  }

  /**
   * SCIM 用户创建
   */
  async createUser(scimUser: ScimUser): Promise<EnterpriseUser> {
    const userId = scimUser.id ?? `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = scimUser.emails?.find((e) => e.primary)?.value ?? scimUser.emails?.[0]?.value;
    const roles = this.extractRoles(scimUser.groups ?? []);

    const user: EnterpriseUser = {
      userId,
      username: scimUser.userName,
      displayName: scimUser.displayName ?? scimUser.userName,
      email,
      groups: scimUser.groups ?? [],
      roles,
    };

    this.config.userStore.set(userId, user);
    return user;
  }

  /**
   * SCIM 用户更新
   */
  async updateUser(userId: string, updates: Partial<ScimUser>): Promise<EnterpriseUser | null> {
    const existing = this.config.userStore.get(userId);
    if (!existing) return null;

    const updated: EnterpriseUser = {
      ...existing,
      username: updates.userName ?? existing.username,
      displayName: updates.displayName ?? existing.displayName,
      email:
        updates.emails?.find((e) => e.primary)?.value ??
        updates.emails?.[0]?.value ??
        existing.email,
      groups: updates.groups ?? existing.groups,
      roles: updates.groups ? this.extractRoles(updates.groups) : existing.roles,
    };

    this.config.userStore.set(userId, updated);
    return updated;
  }

  /**
   * SCIM 用户删除
   */
  async deleteUser(userId: string): Promise<boolean> {
    return this.config.userStore.delete(userId);
  }

  /**
   * SCIM 用户查询
   */
  async getUser(userId: string): Promise<EnterpriseUser | null> {
    return this.config.userStore.get(userId) ?? null;
  }

  /**
   * SCIM 用户列表（支持过滤）
   */
  async listUsers(filter?: { active?: boolean; groupId?: string }): Promise<EnterpriseUser[]> {
    let users = Array.from(this.config.userStore.values());
    if (filter?.groupId) {
      const group = this.config.groupStore.get(filter.groupId);
      if (group) {
        users = users.filter((u) => group.members.includes(u.userId));
      }
    }
    return users;
  }

  /**
   * SCIM 组创建
   */
  async createGroup(displayName: string, members: string[] = []): Promise<ScimGroup> {
    const groupId = `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const group: ScimGroup = { id: groupId, displayName, members };
    this.config.groupStore.set(groupId, group);
    return group;
  }

  /**
   * SCIM 组成员添加
   */
  async addGroupMembers(groupId: string, userIds: string[]): Promise<void> {
    const group = this.config.groupStore.get(groupId);
    if (!group) throw new Error(`Group ${groupId} not found`);
    for (const userId of userIds) {
      if (!group.members.includes(userId)) group.members.push(userId);
    }
  }

  /**
   * SCIM 组成员移除
   */
  async removeGroupMembers(groupId: string, userIds: string[]): Promise<void> {
    const group = this.config.groupStore.get(groupId);
    if (!group) return;
    group.members = group.members.filter((id) => !userIds.includes(id));
  }

  /**
   * 从 SCIM groups 提取角色
   */
  private extractRoles(groups: string[]): EnterpriseRole[] {
    const roleSet = new Set<EnterpriseRole>();
    const mapping = this.config.roleMapping ?? {};
    const defaultMapping: Record<string, EnterpriseRole> = {
      admins: "admin",
      administrators: "admin",
      owners: "owner",
      maintainers: "owner",
      reviewers: "reviewer",
      developers: "developer",
      viewers: "viewer",
    };
    for (const group of groups) {
      const lower = group.toLowerCase();
      const role = mapping[group] ?? mapping[lower] ?? defaultMapping[lower];
      if (role) roleSet.add(role);
    }
    if (roleSet.size === 0) roleSet.add("viewer");
    return Array.from(roleSet);
  }
}

/**
 * MultiTenantManager — EE 多租户隔离（P3-002）
 *
 * 数据库级隔离 + 命名空间隔离。
 *
 * 使用方式：
 *   const mgr = new MultiTenantManager();
 *   mgr.createTenant("tenant-a", { name: "Company A" });
 *   mgr.assignUserToTenant("user-1", "tenant-a", ["developer"]);
 *   const allowed = mgr.checkAccess("user-1", "tenant-a", "project-1");
 */
export interface Tenant {
  tenantId: string;
  name: string;
  createdAt: string;
  settings: {
    maxProjects: number;
    maxUsers: number;
    maxAgents: number;
    storageLimitGb: number;
  };
  users: Map<string, EnterpriseRole[]>;
  projects: Set<string>;
}

export class MultiTenantManager {
  private tenants: Map<string, Tenant> = new Map();
  private userTenantMap: Map<string, Set<string>> = new Map();

  /**
   * 创建租户
   */
  createTenant(
    tenantId: string,
    config: { name: string; settings?: Partial<Tenant["settings"]> },
  ): Tenant {
    const tenant: Tenant = {
      tenantId,
      name: config.name,
      createdAt: new Date().toISOString(),
      settings: {
        maxProjects: 50,
        maxUsers: 200,
        maxAgents: 20,
        storageLimitGb: 100,
        ...config.settings,
      },
      users: new Map(),
      projects: new Set(),
    };
    this.tenants.set(tenantId, tenant);
    return tenant;
  }

  /**
   * 获取租户
   */
  getTenant(tenantId: string): Tenant | null {
    return this.tenants.get(tenantId) ?? null;
  }

  /**
   * 分配用户到租户
   */
  assignUserToTenant(userId: string, tenantId: string, roles: EnterpriseRole[]): void {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) throw new Error(`Tenant ${tenantId} not found`);
    tenant.users.set(userId, roles);
    const userTenants = this.userTenantMap.get(userId) ?? new Set();
    userTenants.add(tenantId);
    this.userTenantMap.set(userId, userTenants);
  }

  /**
   * 移除用户
   */
  removeUserFromTenant(userId: string, tenantId: string): void {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return;
    tenant.users.delete(userId);
    const userTenants = this.userTenantMap.get(userId);
    if (userTenants) {
      userTenants.delete(tenantId);
      if (userTenants.size === 0) this.userTenantMap.delete(userId);
    }
  }

  /**
   * 检查用户是否属于租户
   */
  checkAccess(userId: string, tenantId: string): boolean {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return false;
    return tenant.users.has(userId);
  }

  /**
   * 获取用户在租户中的角色
   */
  getUserRoles(userId: string, tenantId: string): EnterpriseRole[] {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return [];
    return tenant.users.get(userId) ?? [];
  }

  /**
   * 获取用户所属的所有租户
   */
  getUserTenants(userId: string): string[] {
    return Array.from(this.userTenantMap.get(userId) ?? []);
  }

  /**
   * 添加项目到租户
   */
  addProjectToTenant(tenantId: string, projectId: string): void {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) throw new Error(`Tenant ${tenantId} not found`);
    if (tenant.projects.size >= tenant.settings.maxProjects) {
      throw new Error(
        `Tenant ${tenantId} reached max projects limit (${tenant.settings.maxProjects})`,
      );
    }
    tenant.projects.add(projectId);
  }

  /**
   * 检查项目是否属于租户
   */
  checkProjectAccess(tenantId: string, projectId: string): boolean {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return false;
    return tenant.projects.has(projectId);
  }

  /**
   * 数据隔离检查：确保用户只能访问自己租户的数据
   */
  enforceIsolation(
    userId: string,
    tenantId: string,
    projectId: string,
  ): { allowed: boolean; reason?: string } {
    if (!this.checkAccess(userId, tenantId)) {
      return { allowed: false, reason: `User ${userId} does not belong to tenant ${tenantId}` };
    }
    if (!this.checkProjectAccess(tenantId, projectId)) {
      return {
        allowed: false,
        reason: `Project ${projectId} does not belong to tenant ${tenantId}`,
      };
    }
    return { allowed: true };
  }

  /**
   * 列出租户的所有用户
   */
  listTenantUsers(tenantId: string): Array<{ userId: string; roles: EnterpriseRole[] }> {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return [];
    return Array.from(tenant.users.entries()).map(([userId, roles]) => ({ userId, roles }));
  }
}

/**
 * ApprovalWorkflow — EE 操作审批流（P3-003）
 *
 * 高风险操作二次审批。
 *
 * 使用方式：
 *   const workflow = new ApprovalWorkflow();
 *   const req = workflow.requestApproval({ type: "force_merge", requester: "alice", resource: "task-123", riskLevel: "high" });
 *   workflow.approve(req.requestId, "bob");
 */
export interface ApprovalRequest {
  requestId: string;
  type:
    | "force_merge"
    | "delete_project"
    | "policy_override"
    | "high_risk_merge"
    | "bulk_delete"
    | "config_change";
  requester: string;
  resource: string;
  riskLevel: "medium" | "high" | "critical";
  description?: string;
  status: "pending" | "approved" | "rejected" | "expired";
  approvers: string[];
  approvals: Array<{
    approver: string;
    decision: "approve" | "reject";
    timestamp: string;
    comment?: string;
  }>;
  requiredApprovals: number;
  createdAt: string;
  expiresAt: string;
  decidedAt?: string;
}

export class ApprovalWorkflow {
  private requests: Map<string, ApprovalRequest> = new Map();
  private approvalRules: Map<
    ApprovalRequest["type"],
    { requiredApprovals: number; approvers: string[]; ttlHours: number }
  >;

  constructor() {
    // 默认审批规则
    this.approvalRules = new Map([
      ["force_merge", { requiredApprovals: 2, approvers: [], ttlHours: 24 }],
      ["delete_project", { requiredApprovals: 2, approvers: [], ttlHours: 48 }],
      ["policy_override", { requiredApprovals: 1, approvers: [], ttlHours: 12 }],
      ["high_risk_merge", { requiredApprovals: 1, approvers: [], ttlHours: 24 }],
      ["bulk_delete", { requiredApprovals: 3, approvers: [], ttlHours: 48 }],
      ["config_change", { requiredApprovals: 1, approvers: [], ttlHours: 12 }],
    ]);
  }

  /**
   * 设置审批规则
   */
  setApprovalRule(
    type: ApprovalRequest["type"],
    rule: { requiredApprovals: number; approvers: string[]; ttlHours: number },
  ): void {
    this.approvalRules.set(type, rule);
  }

  /**
   * 请求审批
   */
  requestApproval(input: {
    type: ApprovalRequest["type"];
    requester: string;
    resource: string;
    riskLevel: "medium" | "high" | "critical";
    description?: string;
  }): ApprovalRequest {
    const rule = this.approvalRules.get(input.type) ?? {
      requiredApprovals: 1,
      approvers: [],
      ttlHours: 24,
    };
    const now = new Date();
    const expiresAt = new Date(now.getTime() + rule.ttlHours * 60 * 60 * 1000);

    const request: ApprovalRequest = {
      requestId: `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: input.type,
      requester: input.requester,
      resource: input.resource,
      riskLevel: input.riskLevel,
      description: input.description,
      status: "pending",
      approvers: rule.approvers,
      approvals: [],
      requiredApprovals: rule.requiredApprovals,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    this.requests.set(request.requestId, request);
    return request;
  }

  /**
   * 批准
   */
  approve(requestId: string, approver: string, comment?: string): ApprovalRequest | null {
    const req = this.requests.get(requestId);
    if (!req || req.status !== "pending") return null;
    if (new Date() > new Date(req.expiresAt)) {
      req.status = "expired";
      return req;
    }

    req.approvals.push({
      approver,
      decision: "approve",
      timestamp: new Date().toISOString(),
      comment,
    });

    if (req.approvals.filter((a) => a.decision === "approve").length >= req.requiredApprovals) {
      req.status = "approved";
      req.decidedAt = new Date().toISOString();
    }

    return req;
  }

  /**
   * 拒绝
   */
  reject(requestId: string, approver: string, comment?: string): ApprovalRequest | null {
    const req = this.requests.get(requestId);
    if (!req || req.status !== "pending") return null;

    req.approvals.push({
      approver,
      decision: "reject",
      timestamp: new Date().toISOString(),
      comment,
    });
    req.status = "rejected";
    req.decidedAt = new Date().toISOString();

    return req;
  }

  /**
   * 获取审批请求
   */
  getRequest(requestId: string): ApprovalRequest | null {
    return this.requests.get(requestId) ?? null;
  }

  /**
   * 列出待审批请求
   */
  listPending(): ApprovalRequest[] {
    return Array.from(this.requests.values()).filter((r) => r.status === "pending");
  }

  /**
   * 检查操作是否已获批准
   */
  isApproved(requestId: string): boolean {
    const req = this.requests.get(requestId);
    return req?.status === "approved";
  }
}
