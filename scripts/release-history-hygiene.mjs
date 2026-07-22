#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const forbiddenPaths = [
  /^\.agentgitops\/(?:closeouts|handoffs|packages|sync|tasks|verifications)\//,
  /^docs\/internal\//,
  /^docs\/(?:handoff-|kateagent-|dual-machine-)/,
  /^plans\//,
  /^topdocs\//,
];
const privateUsernames = [["guo", "jian", "qiang"].join("")];
const forbiddenText = [
  {
    name: "private username",
    pattern: new RegExp(`\\b(?:${privateUsernames.join("|")})\\b`, "i"),
  },
  { name: "macOS absolute home path", pattern: /\/Users\/[^/\s]+\// },
  { name: "Windows absolute home path", pattern: /[A-Z]:\\Users\\[^\\\s]+\\/i },
  {
    name: "private key material",
    pattern:
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]{64,}?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
  },
];

const roots = execFileSync("git", ["rev-list", "--max-parents=0", "--all"], {
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter(Boolean);
if (roots.length !== 1) {
  throw new Error(`Public repository must have exactly one history root; found ${roots.length}`);
}

const objects = execFileSync("git", ["rev-list", "--objects", "--all"], {
  encoding: "utf8",
  maxBuffer: 100 * 1024 * 1024,
})
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const separator = line.indexOf(" ");
    return separator < 0
      ? { oid: line, path: "" }
      : { oid: line.slice(0, separator), path: line.slice(separator + 1) };
  });

const violations = new Set();
const scannedOids = new Set();
for (const object of objects) {
  if (!object.path) continue;
  if (forbiddenPaths.some((pattern) => pattern.test(object.path))) {
    violations.add(`${object.path}: forbidden path exists in Git history`);
    continue;
  }
  if (!/\.(?:md|json|ya?ml|ts|tsx|js|mjs|txt)$/i.test(object.path)) continue;
  if (scannedOids.has(object.oid)) continue;
  scannedOids.add(object.oid);

  let content;
  try {
    content = execFileSync("git", ["cat-file", "blob", object.oid], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch {
    continue;
  }
  for (const rule of forbiddenText) {
    if (rule.pattern.test(content)) {
      violations.add(`${object.path}: ${rule.name} exists in Git history`);
    }
  }
}

if (violations.size > 0) {
  console.error("Public history hygiene failed:");
  for (const violation of [...violations].sort()) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(
  `PASS public history hygiene (${objects.length} objects, ${scannedOids.size} text blobs, one root)`,
);
