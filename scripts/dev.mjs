import { spawn } from "node:child_process";

const commands = [
  {
    name: "server",
    command: "npm",
    args: ["run", "dev", "--workspace", "@web-shell/server"]
  },
  {
    name: "web",
    command: "npm",
    args: ["run", "dev", "--workspace", "@web-shell/web"]
  }
];

const children = commands.map(({ name, command, args }) => {
  const child = spawn(resolveCommand(command), resolveArgs(command, args), {
    stdio: "inherit"
  });

  child.on("exit", (code, signal) => {
    if (code === 0 || signal) {
      return;
    }

    console.error(`${name} exited with code ${code}`);
    shutdown();
  });

  return child;
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, shutdown);
}

function shutdown() {
  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }
}

function resolveCommand(command) {
  return process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : command;
}

function resolveArgs(command, args) {
  if (process.platform !== "win32") {
    return args;
  }

  return ["/d", "/s", "/c", [command, ...args].join(" ")];
}
