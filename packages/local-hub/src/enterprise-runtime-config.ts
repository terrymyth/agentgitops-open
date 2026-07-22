import type { StorageConfig } from "@agentgitops/core";
import type { AgentgitopsConfig } from "./config-loader.js";
import {
  createEnterpriseExtensions,
  type EnterpriseExtensionConfig,
} from "./enterprise-extension-factory.js";
import { createExtensionRegistryFromConfig, type ExtensionRegistry } from "./extension-registry.js";

export interface EnterpriseRuntimeResolution {
  extensionConfig: EnterpriseExtensionConfig;
  sources: {
    license: "env" | "config" | "default";
    licenseKey: "env" | "config" | "none";
    storage: "env" | "config" | "default";
  };
}

type RuntimeEnv = Record<string, string | undefined>;
type SiemType = NonNullable<EnterpriseExtensionConfig["siem"]>["siemType"];

export function resolveEnterpriseExtensionConfig(
  config: AgentgitopsConfig,
  env: RuntimeEnv = process.env,
): EnterpriseRuntimeResolution {
  const enterprise = config.enterprise;
  const forceCeDefaults =
    enterprise?.forceCeDefaults === true ||
    enterprise?.enabled === false ||
    parseBoolean(env.AGENTGITOPS_FORCE_CE) === true;

  const envLicense = parseLicense(env.AGENTGITOPS_EDITION ?? env.AGENTGITOPS_LICENSE_EDITION);
  const configLicense =
    enterprise?.license ?? (enterprise?.enabled === true ? "enterprise" : undefined);
  const license = forceCeDefaults ? "ce" : (envLicense ?? configLicense ?? "ce");
  const licenseSource =
    forceCeDefaults || envLicense ? "env" : configLicense ? "config" : "default";

  const configuredLicenseKey = enterprise?.licenseKeyEnv
    ? env[enterprise.licenseKeyEnv]
    : enterprise?.licenseKey;
  const envLicenseKey = env.AGENTGITOPS_LICENSE_KEY;
  const licenseKey = envLicenseKey ?? configuredLicenseKey;
  const licenseKeySource = envLicenseKey ? "env" : configuredLicenseKey ? "config" : "none";

  const { storage, source: storageSource } = resolveStorageConfig(enterprise?.storage, env);

  return {
    extensionConfig: {
      license,
      licenseKey,
      storage,
      oidc: resolveOidcConfig(enterprise?.oidc, env),
      saml: enterprise?.saml,
      rbac: resolveRbacConfig(enterprise?.rbac, env),
      siem: resolveSiemConfig(enterprise?.siem, env),
      compliance: enterprise?.compliance,
      allowCeFallback: enterprise?.allowCeFallback,
      forceCeDefaults,
    },
    sources: {
      license: licenseSource,
      licenseKey: licenseKeySource,
      storage: storageSource,
    },
  };
}

export async function createRuntimeExtensionRegistry(
  config: AgentgitopsConfig,
  env: RuntimeEnv = process.env,
): Promise<ExtensionRegistry> {
  const { extensionConfig } = resolveEnterpriseExtensionConfig(config, env);
  const extensions = await createEnterpriseExtensions(extensionConfig);
  return createExtensionRegistryFromConfig(config, extensions);
}

function resolveStorageConfig(
  configured: StorageConfig | undefined,
  env: RuntimeEnv,
): { storage: StorageConfig; source: "env" | "config" | "default" } {
  const envType = parseStorageType(env.AGENTGITOPS_STORAGE_TYPE);
  const envUrl = env.AGENTGITOPS_STORAGE_URL ?? env.AGENTGITOPS_DATABASE_URL ?? env.DATABASE_URL;
  const inferredEnvType =
    envUrl?.startsWith("postgres://") || envUrl?.startsWith("postgresql://")
      ? "postgresql"
      : undefined;
  const type = envType ?? inferredEnvType;

  if (type || envUrl) {
    return {
      source: "env",
      storage: {
        type: type ?? configured?.type ?? "sqlite",
        url: envUrl ?? configured?.url ?? ".agentgitops/db.sqlite",
        poolSize: parsePositiveInteger(env.AGENTGITOPS_STORAGE_POOL_SIZE) ?? configured?.poolSize,
        timeoutMs:
          parsePositiveInteger(env.AGENTGITOPS_STORAGE_TIMEOUT_MS) ?? configured?.timeoutMs,
        ssl: parseBoolean(env.AGENTGITOPS_STORAGE_SSL) ?? configured?.ssl,
      },
    };
  }

  if (configured) {
    return { storage: configured, source: "config" };
  }

  return {
    source: "default",
    storage: { type: "sqlite", url: ".agentgitops/db.sqlite" },
  };
}

