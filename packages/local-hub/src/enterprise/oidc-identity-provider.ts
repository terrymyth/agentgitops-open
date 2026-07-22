import type { EnterpriseRole, EnterpriseUser, IdentityProvider } from "@agentgitops/core";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

const OIDC_REQUEST_TIMEOUT_MS = 5_000;

/**
 * OidcIdentityProvider — EE OIDC 身份认证 Provider（P1-003）
 *
 * 实现 IdentityProvider 端口，支持 OIDC 协议（Okta/Entra ID/Google Workspace）。
 *
 * 设计原则：
 * 1. 不在 CE 中引入 OIDC 运行时依赖
 * 2. 通过标准 JWT 验证实现 OIDC token 校验
 * 3. 支持 JWKS（JSON Web Key Set）远程获取
 * 4. 支持 token 过期、签名验证、issuer 校验
 * 5. 降级：无 OIDC 配置时回退到 local actor
 *
 * 使用方式：
 *   const provider = new OidcIdentityProvider({
 *     issuer: "https://login.microsoftonline.com/{tenant}/v2.0",
 *     clientId: "your-client-id",
 *     clientSecret: "your-client-secret",
 *     jwksUri: "https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys",
 *   });
 *   const user = await provider.authenticate(bearerToken);
 */
export interface OidcConfig {
  /** OIDC issuer URL */
  issuer: string;
  /** Client ID */
  clientId: string;
  /** Client Secret（用于 token exchange） */
  clientSecret?: string;
  /** JWKS URI（用于获取签名公钥） */
  jwksUri?: string;
  /** 允许的 audience */
  audience?: string;
  /** 用户信息端点 */
  userInfoEndpoint?: string;
  /** Token introspection 端点 */
  introspectionEndpoint?: string;
  /** 是否启用 token introspection（优先于 JWT 验证） */
  useIntrospection?: boolean;
  /** 角色映射：从 OIDC claim 到 EnterpriseRole */
  roleMapping?: Record<string, "viewer" | "developer" | "reviewer" | "owner" | "admin">;
  /** 组织 ID */
  organizationId?: string;
}

export class OidcIdentityProvider implements IdentityProvider {
  private config: OidcConfig;
  private currentUser: EnterpriseUser | null = null;
  private jwks?: JWTVerifyGetKey;

  constructor(config: OidcConfig) {
    this.config = config;
  }

  /**
   * 认证：验证 Bearer token
   *
   * 优先使用 token introspection（如果配置），
   * 否则使用 JWT 验证 + JWKS。
   */
  async authenticate(token: string): Promise<EnterpriseUser | null> {
    if (!token) return null;

    try {
      if (this.config.useIntrospection && this.config.introspectionEndpoint) {
        return await this.authenticateViaIntrospection(token);
      }
      return await this.authenticateViaJwt(token);
    } catch {
      return null;
    }
  }

