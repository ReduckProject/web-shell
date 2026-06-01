import { randomUUID } from "node:crypto";
import type { IPty } from "node-pty";
import * as pty from "node-pty";
import type { WebSocket } from "ws";
import type { WebShellConfig } from "./config.js";
import type { ServerMessage } from "./protocol.js";

type Session = {
  id: string;
  pty: IPty;
  socket: WebSocket;
  cwd: string;
  cleanupTimer?: NodeJS.Timeout;
};

export class SessionManager {
  private readonly sessions = new Map<string, Session>();

  constructor(private config: WebShellConfig) {}

  get activeCount(): number {
    return this.sessions.size;
  }

  updateConfig(config: WebShellConfig): void {
    this.config = config;
  }

  start(socket: WebSocket, cols = 120, rows = 32, clientTabId?: string, directoryId?: string): Session {
    if (this.sessions.size >= this.config.sessions.maxSessions) {
      throw new SessionError("SESSION_LIMIT_REACHED", "Maximum session count reached.");
    }

    const cwd = this.resolveSessionCwd(directoryId);
    const id = `s_${randomUUID()}`;
    const shell = pty.spawn(this.config.shell.command, this.config.shell.args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env: process.env
    });

    const session: Session = { id, pty: shell, socket, cwd };
    this.sessions.set(id, session);

    shell.onData((data) => {
      this.send(socket, { type: "terminal.output", sessionId: id, data });
    });

    shell.onExit(({ exitCode, signal }) => {
      this.sessions.delete(id);
      this.send(socket, { type: "session.exited", sessionId: id, exitCode, signal });
    });

    this.send(socket, {
      type: "session.started",
      sessionId: id,
      shell: this.config.shell.id,
      cwd,
      clientTabId
    });

    return session;
  }

  write(sessionId: string, data: string): void {
    this.requireSession(sessionId).pty.write(data);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.requireSession(sessionId).pty.resize(cols, rows);
  }

  stop(sessionId: string): void {
    const session = this.requireSession(sessionId);
    session.pty.kill();
    this.sessions.delete(sessionId);
  }

  runShortcut(sessionId: string, shortcutId: string): void {
    const shortcut = this.config.shortcuts.find((item) => item.id === shortcutId);
    if (!shortcut) {
      throw new SessionError("SHORTCUT_NOT_FOUND", `Shortcut is not configured: ${shortcutId}`, sessionId);
    }

    this.write(sessionId, shortcut.input);
  }

  changeDirectory(sessionId: string, directoryId: string): void {
    const directory = this.config.directories.find((item) => item.id === directoryId);
    if (!directory) {
      throw new SessionError("DIRECTORY_NOT_FOUND", `Directory is not configured: ${directoryId}`, sessionId);
    }

    this.write(sessionId, `${this.cdCommand(directory.path)}\r`);
    this.requireSession(sessionId).cwd = directory.path;
  }

  currentDirectory(sessionId: string): string {
    return this.requireSession(sessionId).cwd;
  }

  markDisconnected(socket: WebSocket): void {
    for (const session of this.sessions.values()) {
      if (session.socket !== socket) {
        continue;
      }

      session.cleanupTimer = setTimeout(() => {
        if (this.sessions.has(session.id)) {
          session.pty.kill();
          this.sessions.delete(session.id);
        }
      }, this.config.sessions.disconnectGraceMs);
    }
  }

  shutdown(): void {
    for (const session of this.sessions.values()) {
      if (session.cleanupTimer) {
        clearTimeout(session.cleanupTimer);
      }
      session.pty.kill();
    }
    this.sessions.clear();
  }

  private requireSession(sessionId: string): Session {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new SessionError("SESSION_NOT_FOUND", "Session is not active.", sessionId);
    }

    return session;
  }

  private resolveSessionCwd(directoryId?: string): string {
    if (!directoryId) {
      return this.config.workspace.root;
    }

    const directory = this.config.directories.find((item) => item.id === directoryId);
    if (!directory) {
      throw new SessionError("DIRECTORY_NOT_FOUND", `Directory is not configured: ${directoryId}`);
    }

    return directory.path;
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  private cdCommand(directoryPath: string): string {
    if (this.config.shell.id === "powershell" || this.config.shell.command.toLowerCase().includes("pwsh")) {
      return `Set-Location -LiteralPath ${quotePowerShell(directoryPath)}`;
    }

    if (this.config.shell.id === "cmd" || this.config.shell.command.toLowerCase().endsWith("cmd.exe")) {
      return `cd /d ${quoteCmd(directoryPath)}`;
    }

    return `cd ${quotePosixShell(directoryPath)}`;
  }
}

export class SessionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly sessionId?: string
  ) {
    super(message);
  }
}

function quotePowerShell(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function quoteCmd(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function quotePosixShell(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}
