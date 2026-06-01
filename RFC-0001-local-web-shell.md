# RFC-0001: Local Web Shell For Terminal Agents

## Status

Draft

## Summary

This project is a local developer tool that exposes an interactive shell in a
browser for the current machine owner. Its first implementation target is a
PowerShell-backed WebSocket terminal used to start and operate local terminal
agents such as Claude Code and Codex.

The project is not a remote administration tool, exploitation framework,
command-and-control system, persistence mechanism, credential collector, or
public shell service.

## Motivation

Many coding agents are terminal-first tools. A browser terminal gives the user a
convenient way to run those local tools from a single web UI while preserving
normal shell behavior:

- Change directories with `cd`.
- Set and read environment variables through PowerShell.
- Run `.ps1`, `.cmd`, and `.bat` scripts.
- Launch installed terminal agents such as `claude` and `codex`.
- Keep the terminal experience accessible through a browser UI.

The intent is developer ergonomics on the user's own machine, not access to
systems the user does not own or administer.

## Scope

Version 0 implements:

- A local HTTP/WebSocket server bound to `127.0.0.1` by default.
- A browser terminal UI using `xterm.js`.
- A PTY-backed PowerShell session.
- Terminal input and output relay over WebSocket.
- Terminal resize handling.
- Configured shortcut buttons that send predefined input to the active shell.
- Process cleanup on disconnect and server shutdown.

## Non-Goals

This project must not implement:

- Public unauthenticated shell access.
- Stealth, evasion, persistence, or hidden execution.
- Credential harvesting or token extraction.
- Lateral movement, scanning, exploitation, or post-exploitation workflows.
- Remote command execution APIs outside the active user-owned shell session.
- Multi-tenant hosting without authentication, authorization, auditing, and
  strict workspace isolation.
- Features intended to bypass operating system, browser, network, or platform
  security controls.

## Security Model

The default trust boundary is local-only:

```text
Same machine user -> browser -> 127.0.0.1 WebSocket server -> local PowerShell
```

The server should assume that shell access is powerful and sensitive. Even in a
local-only prototype, the implementation should keep the following boundaries:

- Bind to `127.0.0.1` by default.
- Reject non-local WebSocket origins.
- Spawn only the configured shell process server-side.
- Do not expose a generic HTTP command execution endpoint.
- Do not shell-interpolate server-side command strings.
- Treat user terminal input as interactive shell input, not as trusted server
  instructions.
- Avoid logging raw terminal contents by default.
- Clean up child processes on disconnect, timeout, and shutdown.

## Remote Access Requirements

Remote access is explicitly out of scope for v0. Before any non-local bind or
network exposure is allowed, the project must add:

- Authentication.
- Per-user authorization.
- Workspace isolation.
- WebSocket origin allowlisting.
- CSRF-safe HTTP endpoints.
- Session limits and rate limits.
- Audit logs for session lifecycle events.
- Clear administrator-controlled configuration.

## Abuse-Resistance Notes

This RFC exists to document intended use and implementation boundaries. The
project should avoid ambiguous language such as "remote control", "payload",
"implant", or "command-and-control" because those are not the product goals.

Preferred project wording:

- Local Web Shell
- Browser terminal
- PowerShell-backed session
- Developer terminal agent launcher
- Local-only WebSocket PTY bridge

Avoided project wording:

- Remote shell
- RAT
- C2
- Payload runner
- Undetected command execution
- Unauthorized access

## Acceptance Criteria

The v0 implementation satisfies this RFC when:

- The server listens on `127.0.0.1` by default.
- The browser can open a PowerShell-backed terminal.
- The user can run normal local shell commands.
- `claude` and `codex` can be launched if installed on the host.
- There is no separate arbitrary command execution HTTP API.
- Child processes are cleaned up when sessions end.
- Documentation states that remote exposure requires authentication and
  authorization first.

