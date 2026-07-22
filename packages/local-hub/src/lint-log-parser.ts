import type { VerificationSummary } from "@agentgitops/core";

/**
 * Lint/Test 日志解析器
 *
 * 从命令输出中解析 ESLint、vitest/jest 的统计信息，
 * 提取 error/warning 计数和测试结果。
 */

/** ESLint 经典格式：✖ N problems (M errors, W warnings) */
const ESLINT_PROBLEMS_RE =
  /✖\s*(?<problems>\d+)\s*problems?\s*\((?<errors>\d+)\s*errors?,\s*(?<warnings>\d+)\s*warnings?\)/;

/** ESLint compact：N problems (M errors, W warnings) 无符号 */
const ESLINT_PROBLEMS_NO_SYMBOL_RE =
  /(?<problems>\d+)\s*problems?\s*\((?<errors>\d+)\s*errors?,\s*(?<warnings>\d+)\s*warnings?\)/;

/** vitest：Test Files N passed/failed | Tests M passed/failed */
const VITEST_TESTS_RE = /Tests\s+(?<passed>\d+)\s*passed(?:\s*\|\s*(?<failed>\d+)\s*failed)?/;

/** jest：Tests: M passed, N failed, K total */
const JEST_TESTS_RE =
  /Tests:\s+(?<passed>\d+)\s*passed(?:,\s*(?<failed>\d+)\s*failed)?(?:,\s*(?<total>\d+)\s*total)?/;

/** 通用 error 行：包含 "error" 关键词的行 */
const GENERIC_ERROR_RE = /\berror\b/gi;
/** 通用 warning 行：包含 "warning" 关键词的行 */
const GENERIC_WARNING_RE = /\bwarning\b/gi;

/**
 * 解析命令输出，提取验证摘要
 *
 * 根据命令名称和输出内容自动识别 lint/test/generic 类型。
 */
export function parseVerificationLog(command: string, output: string): VerificationSummary {
  const kind = detectKind(command);

  if (kind === "lint") {
    return parseLint(output, kind);
  }
  if (kind === "test") {
    return parseTest(output, kind);
  }
  return parseGeneric(output);
}

function detectKind(command: string): VerificationSummary["kind"] {
  const cmd = command.toLowerCase();
  if (cmd.includes("eslint") || cmd.includes("lint")) return "lint";
  if (cmd.includes("vitest") || cmd.includes("jest") || cmd.includes("test")) return "test";
  return "generic";
}

function parseLint(output: string, kind: VerificationSummary["kind"]): VerificationSummary {
  const match = output.match(ESLINT_PROBLEMS_RE) ?? output.match(ESLINT_PROBLEMS_NO_SYMBOL_RE);
  if (match?.groups) {
    return {
      kind,
      errors: Number(match.groups.errors ?? 0),
      warnings: Number(match.groups.warnings ?? 0),
      messages: extractMessages(output, /(?:error|warning):\s*.+/gi, 5),
    };
  }
  // 无法匹配 ESLint 格式，退化为通用计数
  return parseGeneric(output, kind);
}

function parseTest(output: string, kind: VerificationSummary["kind"]): VerificationSummary {
  const vitestTests = output.match(VITEST_TESTS_RE);
  if (vitestTests?.groups) {
    const passed = Number(vitestTests.groups.passed ?? 0);
    const failed = Number(vitestTests.groups.failed ?? 0);
    return {
      kind,
      errors: failed,
      warnings: 0,
      testsTotal: passed + failed,
      testsPassed: passed,
      testsFailed: failed,
      messages: extractMessages(output, /FAIL\s+.+/g, 5),
    };
  }

  const jestMatch = output.match(JEST_TESTS_RE);
  if (jestMatch?.groups) {
    const passed = Number(jestMatch.groups.passed ?? 0);
    const failed = Number(jestMatch.groups.failed ?? 0);
    const total = jestMatch.groups.total ? Number(jestMatch.groups.total) : passed + failed;
    return {
      kind,
      errors: failed,
      warnings: 0,
      testsTotal: total,
      testsPassed: passed,
      testsFailed: failed,
      messages: extractMessages(output, /✕\s+.+/g, 5),
    };
  }

  return parseGeneric(output, kind);
}

function parseGeneric(
  output: string,
  kind: VerificationSummary["kind"] = "generic",
): VerificationSummary {
  const errors = (output.match(GENERIC_ERROR_RE) ?? []).length;
  const warnings = (output.match(GENERIC_WARNING_RE) ?? []).length;
  return {
    kind,
    errors,
    warnings,
    messages: [],
  };
}

function extractMessages(output: string, pattern: RegExp, limit: number): string[] {
  const matches = output.match(pattern);
  if (!matches) return [];
  return matches.slice(0, limit);
}
