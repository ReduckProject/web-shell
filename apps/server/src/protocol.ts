export type ClientMessage =
  | { type: "session.start"; cols?: number; rows?: number; clientTabId?: string; directoryId?: string }
  | { type: "terminal.input"; sessionId: string; data: string }
  | { type: "terminal.resize"; sessionId: string; cols: number; rows: number }
  | { type: "directory.change"; sessionId: string; directoryId: string }
  | { type: "shortcut.run"; sessionId: string; shortcutId: string }
  | { type: "session.stop"; sessionId: string }
  | { type: "ping" };

export type ServerMessage =
  | { type: "session.started"; sessionId: string; shell: string; cwd: string; clientTabId?: string }
  | { type: "session.cwd"; sessionId: string; cwd: string }
  | { type: "terminal.output"; sessionId: string; data: string }
  | { type: "session.exited"; sessionId: string; exitCode: number; signal?: number }
  | { type: "error"; code: string; message: string; sessionId?: string }
  | { type: "pong" };

export function parseClientMessage(value: unknown): ClientMessage {
  if (typeof value !== "string") {
    throw new ProtocolError("BAD_MESSAGE", "Expected a text WebSocket message.");
  }

  let message: unknown;
  try {
    message = JSON.parse(value);
  } catch {
    throw new ProtocolError("BAD_MESSAGE", "Message is not valid JSON.");
  }

  if (!isRecord(message) || typeof message.type !== "string") {
    throw new ProtocolError("BAD_MESSAGE", "Message must include a type.");
  }

  switch (message.type) {
    case "session.start":
      return {
        type: "session.start",
        cols: optionalPositiveInteger(message.cols),
        rows: optionalPositiveInteger(message.rows),
        clientTabId: optionalString(message.clientTabId, "clientTabId"),
        directoryId: optionalString(message.directoryId, "directoryId")
      };
    case "terminal.input":
      return {
        type: "terminal.input",
        sessionId: requireString(message.sessionId, "sessionId"),
        data: requireString(message.data, "data")
      };
    case "terminal.resize":
      return {
        type: "terminal.resize",
        sessionId: requireString(message.sessionId, "sessionId"),
        cols: requirePositiveInteger(message.cols, "cols"),
        rows: requirePositiveInteger(message.rows, "rows")
      };
    case "directory.change":
      return {
        type: "directory.change",
        sessionId: requireString(message.sessionId, "sessionId"),
        directoryId: requireString(message.directoryId, "directoryId")
      };
    case "shortcut.run":
      return {
        type: "shortcut.run",
        sessionId: requireString(message.sessionId, "sessionId"),
        shortcutId: requireString(message.shortcutId, "shortcutId")
      };
    case "session.stop":
      return {
        type: "session.stop",
        sessionId: requireString(message.sessionId, "sessionId")
      };
    case "ping":
      return { type: "ping" };
    default:
      throw new ProtocolError("UNKNOWN_MESSAGE_TYPE", `Unsupported message type: ${message.type}`);
  }
}

export class ProtocolError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly sessionId?: string
  ) {
    super(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new ProtocolError("BAD_MESSAGE", `${field} must be a string.`);
  }

  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new ProtocolError("BAD_MESSAGE", `${field} must be a string.`);
  }

  return value;
}

function requirePositiveInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || typeof value !== "number" || value <= 0) {
    throw new ProtocolError("BAD_MESSAGE", `${field} must be a positive integer.`);
  }

  return value;
}

function optionalPositiveInteger(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isInteger(value) || typeof value !== "number" || value <= 0) {
    throw new ProtocolError("BAD_MESSAGE", "Optional terminal dimensions must be positive integers.");
  }

  return value;
}
