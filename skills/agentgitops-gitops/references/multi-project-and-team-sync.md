# Multi-Project And Team Sync

## Multi-Project Management

AgentGitOps supports managing multiple Git repositories from a single installation.

### Register Projects

```bash
# Register current directory
agentgitops init

# Register external project
agentgitops project add /path/to/project-a
agentgitops project add /path/to/project-b
```

### List And Switch

```bash
# List all projects
agentgitops project list

# Switch active project
agentgitops project switch <project-id>
```

Output example:

```text
ID             NAME           PATH                                    PORT   STATUS
proj_9e54176e  agentgitops    d:\...\agentgitops                      4789   active
proj_1b85e21d  YTSkill *      D:\...\YTSkill                          4790   active
```

`*` marks the last active project.

### WebUI Per Project

Each project runs on its own port:

```bash
# Start WebUI for default project
agentgitops web

# Start WebUI for specific project
agentgitops web --project <project-id>
```

The ProjectSelector page (default port 4789) lists all projects with "Open" buttons linking to each project's port.

### Remove Project

```bash
agentgitops project remove <project-id>
```

## Team Sync (Cross-Machine Collaboration)

Team Sync enables multiple Local Hubs to collaborate via a Relay service. Code goes through Git; signals go through the sync layer.

### Initialize Team Sync

On Machine A:

```bash
agentgitops team init \
  --team-id my-team \
  --relay-url https://relay.example.com
```

This generates a `team_secret` for HMAC authentication. Share it with other machines securely.

### Join Team Sync

On Machine B:

```bash
agentgitops team join \
  --team-id my-team \
  --relay-url https://relay.example.com \
  --team-secret <secret-from-machine-a>
```

### Sync Operations

```bash
# Check sync status
agentgitops sync status

# Push local events to Relay
agentgitops sync push

# Pull events from Relay
agentgitops sync pull

# Watch sync state (polling)
agentgitops sync watch
```

### Auto Sync

Configure auto-sync in `.agentgitops.yml`:

```yaml
team:
  sync:
    mode: auto
    intervalSeconds: 60
```

Auto-sync runs as a background WorkflowJob: pull on interval, push when pending events exist.

### Context Feed

Generate context for the next agent (previous agent's execution summary, avoid-repeating items, conflict signals):

```bash
agentgitops context feed --task <task-id>
```

### Handoff Package

Generate a handoff package for cross-machine task continuation:

```bash
# Preview handoff package
agentgitops handoff preview <task-id>

# Generate handoff package
agentgitops handoff generate <task-id>

# List handoff documents
agentgitops handoff doc list

# Show handoff document for a task
agentgitops handoff doc <task-id>
```

### Adopt And Continue

Adopt a Team Sync task branch from another machine:

```bash
# Adopt an existing task branch
agentgitops task adopt <branch-or-task>

# Continue a task on a new local branch
agentgitops task continue <task-id>
```

### Conflict Graph

View cross-machine conflict graph:

```bash
agentgitops team conflicts
```

### Sync Content Scope

Configure what data is synced:

```yaml
team:
  sync:
    tasks: true
    changedFiles: true
    riskLevel: true
    verification: true
    conflicts: true
    agentExecution: false    # may contain sensitive info
    failureReason: false
    filesRead: false
    tokenUsage: false
    agentNotes: false
    reviewContext: false
    handoff: false
    mode: manual
    intervalSeconds: 60
```

### Relay Deployment

Relay can run independently:

```bash
# Start server in relay mode (only sync/team routes)
agentgitops server start --mode relay
```

Or via environment variable:

```bash
AGENTGITOPS_MODE=relay agentgitops server start
```

### Team Sync Authentication

Team Sync uses HMAC signature authentication:

- Requests without signature → 401 Unauthorized
- Requests with wrong signature → 403 Forbidden
- `team_secret` is used for HMAC-SHA256 signing

### Web Team Sync Pages

- **TeamBoard**: Team overview (members, cached tasks, conflicts, pending events)
- **TeamSyncSettings**: Sync status, last sync result, "Sync Now" button
- **ContextFeedPreview**: Preview context feed for agents
- **ConflictGraphPage**: Interactive conflict graph
- **SharedMergeQueue**: Cross-machine shared merge queue
