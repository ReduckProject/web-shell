import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import {
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Plus,
  Power,
  RotateCw,
  Square,
  TerminalSquare,
  X
} from "lucide-react";

type AppConfig = {
  shell: {
    id: string;
    name: string;
  };
  workspace: {
    root: string;
  };
  directories: Array<{
    id: string;
    name: string;
    path: string;
  }>;
  sessions: {
    maxSessions: number;
    activeSessions: number;
  };
  shortcuts: Array<{
    id: string;
    name: string;
  }>;
};

type ShellTab = {
  id: string;
  sessionId?: string;
  title: string;
  status: "starting" | "running" | "exited" | "error";
  cwd?: string;
  directoryId?: string;
};

type TerminalHandle = {
  terminal: Terminal;
  fitAddon: FitAddon;
  resizeObserver?: ResizeObserver;
};

type ServerMessage =
  | { type: "session.started"; sessionId: string; shell: string; cwd: string; clientTabId?: string }
  | { type: "terminal.output"; sessionId: string; data: string }
  | { type: "session.exited"; sessionId: string; exitCode: number; signal?: number }
  | { type: "error"; code: string; message: string; sessionId?: string }
  | { type: "pong" };

type ConnectionState = "connecting" | "connected" | "disconnected" | "error";

const serverPort = window.location.port === "5173" ? "5959" : window.location.port;
const apiBase = `${window.location.protocol}//${window.location.hostname}:${serverPort}`;
const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const wsUrl = `${wsProtocol}//${window.location.hostname}:${serverPort}/ws`;

