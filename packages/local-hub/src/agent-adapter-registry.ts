import type { AgentAdapter } from "./agent-adapters.js";
import {
  GenericAgentAdapter,
  ClaudeCodeAgentAdapter,
  CodexAgentAdapter,
  OpenCodeAdapter,
  createAgentAdapter,
} from "./agent-adapters.js";

/**
 * AgentAdapterRegistry — Agent Adapter 插件化注册（P1）
 *
 * 开放 Adapter SDK 注册接口，支持社区贡献自定义适配器。
 *
 * 使用方式：
 *   const registry = new AgentAdapterRegistry();
 *   registry.register("my-custom-agent", { create: (config) => new MyAdapter(config) });
 *   const adapter = registry.create("my-custom-agent", config);
 */
export interface AdapterFactory {
  create(config: AdapterConfig): AgentAdapter;
}

export interface AdapterConfig {
  type: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  [key: string]: unknown;
}

export interface RegisteredAdapter {
  type: string;
  factory: AdapterFactory;
  description?: string;
  builtIn: boolean;
}

export class AgentAdapterRegistry {
  private adapters: Map<string, RegisteredAdapter> = new Map();

  constructor() {
    this.registerBuiltInAdapters();
  }

  /**
   * 注册内置适配器
   */
  private registerBuiltInAdapters(): void {
    // generic-cli
    this.registerInternal(
      "generic-cli",
      { create: () => new GenericAgentAdapter() },
      "通用 CLI 适配器，通过配置命令模板兼容任意 CLI Agent",
    );

    // claude-code
    this.registerInternal(
      "claude-code",
      { create: () => new ClaudeCodeAgentAdapter() },
      "Claude Code 专用适配器",
    );

    // codex
    this.registerInternal(
      "codex",
      { create: () => new CodexAgentAdapter() },
      "OpenAI Codex 专用适配器",
    );

    // opencode
    this.registerInternal("opencode", { create: () => new OpenCodeAdapter() }, "OpenCode 适配器");
  }

  /**
   * 注册自定义适配器
   *
   * 社区可以通过此方法注册自定义 Agent 适配器。
   */
  register(type: string, factory: AdapterFactory, description?: string): void {
    if (this.adapters.has(type) && this.adapters.get(type)?.builtIn) {
      throw new Error(`Cannot override built-in adapter "${type}"`);
    }
    this.adapters.set(type, { type, factory, description, builtIn: false });
  }

  /**
   * 内部注册（支持内置标记）
   */
  private registerInternal(type: string, factory: AdapterFactory, description?: string): void {
    this.adapters.set(type, { type, factory, description, builtIn: true });
  }

  /**
   * 注册适配器类（简化方式）
   *
   * 传入一个构造函数，自动包装为工厂。
   */
  registerClass(
    type: string,
    adapterClass: new (config: AdapterConfig) => AgentAdapter,
    description?: string,
  ): void {
    this.register(type, { create: (config) => new adapterClass(config) }, description);
  }

  /**
   * 注销适配器（不能注销内置适配器）
   */
  unregister(type: string): boolean {
    const adapter = this.adapters.get(type);
    if (!adapter || adapter.builtIn) return false;
    return this.adapters.delete(type);
  }

  /**
   * 创建适配器实例
   */
  create(type: string, config: AdapterConfig): AgentAdapter {
    const registered = this.adapters.get(type);
    if (!registered) {
      throw new Error(
        `Agent adapter "${type}" not registered. Available: ${this.listTypes().join(", ")}`,
      );
    }
    return registered.factory.create(config);
  }

  /**
   * 根据配置自动创建适配器（兼容旧版 createAgentAdapter）
   */
  createFromConfig(config: AdapterConfig): AgentAdapter {
    // 优先使用注册的适配器
    if (this.adapters.has(config.type)) {
      return this.create(config.type, config);
    }
    // 降级到旧版工厂（createAgentAdapter 接受 type 字符串）
    return createAgentAdapter(config.type);
  }

  /**
   * 列出所有已注册的适配器类型
   */
  listTypes(): string[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * 列出所有已注册的适配器（含描述）
   */
  listAdapters(): Array<{ type: string; description?: string; builtIn: boolean }> {
    return Array.from(this.adapters.values()).map((a) => ({
      type: a.type,
      description: a.description,
      builtIn: a.builtIn,
    }));
  }

  /**
   * 检查适配器是否已注册
   */
  has(type: string): boolean {
    return this.adapters.has(type);
  }

  /**
   * 获取适配器信息
   */
  getAdapterInfo(type: string): { type: string; description?: string; builtIn: boolean } | null {
    const adapter = this.adapters.get(type);
    if (!adapter) return null;
    return { type: adapter.type, description: adapter.description, builtIn: adapter.builtIn };
  }
}

/**
 * 全局默认注册表（单例）
 */
let globalRegistry: AgentAdapterRegistry | null = null;

/**
 * 获取全局适配器注册表
 */
export function getGlobalAdapterRegistry(): AgentAdapterRegistry {
  if (!globalRegistry) {
    globalRegistry = new AgentAdapterRegistry();
  }
  return globalRegistry;
}

/**
 * 注册全局适配器
 */
export function registerGlobalAdapter(
  type: string,
  factory: AdapterFactory,
  description?: string,
): void {
  getGlobalAdapterRegistry().register(type, factory, description);
}

/**
 * 创建适配器（使用全局注册表）
 */
export function createRegisteredAdapter(type: string, config: AdapterConfig): AgentAdapter {
  return getGlobalAdapterRegistry().create(type, config);
}
