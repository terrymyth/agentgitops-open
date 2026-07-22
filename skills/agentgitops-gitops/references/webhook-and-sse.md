# Webhook And SSE

## GitHub Webhook Secret

Set the secret only in the runtime environment:

```bash
export AGENTGITOPS_GITHUB_WEBHOOK_SECRET="$(openssl rand -hex 32)"
```

`GITHUB_WEBHOOK_SECRET` may be supported as a compatibility alias. Do not commit either value.

In GitHub repository settings:

- Payload URL: `https://<public-host>/api/webhooks/github`
- Content type: `application/json`
- Secret: same value as `AGENTGITOPS_GITHUB_WEBHOOK_SECRET`
- Events: pull requests, pull request reviews, check runs, check suites, pushes

Local development needs a public HTTPS tunnel or deployed server because GitHub cannot call `localhost`.

## Signature Validation

AgentGitOps validates:

```text
X-Hub-Signature-256: sha256=<hmac>
```

Use HMAC-SHA256 over the raw request body. Reject missing secret or invalid signature. Do not parse body before signature validation when implementing lower-level handlers.

## SSE Behavior

Expected MVP behavior:

- `GET /api/events/stream` returns `text/event-stream`
- Every broadcast event includes an SSE `id` and the server keeps a small in-memory replay buffer for reconnects using `Last-Event-ID`
- Send `connected` immediately
- Send initial `dashboard.snapshot`
- Broadcast `task.updated`, `review.submitted`, `agent.note.added`, `conflict.updated`, `data.changed`, and fresh `dashboard.snapshot` after server-originated changes
- Send heartbeat periodically
- Poll `.agentgitops` state while clients are connected and broadcast `data.changed` when external CLI/process writes are detected
- Web pages should use the shared event-stream hook so reconnection status and refresh behavior stay consistent across Logs, Audit, AgentOps, Merge Queue, and Conflict Center

Known limitation:

- The current external-change detector is polling-based, not a durable event log. It refreshes Web data reliably for local development, but event ordering/replay still requires an event store.

## Smoke Checks

```bash
curl -sS http://127.0.0.1:<port>/api/health
curl -sS http://127.0.0.1:<port>/api/events/stream --max-time 2
```

In missing-config repos, SSE may send `connected` followed by an error event. That still proves the stream is alive.