export function App() {
  const socket = useRef<WebSocket | null>(null);
  const terminals = useRef(new Map<string, TerminalHandle>());
  const pendingSessionStarts = useRef(new Set<string>());
  const pendingReconnects = useRef(new Set<string>());
  const tabsRef = useRef<ShellTab[]>([]);
  const configRef = useRef<AppConfig | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [tabs, setTabs] = useState<ShellTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [selectedDirectoryId, setSelectedDirectoryId] = useState<string | null>(null);
  const [isAddingDirectory, setIsAddingDirectory] = useState(false);
  const [newDirectoryName, setNewDirectoryName] = useState("");
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [activeSessions, setActiveSessions] = useState(0);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [statusText, setStatusText] = useState("Starting");

  tabsRef.current = tabs;
  configRef.current = config;

  const send = useCallback((message: unknown) => {
    if (socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify(message));
    }
  }, []);

  const loadConfig = useCallback(() => {
    return fetch(`${apiBase}/api/config`)
      .then((response) => response.json() as Promise<AppConfig>)
      .then((nextConfig) => {
        setConfig(nextConfig);
        setActiveSessions(nextConfig.sessions.activeSessions);
        return nextConfig;
      });
  }, []);

  const updateTab = useCallback((tabId: string, patch: Partial<ShellTab>) => {
    setTabs((currentTabs) => currentTabs.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab)));
  }, []);

  const startTabSession = useCallback(
    (tabId: string) => {
      const handle = terminals.current.get(tabId);
      const tab = tabsRef.current.find((item) => item.id === tabId);
      if (!handle || socket.current?.readyState !== WebSocket.OPEN || pendingSessionStarts.current.has(tabId)) {
        return;
      }

      pendingSessionStarts.current.add(tabId);
      send({
        type: "session.start",
        clientTabId: tabId,
        directoryId: tab?.directoryId,
        cols: handle.terminal.cols,
        rows: handle.terminal.rows
      });
    },
    [send]
  );

  const createTab = useCallback((directoryId?: string) => {
    const currentConfig = configRef.current;
    const directory = currentConfig?.directories.find((item) => item.id === directoryId);
    const id = `tab_${crypto.randomUUID()}`;
    const title = directory
      ? `${directory.name} ${tabsRef.current.filter((tab) => tab.directoryId === directory.id).length + 1}`
      : `PowerShell ${tabsRef.current.length + 1}`;
    const nextTab: ShellTab = {
      id,
      title,
      status: "starting",
      cwd: directory?.path,
      directoryId: directoryId ?? currentConfig?.directories[0]?.id
    };

    setTabs((currentTabs) => [...currentTabs, nextTab]);
    setActiveTabId(id);
    window.setTimeout(() => startTabSession(id), 0);
  }, [startTabSession]);

  const writeSystemLine = useCallback((tabId: string, text: string) => {
    terminals.current.get(tabId)?.terminal.writeln(`\x1b[38;5;110m${text}\x1b[0m`);
  }, []);

  const connect = useCallback(() => {
    socket.current?.close();
    pendingSessionStarts.current.clear();
    setConnectionState("connecting");
    setStatusText("Connecting");

    const nextSocket = new WebSocket(wsUrl);
    socket.current = nextSocket;

    nextSocket.addEventListener("open", () => {
      setConnectionState("connected");
      setStatusText("Connected");

      const currentTabs = tabsRef.current;
      if (currentTabs.length === 0) {
        createTab();
        return;
      }

      for (const tab of currentTabs) {
        if (!tab.sessionId || tab.status !== "running") {
          startTabSession(tab.id);
        }
      }
    });

    nextSocket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data) as ServerMessage;

      switch (message.type) {
        case "session.started": {
          const tabId = message.clientTabId ?? tabsRef.current.find((tab) => !tab.sessionId)?.id;
          if (!tabId) {
            return;
          }

          pendingSessionStarts.current.delete(tabId);
          const currentTab = tabsRef.current.find((tab) => tab.id === tabId);
          const resolvedDirectoryId =
            currentTab?.directoryId ??
            configRef.current?.directories.find((directory) => directory.path === message.cwd)?.id;
          updateTab(tabId, {
            sessionId: message.sessionId,
            status: "running",
            cwd: message.cwd,
            directoryId: resolvedDirectoryId
          });
          setActiveSessions((count) => count + 1);
          setStatusText(`${message.shell} - ${message.cwd}`);
          break;
        }
        case "terminal.output": {
          const tab = tabsRef.current.find((item) => item.sessionId === message.sessionId);
          if (tab) {
            terminals.current.get(tab.id)?.terminal.write(message.data);
          }
          break;
        }
        case "session.exited": {
          const tab = tabsRef.current.find((item) => item.sessionId === message.sessionId);
          if (!tab) {
            return;
          }

          updateTab(tab.id, { sessionId: undefined, status: "exited" });
          setActiveSessions((count) => Math.max(0, count - 1));
          setStatusText(`Exited ${message.exitCode}`);
          writeSystemLine(tab.id, `session exited with code ${message.exitCode}`);
          if (pendingReconnects.current.has(tab.id)) {
            pendingReconnects.current.delete(tab.id);
            updateTab(tab.id, { status: "starting" });
            window.setTimeout(() => startTabSession(tab.id), 100);
          }
          break;
        }
        case "error":
          setConnectionState("error");
          setStatusText(message.code);
          if (message.sessionId) {
            const tab = tabsRef.current.find((item) => item.sessionId === message.sessionId);
            if (tab) {
              updateTab(tab.id, { status: "error" });
              terminals.current
                .get(tab.id)
                ?.terminal.writeln(`\x1b[31m${message.code}: ${message.message}\x1b[0m`);
            }
          }
          break;
        case "pong":
          break;
      }
    });

    nextSocket.addEventListener("close", () => {
      setConnectionState("disconnected");
      setStatusText("Disconnected");
      pendingSessionStarts.current.clear();
      pendingReconnects.current.clear();
      setTabs((currentTabs) =>
        currentTabs.map((tab) => (tab.status === "running" ? { ...tab, sessionId: undefined, status: "exited" } : tab))
      );
    });

    nextSocket.addEventListener("error", () => {
      setConnectionState("error");
      setStatusText("Connection error");
    });
  }, [createTab, startTabSession, updateTab, writeSystemLine]);

  useEffect(() => {
    loadConfig()
      .catch(() => {
        setConnectionState("error");
        setStatusText("Config unavailable");
      });
  }, [loadConfig]);

  useEffect(() => {
    connect();

    return () => {
      socket.current?.close();
      pendingReconnects.current.clear();
      for (const handle of terminals.current.values()) {
        handle.resizeObserver?.disconnect();
        handle.terminal.dispose();
      }
      terminals.current.clear();
    };
  }, [connect]);

  useEffect(() => {
    const activeHandle = activeTabId ? terminals.current.get(activeTabId) : undefined;
    if (activeHandle) {
      activeHandle.fitAddon.fit();
      activeHandle.terminal.focus();
    }
  }, [activeTabId, tabs.length]);

  const bindTerminalElement = useCallback(
    (tabId: string, node: HTMLDivElement | null) => {
      if (!node || terminals.current.has(tabId)) {
        return;
      }

      const terminal = new Terminal({
        cursorBlink: true,
        cursorStyle: "bar",
        fontFamily: "Cascadia Mono, Consolas, Menlo, monospace",
        fontSize: 14,
        lineHeight: 1.15,
        scrollback: 5000,
        theme: {
          background: "#101113",
          foreground: "#f1f0ea",
          cursor: "#f5c542",
          selectionBackground: "#395b64",
          black: "#111111",
          red: "#d95f5f",
          green: "#8fbf7f",
          yellow: "#f5c542",
          blue: "#6aa7d8",
          magenta: "#b58bd9",
          cyan: "#74c7c7",
          white: "#f1f0ea",
          brightBlack: "#5b6066",
          brightRed: "#ee7676",
          brightGreen: "#a9d99a",
          brightYellow: "#ffd86b",
          brightBlue: "#8fc4ef",
          brightMagenta: "#d0a6f2",
          brightCyan: "#9ee4e4",
          brightWhite: "#ffffff"
        }
      });
      const fitAddon = new FitAddon();

      terminal.loadAddon(fitAddon);
      terminal.loadAddon(new WebLinksAddon());
      terminal.open(node);
      fitAddon.fit();

      terminal.onData((data) => {
        const tab = tabsRef.current.find((item) => item.id === tabId);
        if (!tab?.sessionId) {
          return;
        }

        send({ type: "terminal.input", sessionId: tab.sessionId, data });
      });

      const resizeObserver = new ResizeObserver(() => {
        fitAddon.fit();
        const tab = tabsRef.current.find((item) => item.id === tabId);
        if (tab?.sessionId) {
          send({
            type: "terminal.resize",
            sessionId: tab.sessionId,
            cols: terminal.cols,
            rows: terminal.rows
          });
        }
      });

      resizeObserver.observe(node);
      terminals.current.set(tabId, { terminal, fitAddon, resizeObserver });
      startTabSession(tabId);
    },
    [send, startTabSession]
  );

  const stopTab = (tabId: string) => {
    const tab = tabs.find((item) => item.id === tabId);
    if (tab?.sessionId) {
      send({ type: "session.stop", sessionId: tab.sessionId });
    }
  };

  const reconnectTab = (tabId: string) => {
    const tab = tabs.find((item) => item.id === tabId);
    if (!tab) {
      return;
    }

    pendingSessionStarts.current.delete(tabId);
    if (tab.sessionId) {
      pendingReconnects.current.add(tabId);
      updateTab(tabId, { status: "starting" });
      send({ type: "session.stop", sessionId: tab.sessionId });
      return;
    }

    updateTab(tabId, { status: "starting" });
    window.setTimeout(() => startTabSession(tabId), 100);
  };

  const changeDirectory = (directoryId: string, tabId = activeTab?.id) => {
    const targetTab = tabs.find((tab) => tab.id === tabId);
    if (!directoryId || !targetTab?.sessionId) {
      return;
    }

    send({ type: "directory.change", sessionId: targetTab.sessionId, directoryId });
    updateTab(targetTab.id, {
      directoryId,
      cwd: config?.directories.find((directory) => directory.id === directoryId)?.path ?? targetTab.cwd
    });
    setActiveTabId(targetTab.id);
    terminals.current.get(targetTab.id)?.terminal.focus();
  };

  const openDirectoryTab = (directoryId: string) => {
    createTab(directoryId);
  };

  const addCurrentDirectory = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setDirectoryError(null);

    if (!activeTab?.sessionId) {
      setDirectoryError("No active terminal session.");
      return;
    }

    try {
      const response = await fetch(`${apiBase}/api/directories/current`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          name: newDirectoryName,
          sessionId: activeTab.sessionId
        })
      });

      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.message ?? "Failed to favorite current path.");
      }

      setConfig(body as AppConfig);
      setNewDirectoryName("");
      setIsAddingDirectory(false);
    } catch (error) {
      setDirectoryError(error instanceof Error ? error.message : "Failed to favorite current path.");
    }
  };

  const openAddDirectoryForm = () => {
    setDirectoryError(null);
    setNewDirectoryName(activeTab?.cwd ?? config?.workspace.root ?? "");
    setIsAddingDirectory(true);
  };

  const deleteDirectory = async (directoryId: string) => {
    setDirectoryError(null);

    try {
      const response = await fetch(`${apiBase}/api/directories/${encodeURIComponent(directoryId)}`, {
        method: "DELETE"
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.message ?? "Failed to delete path.");
      }

      setConfig(body as AppConfig);
      setTabs((currentTabs) =>
        currentTabs.map((tab) => (tab.directoryId === directoryId ? { ...tab, directoryId: undefined } : tab))
      );
    } catch (error) {
      setDirectoryError(error instanceof Error ? error.message : "Failed to delete path.");
    }
  };

  const closeTab = (tabId: string) => {
    const tab = tabs.find((item) => item.id === tabId);
    if (tab?.sessionId) {
      send({ type: "session.stop", sessionId: tab.sessionId });
    }

    const handle = terminals.current.get(tabId);
    handle?.resizeObserver?.disconnect();
    handle?.terminal.dispose();
    terminals.current.delete(tabId);
    pendingSessionStarts.current.delete(tabId);
    pendingReconnects.current.delete(tabId);

    setTabs((currentTabs) => {
      const nextTabs = currentTabs.filter((item) => item.id !== tabId);
      if (activeTabId === tabId) {
        setActiveTabId(nextTabs.at(-1)?.id ?? null);
      }
      return nextTabs;
    });
  };

  const activeTab = tabs.find((tab) => tab.id === activeTabId);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <TerminalSquare aria-hidden="true" size={22} />
          <div>
            <h1>Web Shell</h1>
            <p>{config?.shell.name ?? "PowerShell"}</p>
          </div>
        </div>

        <div className="session-meta">
          <span className={`status-dot ${connectionState}`} aria-hidden="true" />
          <span>{activeTab?.cwd ?? statusText}</span>
        </div>

        <nav className="actions" aria-label="Terminal actions">
          <button type="button" onClick={() => createTab()}>
            <Plus aria-hidden="true" size={16} />
            <span>New Tab</span>
          </button>
          <button type="button" onClick={() => activeTabId && stopTab(activeTabId)} disabled={!activeTab?.sessionId}>
            <Square aria-hidden="true" size={16} />
            <span>Stop</span>
          </button>
          <button type="button" onClick={() => activeTabId && reconnectTab(activeTabId)} disabled={!activeTabId}>
            <RotateCw aria-hidden="true" size={16} />
            <span>Reconnect</span>
          </button>
        </nav>
      </header>

      <section className="quick-tabbar" aria-label="Open terminal tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`quick-tab ${tab.id === activeTabId ? "active" : ""}`}
            onClick={() => setActiveTabId(tab.id)}
          >
            <span className={`tab-state ${tab.status}`} aria-hidden="true" />
            <span>{tab.title}</span>
            <X
              aria-hidden="true"
              size={14}
              onClick={(event) => {
                event.stopPropagation();
                closeTab(tab.id);
              }}
            />
          </button>
        ))}
      </section>

      <section className={`workspace-layout ${sidebarCollapsed ? "collapsed" : ""}`}>
        <aside className="sidebar" aria-label="Workspace directories">
          <button
            type="button"
            className="sidebar-toggle"
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {sidebarCollapsed ? <ChevronRight aria-hidden="true" size={16} /> : <ChevronLeft aria-hidden="true" size={16} />}
            <span>Paths</span>
          </button>

          {!sidebarCollapsed ? (
            <div className="directory-groups">
              <div className="add-path-block">
                {isAddingDirectory ? (
                  <form className="add-path-form" onSubmit={addCurrentDirectory}>
                    <input
                      aria-label="Path name"
                      placeholder="Name"
                      value={newDirectoryName}
                      onChange={(event) => setNewDirectoryName(event.target.value)}
                    />
                    <div className="current-path-preview">{activeTab?.cwd ?? config?.workspace.root ?? "No active path"}</div>
                    {directoryError ? <div className="form-error">{directoryError}</div> : null}
                    <div className="form-actions">
                      <button type="submit">Favorite</button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsAddingDirectory(false);
                          setDirectoryError(null);
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <button type="button" className="add-path-button" onClick={openAddDirectoryForm}>
                    <Plus aria-hidden="true" size={16} />
                    <span>Add Path</span>
                  </button>
                )}
              </div>
              {config?.directories.map((directory) => {
                const groupedTabs = tabs.filter((tab) => tab.directoryId === directory.id);
                return (
                  <section key={directory.id} className="directory-group">
                    <div className="directory-row">
                      <button
                        type="button"
                        className={`directory-button ${selectedDirectoryId === directory.id ? "selected" : ""}`}
                        onClick={() => setSelectedDirectoryId(directory.id)}
                        onDoubleClick={() => openDirectoryTab(directory.id)}
                        title={directory.path}
                        aria-label={`Open shell in ${directory.name}`}
                      >
                        <FolderOpen aria-hidden="true" size={16} />
                        <span>{directory.name}</span>
                      </button>
                      <button
                        type="button"
                        className="delete-directory"
                        aria-label={`Delete ${directory.name}`}
                        title="Delete path"
                        onClick={() => deleteDirectory(directory.id)}
                      >
                        <X aria-hidden="true" size={14} />
                      </button>
                    </div>
                    <div className="directory-path">{directory.path}</div>
                    <div className="sidebar-tabs">
                      {groupedTabs.map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          className={`sidebar-tab ${tab.id === activeTabId ? "active" : ""}`}
                          onClick={() => setActiveTabId(tab.id)}
                        >
                          <span className={`tab-state ${tab.status}`} aria-hidden="true" />
                          <span>{tab.title}</span>
                          <X
                            aria-hidden="true"
                            size={14}
                            onClick={(event) => {
                              event.stopPropagation();
                              closeTab(tab.id);
                            }}
                          />
                        </button>
                      ))}
                    </div>
                  </section>
                );
              })}
              {tabs.some((tab) => !tab.directoryId) ? (
                <section className="directory-group">
                  <div className="directory-button static">
                    <TerminalSquare aria-hidden="true" size={16} />
                    <span>Other</span>
                  </div>
                  <div className="sidebar-tabs">
                    {tabs
                      .filter((tab) => !tab.directoryId)
                      .map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          className={`sidebar-tab ${tab.id === activeTabId ? "active" : ""}`}
                          onClick={() => setActiveTabId(tab.id)}
                        >
                          <span className={`tab-state ${tab.status}`} aria-hidden="true" />
                          <span>{tab.title}</span>
                        </button>
                      ))}
                  </div>
                </section>
              ) : null}
            </div>
          ) : null}
        </aside>

        <section className="terminal-wrap" aria-label="Terminal">
          {tabs.length === 0 ? (
            <div className="empty-state">
              <button type="button" onClick={() => createTab()}>
                <Plus aria-hidden="true" size={16} />
                <span>New Tab</span>
              </button>
            </div>
          ) : null}
          {tabs.map((tab) => (
            <div
              key={tab.id}
              ref={(node) => bindTerminalElement(tab.id, node)}
              className={`terminal-host ${tab.id === activeTabId ? "active" : ""}`}
            />
          ))}
        </section>
      </section>

      <footer className="bottombar">
        <span>{activeTab?.cwd ?? config?.workspace.root ?? "Workspace loading"}</span>
        <span>
          <Power aria-hidden="true" size={14} />
          {config ? `${activeSessions}/${config.sessions.maxSessions}` : "0/0"}
        </span>
      </footer>
    </main>
  );
}
