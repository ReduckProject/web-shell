import http from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import {
  addDirectoryFavorite,
  ConfigError,
  loadConfig,
  removeDirectoryFavorite,
  type WebShellConfig
} from "./config.js";
import { parseClientMessage, ProtocolError, type ServerMessage } from "./protocol.js";
import { SessionError, SessionManager } from "./session-manager.js";

let config = loadConfig();
const sessions = new SessionManager(config);

const server = http.createServer((request, response) => {
  setCorsHeaders(response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === "GET" && request.url === "/api/config") {
    writeJson(response, 200, publicConfig(config));
    return;
  }

  if (request.method === "POST" && request.url === "/api/directories") {
    readJsonBody(request)
      .then((body) => {
        if (!isRecord(body) || typeof body.name !== "string" || typeof body.path !== "string") {
          writeJson(response, 400, { code: "BAD_DIRECTORY", message: "name and path are required." });
          return;
        }

        config = addDirectoryFavorite({
          id: typeof body.id === "string" ? body.id : undefined,
          name: body.name,
          path: body.path
        });
        sessions.updateConfig(config);
        writeJson(response, 201, publicConfig(config));
      })
      .catch((error) => {
        if (error instanceof ConfigError) {
          writeJson(response, 400, { code: error.code, message: error.message });
          return;
        }

        console.error(error);
        writeJson(response, 500, { code: "CONFIG_WRITE_FAILED", message: "Failed to save directory." });
      });
    return;
  }

  if (request.method === "POST" && request.url === "/api/directories/current") {
    readJsonBody(request)
      .then((body) => {
        if (!isRecord(body) || typeof body.name !== "string" || typeof body.sessionId !== "string") {
          writeJson(response, 400, { code: "BAD_DIRECTORY", message: "name and sessionId are required." });
          return;
        }

        config = addDirectoryFavorite({
          name: body.name,
          path: sessions.currentDirectory(body.sessionId)
        });
        sessions.updateConfig(config);
        writeJson(response, 201, publicConfig(config));
      })
      .catch((error) => {
        if (error instanceof ConfigError || error instanceof Error) {
          writeJson(response, 400, {
            code: error instanceof ConfigError ? error.code : "DIRECTORY_SAVE_FAILED",
            message: error.message
          });
          return;
        }

        writeJson(response, 500, { code: "CONFIG_WRITE_FAILED", message: "Failed to save current directory." });
      });
    return;
  }

  if (request.method === "DELETE" && request.url?.startsWith("/api/directories/")) {
    const directoryId = decodeURIComponent(request.url.slice("/api/directories/".length));
    try {
      config = removeDirectoryFavorite(directoryId);
      sessions.updateConfig(config);
      writeJson(response, 200, publicConfig(config));
    } catch (error) {
      if (error instanceof ConfigError) {
        writeJson(response, 404, { code: error.code, message: error.message });
        return;
      }

      console.error(error);
      writeJson(response, 500, { code: "CONFIG_WRITE_FAILED", message: "Failed to delete directory." });
    }
    return;
  }

  writeJson(response, 404, { error: "Not found" });
});

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (socket, request) => {
  const origin = request.headers.origin ?? "";
  if (origin && !isAllowedOrigin(origin)) {
    send(socket, { type: "error", code: "ORIGIN_NOT_ALLOWED", message: "WebSocket origin is not allowed." });
    socket.close(1008, "Origin not allowed");
    return;
  }

  socket.on("message", (raw) => {
    try {
      const message = parseClientMessage(raw.toString());
      switch (message.type) {
        case "session.start":
          sessions.start(socket, message.cols, message.rows, message.clientTabId, message.directoryId);
          break;
        case "terminal.input":
          sessions.write(message.sessionId, message.data);
          break;
        case "terminal.resize":
          sessions.resize(message.sessionId, message.cols, message.rows);
          break;
        case "directory.change":
          sessions.changeDirectory(message.sessionId, message.directoryId);
          break;
        case "shortcut.run":
          sessions.runShortcut(message.sessionId, message.shortcutId);
          break;
        case "session.stop":
          sessions.stop(message.sessionId);
          break;
        case "ping":
          send(socket, { type: "pong" });
          break;
      }
    } catch (error) {
      handleSocketError(socket, error);
    }
  });

  socket.on("close", () => {
    sessions.markDisconnected(socket);
  });
});

server.listen(config.server.port, config.server.host, () => {
  console.log(`web-shell server listening on http://${config.server.host}:${config.server.port}`);
  console.log(`workspace: ${config.workspace.root}`);
  console.log(`shell: ${config.shell.command} ${config.shell.args.join(" ")}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    sessions.shutdown();
    server.close(() => process.exit(0));
  });
}

function handleSocketError(socket: WebSocket, error: unknown): void {
  if (error instanceof ProtocolError || error instanceof SessionError) {
    send(socket, {
      type: "error",
      code: error.code,
      message: error.message,
      sessionId: error.sessionId
    });
    return;
  }

  console.error(error);
  send(socket, { type: "error", code: "INTERNAL_ERROR", message: "Unexpected server error." });
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function writeJson(response: http.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function publicConfig(currentConfig: WebShellConfig): unknown {
  return {
    shell: {
      id: currentConfig.shell.id,
      name: currentConfig.shell.name
    },
    workspace: {
      root: currentConfig.workspace.root
    },
    directories: currentConfig.directories.map(({ id, name, path }) => ({ id, name, path })),
    sessions: {
      maxSessions: currentConfig.sessions.maxSessions,
      activeSessions: sessions.activeCount
    },
    shortcuts: currentConfig.shortcuts.map(({ id, name }) => ({ id, name }))
  };
}

async function readJsonBody(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function setCorsHeaders(response: http.ServerResponse): void {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
}

function isAllowedOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return ["127.0.0.1", "localhost"].includes(url.hostname);
  } catch {
    return false;
  }
}
