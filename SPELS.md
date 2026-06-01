# SPELS.md

## Web Terminal Tool Specification

This document describes the first implementation target for a web-based
terminal tool. Version 0 should expose a real PowerShell session through a
browser UI. From that shell, users can run normal commands, `.bat` scripts,
shortcuts, and terminal agents such as Claude Code and Codex.

> Note: the file is named `SPELS.md` to match the current project request. If
> the project later standardizes on `SPECS.md`, this content can be moved
> without changing the product direction.

## Product Summary

The app lets a user open a browser and interact with a WebSocket-powered shell
session. On Windows, the first target shell is PowerShell.

The safety and intended-use boundary is defined in
`RFC-0001-local-web-shell.md`: this is a local developer terminal, not a remote
administration tool, exploitation framework, or public command execution
service.

Primary use cases:

- Change directories with normal shell commands such as `cd`.
- Set and read environment variables with normal PowerShell syntax.
- Read system environment variables through the shell environment.
- Run PATH commands, shortcuts, `.ps1`, `.cmd`, and `.bat` scripts.
- Start `claude` or `codex` from the browser terminal.
- Run shell sessions inside a configured workspace directory.
- Stop or clean up sessions from the browser.

Non-goals for the first version:

- Public multi-tenant hosting.
- Server-side arbitrary command execution APIs outside the active shell.
- Shared collaborative terminals.
- Persistent terminal replay.
- Browser-based file explorer or IDE features.

## Functional Requirements

### Shell Session

- The backend starts a configured shell process for each session.
- On Windows, default to `powershell.exe -NoLogo` or `pwsh -NoLogo` when
  configured.
- The frontend starts a terminal session, not a raw arbitrary command.
- The shell process owns command parsing, directory changes, environment
  mutation, script execution, aliases, and PATH lookup.
- Commands typed by the user are sent as terminal input.
- The server must not attempt to parse normal shell commands.

### Shortcut Selection

- The backend provides a list of configured shortcuts.
- Each shortcut has a stable id, display name, and input string.
- Shortcuts send predefined input to the current shell session.
- Initial shortcuts:
  - `claude`, sending `claude\r`
  - `codex`, sending `codex\r`

### Terminal Session

- A user can create a new session from the browser.
- A session starts one PTY-backed shell process.
- Terminal input from the browser is forwarded to the PTY.
- PTY output is streamed back to the browser.
- Browser resize events update the PTY size.
- A session reports exit code or signal when the process ends.
- A user can stop a running session.
- Disconnected sessions are cleaned up according to a configured policy.

### WebSocket Protocol

Use JSON messages for control and terminal traffic in the first version.

Client messages:

```json
{ "type": "session.start", "cols": 120, "rows": 32 }
```

```json
{ "type": "terminal.input", "sessionId": "s_123", "data": "npm test\r" }
```

```json
{ "type": "terminal.resize", "sessionId": "s_123", "cols": 100, "rows": 28 }
```

```json
{ "type": "shortcut.run", "sessionId": "s_123", "shortcutId": "codex" }
```

```json
{ "type": "session.stop", "sessionId": "s_123" }
```

Server messages:

```json
{ "type": "session.started", "sessionId": "s_123", "shell": "powershell" }
```

```json
{ "type": "terminal.output", "sessionId": "s_123", "data": "hello\r\n" }
```

```json
{ "type": "session.exited", "sessionId": "s_123", "exitCode": 0, "signal": null }
```

```json
{ "type": "error", "code": "SHORTCUT_NOT_FOUND", "message": "Shortcut is not configured." }
```

### Frontend Requirements

- Use a terminal emulator that supports ANSI escape sequences.
- The terminal should support copy, paste, focus, and resize.
- Connection status should be visible.
- Session exit status should be visible.
- Optional shortcut buttons can send common inputs such as `claude`, `codex`,
  or project-local scripts to the active shell.
- The UI should avoid marketing or landing-page patterns; the first screen is
  the working terminal interface.

### Backend Requirements

- Bind to `127.0.0.1` by default for local development.
- Spawn the configured shell process without shell interpolation.
- Keep an in-memory session registry for the first version.
- Kill child processes on server shutdown.
- Validate message schemas before acting on them.
- Reject unknown message types.
- Reject unknown shortcut ids.
- Sanitize logs so raw terminal contents are not logged by default.

## Configuration

Suggested initial config:

```json
{
  "server": {
    "host": "127.0.0.1",
    "port": 5959
  },
  "workspace": {
    "root": "."
  },
  "directories": [
    {
      "id": "workspace",
      "name": "Workspace",
      "path": "."
    },
    {
      "id": "examples",
      "name": "Examples",
      "path": "./examples"
    }
  ],
  "shell": {
    "id": "auto",
    "name": "Default Shell",
    "command": "auto",
    "args": []
  },
  "sessions": {
    "disconnectGraceMs": 2000,
    "maxSessions": 12
  },
  "shortcuts": [
    {
      "id": "claude",
      "name": "Claude Code",
      "input": "claude\r"
    },
    {
      "id": "codex",
      "name": "Codex",
      "input": "codex\r"
    }
  ]
}
```

## Error Codes

- `BAD_MESSAGE`: message is not valid JSON or fails schema validation.
- `UNKNOWN_MESSAGE_TYPE`: message type is not supported.
- `SHORTCUT_NOT_FOUND`: requested shortcut id is not configured.
- `SESSION_NOT_FOUND`: session id does not exist or is no longer active.
- `SESSION_LIMIT_REACHED`: server refused to create another session.
- `PROCESS_START_FAILED`: backend could not spawn the configured shell.
- `PTY_ERROR`: PTY read, write, resize, or shutdown failed.

## Implementation Milestones

1. Create project skeleton.
2. Implement WebSocket server.
3. Implement PTY-backed PowerShell session manager.
4. Add configurable shell and shortcut registry.
5. Build terminal UI.
6. Wire resize, stop, shortcut, and process exit events.
7. Verify `cd`, environment variables, PATH commands, and `.bat` scripts.
8. Add local-only security defaults.
9. Add tests for session start, input relay, resize, stop, shortcuts, and
   unknown messages.

## Acceptance Criteria For Version 0

- Running the server opens a local web PowerShell terminal.
- `cd` changes the working directory inside the shell session.
- `$env:NAME = "value"` sets a session environment variable.
- `$env:Path` and other environment variables can be read.
- `.bat` scripts can be launched from the browser terminal.
- The browser can start `codex` if it is installed on the host.
- The browser can start `claude` if it is installed on the host.
- User input reaches the shell process.
- Agent output appears in the browser terminal.
- Closing the browser eventually cleans up the process.
- The backend does not expose a separate arbitrary command execution API.