function resolveOidcConfig(
  configured: EnterpriseExtensionConfig["oidc"] | undefined,
  env: RuntimeEnv,
): EnterpriseExtensionConfig["oidc"] | undefined {
  const issuer = env.AGENTGITOPS_OIDC_ISSUER;
  const clientId = env.AGENTGITOPS_OIDC_CLIENT_ID;
  if (!issuer && !clientId) return configured;
  if (!issuer || !clientId) return configured;

  return {
    issuer,
    clientId,
    clientSecret: env.AGENTGITOPS_OIDC_CLIENT_SECRET ?? configured?.clientSecret,
    jwksUri: env.AGENTGITOPS_OIDC_JWKS_URI ?? configured?.jwksUri,
    audience: env.AGENTGITOPS_OIDC_AUDIENCE ?? configured?.audience,
    userInfoEndpoint: configured?.userInfoEndpoint,
    introspectionEndpoint: configured?.introspectionEndpoint,
    useIntrospection:
      parseBoolean(env.AGENTGITOPS_OIDC_USE_INTROSPECTION) ?? configured?.useIntrospection,
    roleMapping: configured?.roleMapping,
    organizationId: env.AGENTGITOPS_ORGANIZATION_ID ?? configured?.organizationId,
  };
}

function resolveRbacConfig(
  configured: EnterpriseExtensionConfig["rbac"] | undefined,
  env: RuntimeEnv,
): EnterpriseExtensionConfig["rbac"] | undefined {
  const superAdmins = splitList(env.AGENTGITOPS_RBAC_SUPER_ADMINS);
  if (superAdmins.length === 0) return configured;
  return { ...configured, superAdmins };
}

function resolveSiemConfig(
  configured: EnterpriseExtensionConfig["siem"] | undefined,
  env: RuntimeEnv,
): EnterpriseExtensionConfig["siem"] | undefined {
  const webhookUrl = env.AGENTGITOPS_SIEM_WEBHOOK_URL;
  const token = env.AGENTGITOPS_SIEM_TOKEN;
  const type = parseSiemType(env.AGENTGITOPS_SIEM_TYPE);
  const autoPush = parseBoolean(env.AGENTGITOPS_SIEM_AUTO_PUSH);
  if (!webhookUrl && !token && !type && autoPush === undefined) return configured;
  return {
    siemWebhookUrl: webhookUrl ?? configured?.siemWebhookUrl,
    siemToken: token ?? configured?.siemToken,
    siemType: type ?? configured?.siemType,
    autoPush: autoPush ?? configured?.autoPush,
  };
}

function parseLicense(value: string | undefined): EnterpriseExtensionConfig["license"] | undefined {
  if (value === "ce" || value === "team" || value === "enterprise" || value === "enterprise-plus") {
    return value;
  }
  return undefined;
}

function parseStorageType(value: string | undefined): StorageConfig["type"] | undefined {
  if (value === "sqlite" || value === "postgresql") return value;
  return undefined;
}

function parseSiemType(value: string | undefined): SiemType | undefined {
  if (
    value === "splunk" ||
    value === "datadog" ||
    value === "elastic" ||
    value === "chronicle" ||
    value === "generic"
  ) {
    return value;
  }
  return undefined;
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (["1", "true", "yes", "on"].includes(value.toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(value.toLowerCase())) return false;
  return undefined;
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function splitList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
