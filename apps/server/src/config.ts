import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type WebShellConfig = {
  server: {
    host: string;
    port: number;
  };
  workspace: {
    root: string;
  };
  directories: Array<{
    id: string;
    name: string;
    path: string;
  }>;
  shell: {
    id: string;
    name: string;
    command: string;
    args: string[];
  };
  sessions: {
    disconnectGraceMs: number;
    maxSessions: number;
  };
  shortcuts: Array<{
    id: string;
    name: string;
    input: string;
  }>;
};

const defaultConfig: WebShellConfig = {
  server: {
    host: "127.0.0.1",
    port: 5959
  },
  workspace: {
    root: "."
  },
  directories: [{ id: "workspace", name: "Workspace", path: "." }],
  shell: {
    id: process.platform === "win32" ? "powershell" : "shell",
    name: process.platform === "win32" ? "PowerShell" : "Shell",
    command: process.platform === "win32" ? "powershell.exe" : process.env.SHELL ?? "bash",
    args: process.platform === "win32" ? ["-NoLogo"] : []
  },
  sessions: {
    disconnectGraceMs: 2_000,
    maxSessions: 12
  },
  shortcuts: [
    { id: "claude", name: "Claude Code", input: "claude\r" },
    { id: "codex", name: "Codex", input: "codex\r" }
  ]
};

export function loadConfig(): WebShellConfig {
  const configPath = getConfigPath();

  if (!existsSync(configPath)) {
    return withResolvedWorkspace(defaultConfig);
  }

  const parsed = JSON.parse(readFileSync(configPath, "utf8")) as Partial<WebShellConfig>;
  return withResolvedShell(withResolvedWorkspace({
    ...defaultConfig,
    ...parsed,
    server: { ...defaultConfig.server, ...parsed.server },
    workspace: { ...defaultConfig.workspace, ...parsed.workspace },
    directories: parsed.directories ?? defaultConfig.directories,
    shell: { ...defaultConfig.shell, ...parsed.shell },
    sessions: { ...defaultConfig.sessions, ...parsed.sessions },
    shortcuts: parsed.shortcuts ?? defaultConfig.shortcuts
  }));
}

export function getConfigPath(): string {
  return path.resolve(getBaseDir(), "config", "web-shell.json");
}

export function getBaseDir(): string {
  return process.env.WEB_SHELL_ROOT ?? process.env.INIT_CWD ?? process.cwd();
}

export function addDirectoryFavorite(input: { id?: string; name: string; path: string }): WebShellConfig {
  const configPath = getConfigPath();
  const rawConfig = existsSync(configPath)
    ? (JSON.parse(readFileSync(configPath, "utf8")) as Partial<WebShellConfig>)
    : defaultConfig;
  const directories = rawConfig.directories ?? defaultConfig.directories;
  const id = uniqueDirectoryId(directories, normalizeId(input.id ?? input.name));

  if (directories.some((directory) => directory.id === id)) {
    throw new ConfigError("DIRECTORY_EXISTS", `Directory id already exists: ${id}`);
  }

  const nextConfig = {
    ...rawConfig,
    directories: [
      ...directories,
      {
        id,
        name: input.name.trim(),
        path: input.path.trim()
      }
    ]
  };

  writeFileSync(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`);
  return loadConfig();
}

export function removeDirectoryFavorite(directoryId: string): WebShellConfig {
  const configPath = getConfigPath();
  const rawConfig = existsSync(configPath)
    ? (JSON.parse(readFileSync(configPath, "utf8")) as Partial<WebShellConfig>)
    : defaultConfig;
  const directories = rawConfig.directories ?? defaultConfig.directories;
  const nextDirectories = directories.filter((directory) => directory.id !== directoryId);

  if (nextDirectories.length === directories.length) {
    throw new ConfigError("DIRECTORY_NOT_FOUND", `Directory is not configured: ${directoryId}`);
  }

  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        ...rawConfig,
        directories: nextDirectories
      },
      null,
      2
    )}\n`
  );
  return loadConfig();
}

function withResolvedWorkspace(config: WebShellConfig): WebShellConfig {
  const baseDir = getBaseDir();

  return {
    ...config,
    workspace: {
      root: path.resolve(baseDir, config.workspace.root)
    },
    directories: config.directories.map((directory) => ({
      ...directory,
      path: path.resolve(baseDir, directory.path)
    }))
  };
}

function normalizeId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!normalized) {
    throw new ConfigError("BAD_DIRECTORY", "Directory id or name must contain letters or numbers.");
  }

  return normalized;
}

function uniqueDirectoryId(directories: Array<{ id: string }>, baseId: string): string {
  let id = baseId;
  let suffix = 2;

  while (directories.some((directory) => directory.id === id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }

  return id;
}

export class ConfigError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

function withResolvedShell(config: WebShellConfig): WebShellConfig {
  if (config.shell.command !== "auto") {
    return config;
  }

  if (process.platform === "win32") {
    return {
      ...config,
      shell: {
        id: "powershell",
        name: "PowerShell",
        command: "powershell.exe",
        args: ["-NoLogo"]
      }
    };
  }

  const shell = process.env.SHELL ?? "bash";
  const name = shell.split(/[\\/]/).at(-1) ?? "Shell";

  return {
    ...config,
    shell: {
      id: name.toLowerCase(),
      name,
      command: shell,
      args: []
    }
  };
}
