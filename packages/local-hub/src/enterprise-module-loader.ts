import type {
  EnterpriseModuleLoadResult,
  EnterpriseModuleLoader,
  EnterpriseModuleManifest,
} from "@agentgitops/core";

/**
 * CeModuleLoader — CE 默认企业模块加载器（P2-EE-002）
 *
 * CE 版本不加载任何企业模块，discover 返回空列表。
 * EE 通过注入自定义 EnterpriseModuleLoader 实现动态 import 和签名校验。
 *
 * 设计原则：
 * - CE 不执行动态 import，避免供应链风险
 * - CE 保留元数据发现能力（从配置读取模块清单），但不实际加载
 * - EE loader 单独实现签名校验、版本约束、license gate 和审计
 */
export class CeModuleLoader implements EnterpriseModuleLoader {
  discover(): EnterpriseModuleManifest[] {
    // CE 不发现任何企业模块
    return [];
  }

  load(manifest: EnterpriseModuleManifest): EnterpriseModuleLoadResult {
    // CE 拒绝加载任何企业模块
    return {
      moduleId: manifest.moduleId,
      loaded: false,
      capabilities: [],
      error:
        "Enterprise module loading is not available in CE edition. Install Enterprise Edition to load enterprise modules.",
      durationMs: 0,
    };
  }

  unload(_moduleId: string): boolean {
    return false;
  }

  listLoaded(): EnterpriseModuleLoadResult[] {
    return [];
  }
}
