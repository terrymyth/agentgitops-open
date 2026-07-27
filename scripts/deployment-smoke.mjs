import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { repoRoot } from "./smoke-utils.mjs";

const realSmoke = process.env.AGENTGITOPS_SMOKE_DEPLOY_REAL === "1";
const results = [];

function record(name, status, detail) {
  results.push({ name, status, detail });
}

function fail(name, detail) {
  record(name, "fail", detail);
  throw new Error(`${name}: ${detail}`);
}

function read(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!existsSync(absolutePath)) fail(relativePath, "missing");
  return readFileSync(absolutePath, "utf-8");
}

function parseJson(relativePath) {
  try {
    return JSON.parse(read(relativePath));
  } catch (error) {
    fail(relativePath, error instanceof Error ? error.message : String(error));
  }
}

function hasCommand(command, args = ["--version"]) {
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: "utf-8", stdio: "ignore" });
  return result.status === 0;
}

function runOptional(command, args, name) {
  if (!realSmoke) {
    record(name, "skip", "set AGENTGITOPS_SMOKE_DEPLOY_REAL=1 to run");
    return;
  }
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    fail(name, `${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  record(name, "ok", `${command} ${args.join(" ")}`);
}

function runRequired(command, args, name) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    fail(name, `${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  record(name, "ok", `${command} ${args.join(" ")}`);
  return result;
}

function validateDockerfile() {
  const dockerfile = read("Dockerfile");
  const dockerignore = read(".dockerignore");
  const required = [
    "FROM node:24-slim AS builder",
    "FROM node:24-slim AS runtime",
    "--filter agentgitops",
    "apt-get install -y --no-install-recommends ca-certificates git",
    "HEALTHCHECK",
    "EXPOSE 4789",
    "ENTRYPOINT",
    "apps/cli/dist/index.js",
  ];
  for (const token of required) {
    if (!dockerfile.includes(token)) fail("dockerfile:static", `missing ${token}`);
  }
  for (const token of [".git", ".agentgitops", "**/node_modules", "**/dist"]) {
    if (!dockerignore.includes(token)) fail("dockerfile:static", `.dockerignore missing ${token}`);
  }
  record(
    "dockerfile:static",
    "ok",
    "Node 24 image, system Git, CLI build, healthcheck, port and entrypoint present",
  );
}

function validateCompose() {
  const compose = read("docker-compose.yml");
  const required = [
    "agentgitops:",
    "4789:4789",
    "healthcheck:",
    "/api/health",
    "AGENTGITOPS_HOST=0.0.0.0",
    "AGENTGITOPS_PORT=4789",
  ];
  for (const token of required) {
    if (!compose.includes(token)) fail("docker-compose:static", `missing ${token}`);
  }
  record("docker-compose:static", "ok", "service, port mapping, env and healthcheck present");
}

function validateHelmStatic() {
  const chart = read("deploy/helm/Chart.yaml");
  const values = read("deploy/helm/values.yaml");
  const deployment = read("deploy/helm/templates/deployment.yaml");
  const service = read("deploy/helm/templates/service.yaml");
  if (!chart.includes("apiVersion: v2")) fail("helm:static", "Chart.yaml is not v2");
  if (!values.includes("port: 4789")) fail("helm:static", "values.yaml missing service port");
  if (!values.includes("path: /api/health"))
    fail("helm:static", "values.yaml missing health probe path");
  if (!deployment.includes("livenessProbe:") || !deployment.includes("readinessProbe:")) {
    fail("helm:static", "deployment missing health probes");
  }
  if (!service.includes("port: {{ .Values.service.port }}"))
    fail("helm:static", "service missing templated port");
  record("helm:static", "ok", "chart, values, deployment and service templates present");
}

function validateOpenApi() {
  const openapi = parseJson("docs/openapi.json");
  if (openapi.openapi !== "3.0.3") fail("openapi:schema", "expected OpenAPI 3.0.3");
  if (!openapi.paths?.["/api/health"]) fail("openapi:schema", "missing /api/health");
  if (!openapi.paths?.["/api/tasks"]) fail("openapi:schema", "missing /api/tasks");
  if (!openapi.components?.schemas) fail("openapi:schema", "missing components.schemas");
  record("openapi:schema", "ok", `${Object.keys(openapi.paths).length} paths`);
}

function validateJsonSchemas() {
  const configSchema = parseJson("schemas/agentgitops-config-v1.json");
  const changePackageSchema = parseJson("schemas/change-package-v1.json");
  if (configSchema.$schema !== "https://json-schema.org/draft/2020-12/schema") {
    fail("json-schema:config", "unexpected draft");
  }
  if (!configSchema.properties?.enterprise)
    fail("json-schema:config", "missing enterprise runtime config");
  if (changePackageSchema.type !== "object")
    fail("json-schema:change-package", "expected object schema");
  record("json-schema:config", "ok", "agentgitops config schema parses");
  record("json-schema:change-package", "ok", "change package schema parses");
}

async function runContainerHealthSmoke() {
  if (!realSmoke) {
    record("docker:health", "skip", "set AGENTGITOPS_SMOKE_DEPLOY_REAL=1 to run");
    return;
  }

  const containerName = `agentgitops-smoke-${process.pid}`;
  const hostPort = process.env.AGENTGITOPS_SMOKE_DEPLOY_PORT ?? "14789";
  const started = spawnSync(
    "docker",
    [
      "run",
      "--detach",
      "--rm",
      "--name",
      containerName,
      "--publish",
      `127.0.0.1:${hostPort}:4789`,
      "agentgitops:smoke",
    ],
    {
      cwd: repoRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (started.status !== 0) {
    fail("docker:health", started.stderr || started.stdout);
  }

  try {
    let lastError = "health endpoint did not respond";
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${hostPort}/api/health`);
        if (response.ok) {
          record("docker:health", "ok", `container health endpoint passed on port ${hostPort}`);
          return;
        }
        lastError = `health endpoint returned HTTP ${response.status}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    const logs = spawnSync("docker", ["logs", containerName], {
      cwd: repoRoot,
      encoding: "utf-8",
    });
    fail("docker:health", `${lastError}\n${logs.stderr || logs.stdout}`);
  } finally {
    spawnSync("docker", ["rm", "--force", containerName], {
      cwd: repoRoot,
      stdio: "ignore",
    });
  }
}

async function runRealChecks() {
  if (hasCommand("docker")) {
    runOptional("docker", ["build", "-t", "agentgitops:smoke", "."], "docker:build");
    runOptional(
      "docker",
      ["compose", "-f", "docker-compose.yml", "config"],
      "docker-compose:config",
    );
    await runContainerHealthSmoke();
  } else {
    if (realSmoke) fail("docker:build", "docker is required for the real deployment smoke");
    record("docker:build", "skip", "docker not found");
    record("docker-compose:config", "skip", "docker not found");
    record("docker:health", "skip", "docker not found");
  }

  if (hasCommand("helm")) {
    if (realSmoke) runRequired("helm", ["lint", "deploy/helm"], "helm:lint");
    const result = runRequired("helm", ["template", "agentgitops", "deploy/helm"], "helm:template");
    if (!result.stdout.includes("kind: Deployment") || !result.stdout.includes("/api/health")) {
      fail("helm:template", "rendered manifest missing deployment or health endpoint");
    }
  } else {
    if (realSmoke) fail("helm:template", "helm is required for the real deployment smoke");
    record("helm:template", "skip", "helm not found");
  }
}

validateDockerfile();
validateCompose();
validateHelmStatic();
validateOpenApi();
validateJsonSchemas();
await runRealChecks();

for (const result of results) {
  const prefix = result.status === "ok" ? "PASS" : result.status === "skip" ? "SKIP" : "FAIL";
  console.log(`${prefix} ${result.name} - ${result.detail}`);
}
