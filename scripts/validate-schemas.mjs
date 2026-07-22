#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { parse as parseYaml } from "yaml";

const root = process.cwd();
const readJson = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));

const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
const configSchema = readJson("schemas/agentgitops-config-v1.json");
const changePackageSchema = readJson("schemas/change-package-v1.json");
const openSourcePolicySchema = readJson("schemas/open-source-policy-v1.json");
const validateConfig = ajv.compile(configSchema);
const validateChangePackage = ajv.compile(changePackageSchema);
const validateOpenSourcePolicy = ajv.compile(openSourcePolicySchema);

const cases = [
  {
    name: ".agentgitops.yml",
    value: parseYaml(readFileSync(resolve(root, ".agentgitops.yml"), "utf8")),
    validate: validateConfig,
  },
  {
    name: "examples/change-package-minimal.json",
    value: readJson("examples/change-package-minimal.json"),
    validate: validateChangePackage,
  },
  {
    name: "examples/change-package-example.json",
    value: readJson("examples/change-package-example.json"),
    validate: validateChangePackage,
  },
  {
    name: "open-source-policy.json",
    value: readJson("open-source-policy.json"),
    validate: validateOpenSourcePolicy,
  },
];

let failed = false;
for (const item of cases) {
  if (item.validate(item.value)) {
    console.log(`PASS ${item.name}`);
    continue;
  }
  failed = true;
  console.error(`FAIL ${item.name}`);
  console.error(ajv.errorsText(item.validate.errors, { separator: "\n  " }));
}

const invalidConfigAccepted = validateConfig({ version: 1 });
const invalidPackageAccepted = validateChangePackage({ schemaVersion: "1.0" });
const invalidOpenSourcePolicyAccepted = validateOpenSourcePolicy({ version: 1 });
if (invalidConfigAccepted || invalidPackageAccepted || invalidOpenSourcePolicyAccepted) {
  failed = true;
  console.error("FAIL schemas accepted intentionally invalid fixtures");
} else {
  console.log("PASS invalid fixtures are rejected");
}

if (failed) process.exit(1);
