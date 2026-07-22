/**
 * agentgitops 核心常量
 */

/** 默认端口 */
export const DEFAULT_PORT = 4789;

/** 配置文件版本 */
export const CONFIG_VERSION = 1;

/** 配置文件名 */
export const CONFIG_FILENAME = ".agentgitops.yml";

/** 配置目录名 */
export const CONFIG_DIR = ".agentgitops";

/** worktree 根目录默认名 */
export const DEFAULT_WORKTREE_ROOT = "../.agentgitops-worktrees";

/** 本地数据库名 */
export const DB_FILENAME = "db.sqlite";

/** Change Package 规范版本 */
export const CHANGE_PACKAGE_VERSION = "1.0";

/** 默认任务超时（毫秒） */
export const DEFAULT_TASK_TIMEOUT_MS = 30 * 60 * 1000;

/** 默认最大修改文件数 */
export const DEFAULT_MAX_CHANGED_FILES = 50;

/** 默认最大新增行数 */
export const DEFAULT_MAX_INSERTIONS = 2000;

/** 默认最大删除行数 */
export const DEFAULT_MAX_DELETIONS = 1000;
