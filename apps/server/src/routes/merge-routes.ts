export type MergeQueueAction = "evaluate" | "approve" | "block";

export interface MergeQueueRouteMatch {
  taskId: string;
  action: MergeQueueAction;
}

const MERGE_QUEUE_ROUTE = /^\/api\/merge-queue\/([^/]+)\/(evaluate|approve|block)$/;

export function matchMergeQueueRoute(pathname: string): MergeQueueRouteMatch | null {
  const match = MERGE_QUEUE_ROUTE.exec(pathname);
  if (!match?.[1] || !match[2]) return null;
  return {
    taskId: decodeURIComponent(match[1]),
    action: match[2] as MergeQueueAction,
  };
}
