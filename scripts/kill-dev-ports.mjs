import { execSync } from "node:child_process";

const ports = [3000, 3001, 3002];

function killPort(port) {
  let out = "";
  try {
    out = execSync(`netstat -ano | findstr :${port}`, { encoding: "utf8" });
  } catch {
    return;
  }

  const pids = new Set();
  for (const line of out.split(/\r?\n/)) {
    if (!line.includes("LISTENING")) continue;
    const parts = line.trim().split(/\s+/);
    const pid = Number.parseInt(parts[parts.length - 1], 10);
    if (Number.isFinite(pid) && pid > 0) pids.add(pid);
  }

  for (const pid of pids) {
    try {
      execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
      console.log(`Freed port ${port} (stopped PID ${pid})`);
    } catch {
      // already gone
    }
  }
}

for (const port of ports) killPort(port);
