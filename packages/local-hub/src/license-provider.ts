import type { LicenseProvider, LicenseSummary, LicenseValidationResult } from "@agentgitops/core";

/**
 * CeLicenseProvider — CE 默认 License Provider（P2-EE-001）
 *
 * CE 版本始终返回 ce edition，valid=true，features 为空。
 * EE 通过注入自定义 LicenseProvider 替换此实现。
 *
 * 设计原则：
 * - CE 不依赖任何 license 文件或密钥
 * - CE 的所有功能无需 license 即可使用
 * - EE 模块加载前检查 license，无 license 时 EE 模块不加载
 */
export class CeLicenseProvider implements LicenseProvider {
  validate(): LicenseValidationResult {
    return {
      valid: true,
      edition: "ce",
      features: [],
    };
  }

  hasFeature(_feature: string): boolean {
    // CE 版本不检查功能 flag，所有 CE 功能默认可用
    return true;
  }

  getSummary(): LicenseSummary {
    return {
      edition: "ce",
      valid: true,
      features: [],
    };
  }
}