  /**
   * 通过 token introspection 认证
   *
   * 向 OIDC provider 的 introspection 端点发送 token，
   * 返回 active=true 时提取用户信息。
   */
  private async authenticateViaIntrospection(token: string): Promise<EnterpriseUser | null> {
    const body = new URLSearchParams({
      token,
      client_id: this.config.clientId,
    });
    if (this.config.clientSecret) {
      body.set("client_secret", this.config.clientSecret);
    }

    const response = await fetch(this.config.introspectionEndpoint!, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(OIDC_REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) return null;

    const result = (await response.json()) as {
      active?: boolean;
      sub?: string;
      username?: string;
      email?: string;
      name?: string;
      groups?: string[];
      iss?: string;
      aud?: string | string[];
      client_id?: string;
      [key: string]: unknown;
    };

    if (!result.active) return null;
    const subject = result.sub ?? result.username;
    if (!subject) return null;
    if (result.iss && result.iss !== this.config.issuer) return null;
    if (result.client_id && result.client_id !== this.config.clientId) return null;
    const expectedAudience = this.config.audience ?? this.config.clientId;
    const audiences = Array.isArray(result.aud) ? result.aud : result.aud ? [result.aud] : [];
    if (audiences.length > 0 && !audiences.includes(expectedAudience)) return null;

    const user = this.mapToEnterpriseUser({
      sub: subject,
      username: result.username ?? subject,
      email: result.email,
      name: result.name ?? result.username,
      groups: result.groups ?? [],
      claims: result,
    });

    this.currentUser = user;
    return user;
  }

  /**
   * 通过 JWT 验证认证
   *
   * 1. 解码 JWT
   * 2. 验证签名（使用 JWKS）
   * 3. 验证 issuer、audience、过期时间
   * 4. 提取用户信息
   */
  private async authenticateViaJwt(token: string): Promise<EnterpriseUser | null> {
    if (!this.config.jwksUri) return null;
    this.jwks ??= createRemoteJWKSet(new URL(this.config.jwksUri), {
      timeoutDuration: OIDC_REQUEST_TIMEOUT_MS,
    });
    const verified = await jwtVerify(token, this.jwks, {
      issuer: this.config.issuer,
      audience: this.config.audience ?? this.config.clientId,
    });
    if (!verified.payload.sub) return null;

    // 获取用户信息（如果配置了 userInfoEndpoint）
    let userInfo: {
      sub?: string;
      username?: string;
      email?: string;
      name?: string;
      groups?: string[];
      [key: string]: unknown;
    } = {
      ...verified.payload,
      groups: Array.isArray(verified.payload.groups)
        ? verified.payload.groups.filter((group): group is string => typeof group === "string")
        : [],
    };

    if (this.config.userInfoEndpoint) {
      try {
        const response = await fetch(this.config.userInfoEndpoint, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(OIDC_REQUEST_TIMEOUT_MS),
        });
        if (response.ok) {
          const remoteUserInfo = (await response.json()) as typeof userInfo;
          if (remoteUserInfo.sub && remoteUserInfo.sub !== verified.payload.sub) return null;
          userInfo = remoteUserInfo;
        }
      } catch {
        // 降级使用 JWT payload
      }
    }

    const user = this.mapToEnterpriseUser({
      sub: userInfo.sub ?? "unknown",
      username: userInfo.username ?? userInfo.sub ?? "unknown",
      email: userInfo.email,
      name: userInfo.name ?? userInfo.username,
      groups: userInfo.groups ?? [],
      claims: userInfo,
    });

    this.currentUser = user;
    return user;
  }

  /**
   * 将 OIDC 用户信息映射为 EnterpriseUser
   */
  private mapToEnterpriseUser(input: {
    sub: string;
    username: string;
    email?: string;
    name?: string;
    groups: string[];
    claims: Record<string, unknown>;
  }): EnterpriseUser {
    const roles = this.extractRoles(input.groups, input.claims);

    return {
      userId: input.sub,
      username: input.username,
      displayName: input.name ?? input.username,
      email: input.email,
      groups: input.groups,
      roles,
      organizationId: this.config.organizationId,
    };
  }

  /**
   * 从 groups 和 claims 提取角色
   *
   * 使用 roleMapping 将 OIDC group/claim 映射为 EnterpriseRole。
   * 默认映射：
   *   - admin / administrators → admin
   *   - owner / maintainers → owner
   *   - reviewer / reviewers → reviewer
   *   - developer / developers → developer
   *   - 其他 → viewer
   */
  private extractRoles(groups: string[], claims: Record<string, unknown>): EnterpriseRole[] {
    const roleSet = new Set<EnterpriseRole>();
    const mapping = this.config.roleMapping ?? {};

    // 默认映射
    const defaultMapping: Record<string, EnterpriseRole> = {
      admin: "admin",
      administrators: "admin",
      owner: "owner",
      maintainers: "owner",
      reviewer: "reviewer",
      reviewers: "reviewer",
      developer: "developer",
      developers: "developer",
      viewer: "viewer",
      viewers: "viewer",
    };

    for (const group of groups) {
      const lower = group.toLowerCase();
      const role = mapping[group] ?? mapping[lower] ?? defaultMapping[lower];
      if (role) roleSet.add(role);
    }

    // 检查 claims 中的角色
    const claimRoles = (claims.roles ?? claims["role"] ?? claims.groups) as string[] | undefined;
    if (Array.isArray(claimRoles)) {
      for (const r of claimRoles) {
        const lower = String(r).toLowerCase();
        const role = mapping[r] ?? mapping[lower] ?? defaultMapping[lower];
        if (role) roleSet.add(role);
      }
    }

    // 如果没有角色，默认 viewer
    if (roleSet.size === 0) {
      roleSet.add("viewer");
    }

    return Array.from(roleSet);
  }

