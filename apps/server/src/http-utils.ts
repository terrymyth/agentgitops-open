import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { randomUUID } from "node:crypto";

export async function serveStaticFile(
  staticDir: string,
  pathname: string,
  res: http.ServerResponse,
): Promise<void> {
  const candidate = pathname === "/" ? "index.html" : pathname.slice(1);
  const targetPath = path.resolve(staticDir, candidate);
  const relative = path.relative(staticDir, targetPath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    sendError(res, 403, "FORBIDDEN", "Forbidden");
    return;
  }

  try {
    const stat = await fs.stat(targetPath);
    if (stat.isFile()) {
      const content = await fs.readFile(targetPath);
      res.writeHead(200, { "Content-Type": contentType(targetPath) });
      res.end(content);
      return;
    }
  } catch {
    // Fall through to SPA fallback.
  }

  const indexPath = path.join(staticDir, "index.html");
  try {
    const content = await fs.readFile(indexPath);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(content);
  } catch {
    sendError(res, 404, "WEB_ASSETS_NOT_FOUND", "Web assets not found. Run pnpm build first.");
  }
}

export function sendJson(res: http.ServerResponse, data: unknown): void {
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(
    JSON.stringify({
      data,
      meta: {
        requestId: `req_${randomUUID()}`,
        timestamp: new Date().toISOString(),
      },
    }),
  );
}

export function sendError(
  res: http.ServerResponse,
  statusCode: number,
  code: string,
  message: string,
): void {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(
    JSON.stringify({
      error: { code, message },
      meta: {
        requestId: `req_${randomUUID()}`,
        timestamp: new Date().toISOString(),
      },
    }),
  );
}

function contentType(filePath: string): string {
  switch (path.extname(filePath)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}
