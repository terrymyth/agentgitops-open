import type {
  OrganizationPolicyConfig,
  OrganizationPolicyProvider,
  PolicyInheritanceLayer,
} from "@agentgitops/core";

/**
 * CeOrganizationPolicyProvider — CE 默认组织策略 Provider（P2-EE-003）
 *
 * CE 版本不支持组织级策略，getConfig 返回 null，getEffectivePolicy 返回空策略。
 * EE 通过注入自定义 OrganizationPolicyProvider 实现组织策略继承。
 *
 * 设计原则：
 * - CE 保持项目级策略（.agentgitops.yml 中的 policies）
 * - CE 不读取或写入组织策略
 * - EE 实现组织→团队→项目三层策略合并，复用 mergePolicyConfigs
 */
export class CeOrganizationPolicyProvider implements OrganizationPolicyProvider {
  getConfig(_organizationId: string): null {
    // CE 不支持组织策略
    return null;
  }

  getEffectivePolicy(
    _organizationId: string,
    _teamId?: string,
    _projectId?: string,
  ): PolicyInheritanceLayer {
    // CE 返回空策略层，项目级策略由 PolicyEngine 从 .agentgitops.yml 加载
    return {};
  }

  updateConfig(_config: OrganizationPolicyConfig): void {
    // CE 不支持更新组织策略
  }

  getHistory(_organizationId: string): OrganizationPolicyConfig[] {
    return [];
  }
}