  /**
   * 获取当前用户（最后一次认证的用户）
   */
  getCurrentUser(): EnterpriseUser | null {
    return this.currentUser;
  }

  /**
   * 设置当前用户（用于测试或本地覆盖）
   */
  setCurrentUser(user: EnterpriseUser | null): void {
    this.currentUser = user;
  }
}

/**
 * SamlIdentityProvider — EE SAML 身份认证 Provider（P1-003）
 *
 * 支持 SAML 2.0 协议（Okta/Entra ID SAML）。
 * SAML 断言通常由 IdP POST 到 SP，这里实现断言解析。
 */
export class SamlIdentityProvider implements IdentityProvider {
  private config: {
    entityId: string;
    assertionConsumerServiceUrl: string;
    idpMetadataUrl?: string;
    certificate?: string;
    organizationId?: string;
    roleMapping?: Record<string, "viewer" | "developer" | "reviewer" | "owner" | "admin">;
  };
  private currentUser: EnterpriseUser | null = null;

  constructor(config: {
    entityId: string;
    assertionConsumerServiceUrl: string;
    idpMetadataUrl?: string;
    certificate?: string;
    organizationId?: string;
    roleMapping?: Record<string, "viewer" | "developer" | "reviewer" | "owner" | "admin">;
  }) {
    this.config = config;
  }

  /**
   * 认证：解析 SAML 断言
   *
   * 接收 Base64 编码的 SAML Response，解析提取用户信息。
   */
  async authenticate(samlResponse: string): Promise<EnterpriseUser | null> {
    try {
      const decoded = Buffer.from(samlResponse, "base64").toString("utf8");
      const user = this.parseSamlAssertion(decoded);
      this.currentUser = user;
      return user;
    } catch {
      return null;
    }
  }

  /**
   * 解析 SAML 断言（简化实现，提取关键属性）
   */
  private parseSamlAssertion(xml: string): EnterpriseUser | null {
    // 提取 NameID
    const nameIdMatch = xml.match(/<saml:NameID[^>]*>([^<]+)<\/saml:NameID>/);
    const nameId = nameIdMatch?.[1] ?? "unknown";

    // 提取属性
    const getAttribute = (name: string): string | undefined => {
      const regex = new RegExp(
        `<saml:Attribute[^>]*Name="${name}"[^>]*>\\s*<saml:AttributeValue[^>]*>([^<]+)<\\/saml:AttributeValue>`,
      );
      return xml.match(regex)?.[1];
    };

    const email =
      getAttribute("email") ??
      getAttribute("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress");
    const displayName = getAttribute("displayName") ?? getAttribute("name") ?? nameId;
    const groupsRaw =
      getAttribute("groups") ??
      getAttribute("http://schemas.microsoft.com/ws/2008/06/identity/claims/groups");
    const groups = groupsRaw ? groupsRaw.split(",").map((g) => g.trim()) : [];

    // 角色映射
    const roleSet = new Set<EnterpriseRole>();
    const mapping = this.config.roleMapping ?? {};
    const defaultMapping: Record<string, EnterpriseRole> = {
      admin: "admin",
      owner: "owner",
      reviewer: "reviewer",
      developer: "developer",
      viewer: "viewer",
    };
    for (const group of groups) {
      const lower = group.toLowerCase();
      const role = mapping[group] ?? mapping[lower] ?? defaultMapping[lower];
      if (role) roleSet.add(role);
    }
    if (roleSet.size === 0) roleSet.add("viewer");

    return {
      userId: nameId,
      username: nameId,
      displayName,
      email,
      groups,
      roles: Array.from(roleSet),
      organizationId: this.config.organizationId,
    };
  }

  getCurrentUser(): EnterpriseUser | null {
    return this.currentUser;
  }
}
