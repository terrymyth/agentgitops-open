export type ConflictWorkflowAction = "resolve" | "false-positive" | "rebase" | "human-takeover";

export interface ConflictRouteMatch {
  conflictId: string;
  action: ConflictWorkflowAction;
}

const CONFLICT_ROUTE =
  /^\/api\/conflicts\/([^/]+)\/(resolve|false-positive|rebase|human-takeover)$/;

export function matchConflictRoute(pathname: string): ConflictRouteMatch | null {
  const match = CONFLICT_ROUTE.exec(pathname);
  if (!match?.[1] || !match[2]) return null;
  return {
    conflictId: decodeURIComponent(match[1]),
    action: match[2] as ConflictWorkflowAction,
  };
}
