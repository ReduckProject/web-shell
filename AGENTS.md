# AGENTS.md

## Project Goal

This repository implements a web terminal tool for opening a real shell session
from a browser. The first version should behave like a browser-accessible
PowerShell terminal, so users can change directories, set and read environment
variables, run `.bat` scripts, use shortcuts, and launch terminal-based coding
agents such as Claude Code, Codex, and similar CLI assistants.

The core communication path is:

```text
Browser terminal UI <-> WebSocket server <-> PTY process <-> PowerShell <-> agent CLI or scripts
```

The application should feel like a real terminal first. Agent launch is an
important workflow, but the v0 foundation is a WebSocket-controlled shell with
guardrails for session management, process lifecycle, logs, permissions, and
future multi-user access.

For safety intent and project boundaries, read
`RFC-0001-local-web-shell.md` before making architectural changes. This project
is a local developer tool, not a remote administration tool or public shell
service.

## Working Rules For Coding Agents

- Prefer small, focused changes that keep the system easy to inspect.
- Read existing code before changing behavior. If the project is still empty,
  establish simple conventions and document them.
- Keep security decisions explicit. Web terminal access can execute local
  commands, so authentication, authorization, command policy, and auditability
  matter.
- Do not hard-code secrets, API keys, tokens, local user paths, or private
  machine-specific configuration.
- Keep terminal process handling isolated from web request handling.
- Treat each terminal session as a resource with a clear owner, lifecycle, and
  cleanup path.
- Use structured messages over WebSocket instead of ambiguous plain strings for
  control events.
- Preserve raw terminal byte streams where needed so full-screen terminal apps
  work correctly.
- For v0, launch a configured shell process such as `pwsh` or `powershell.exe`
  and let normal shell behavior handle `cd`, environment variables, `.bat`
  execution, aliases, PATH lookup, and agent commands.
- Add tests around protocol behavior, session lifecycle, and process cleanup as
  the implementation grows.

## Suggested Architecture

### Frontend

The frontend owns the browser terminal experience:

- Render a terminal emulator, preferably using `xterm.js`.
- Open a WebSocket connection for each terminal session.
- Send user input, resize events, and control actions to the server.
- Render terminal output exactly as received.
- Show connection state, process state, and recoverable errors.
- Provide optional shortcut buttons for common inputs such as `claude`,
  `codex`, or project-local scripts.

### Backend

The backend owns session and process control:

- Expose a WebSocket endpoint for terminal sessions.
- Allocate a PTY process for each launched shell session.
- Spawn a configured shell, initially PowerShell on Windows.
- Relay terminal input/output between WebSocket and PTY.
- Handle terminal resize events.
- Enforce session timeouts and cleanup terminated processes.
- Record structured audit logs without leaking sensitive terminal contents by
  default.

### Shell First, Agents Second

The first version should launch PowerShell as the session process. Users can
then run normal commands in the browser exactly as they would locally:

```powershell
cd E:\Code\GitHub\web-shell
$env:MY_FLAG = "1"
$env:Path
.\scripts\setup.bat
claude
codex
```

This keeps shell semantics inside the shell instead of reimplementing them in
the web server.

### Shortcut And Agent Registry

Shortcuts and agent launch helpers should come from configuration instead of
hard-coded frontend behavior. A safe initial shape:

```json
{
  "shell": {
    "command": "powershell.exe",
    "args": ["-NoLogo"]
  },
  "shortcuts": {
    "claude": {
      "input": "claude\r"
    },
    "codex": {
      "input": "codex\r"
    }
  }
}
```

The UI should ask the backend for available shortcuts instead of duplicating
this list. Shortcuts send text to the active shell session; they do not bypass
the shell.

## WebSocket Message Direction

Client to server:

- `session.start`: request a new terminal session for the configured shell.
- `terminal.input`: send user keystrokes or pasted input.
- `terminal.resize`: send terminal columns and rows.
- `shortcut.run`: send a configured shortcut to the active shell.
- `session.stop`: request graceful process termination.
- `ping`: connection heartbeat.

Server to client:

- `session.started`: session id, shell metadata, and initial terminal metadata.
- `terminal.output`: PTY output data.
- `session.exited`: exit code, signal, and end reason.
- `error`: recoverable or fatal protocol error.
- `pong`: heartbeat response.

Binary payloads may be introduced later if raw terminal throughput becomes a
problem. Start with JSON messages and base64 output only if the terminal library
or transport needs it.

## Security Baseline

Before exposing this outside localhost, implement:

- Authentication.
- Authorization per workspace and per shell session.
- CSRF-safe session creation if HTTP endpoints are added.
- WebSocket origin checks.
- Rate limits for session creation and input volume.
- Configured allowlist for server-side launchable shells.
- No shell interpolation when spawning the initial shell process.
- Treat commands typed inside the shell as user terminal input, not as trusted
  server instructions.
- Clear process cleanup on disconnect, timeout, and server shutdown.

For the first local prototype, bind to localhost by default.

## Development Priorities

1. Build a minimal local WebSocket-to-PowerShell PTY relay.
2. Add a browser terminal UI using `xterm.js`.
3. Support normal shell behavior: `cd`, environment variables, `.bat` scripts,
   aliases, and PATH-based commands.
4. Add session lifecycle controls: start, resize, stop, reconnect policy.
5. Add shortcut buttons for common commands such as `claude` and `codex`.
6. Add basic auth or local-only enforcement before remote access.
7. Add tests for protocol handling and process cleanup.

## Naming Conventions

- Use `session` for a browser-connected terminal instance.
- Use `shell` for the configured process backing the terminal session.
- Use `shortcut` for UI actions that send predefined input to the shell.
- Use `agent` for a CLI assistant launched from inside the shell.
- Use `pty` only for the server-side pseudo-terminal implementation.
- Use `workspace` for the filesystem root where shell sessions start.
