export type SyncRouteAction = "push" | "pull";

export interface SyncRouteMatch {
  action: SyncRouteAction;
}

const SYNC_ROUTE = /^\/api\/sync\/(push|pull)$/;

export function matchSyncRoute(pathname: string): SyncRouteMatch | null {
  const match = SYNC_ROUTE.exec(pathname);
  if (!match?.[1]) return null;
  return { action: match[1] as SyncRouteAction };
}
