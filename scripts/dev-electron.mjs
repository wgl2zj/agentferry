// 开发模式：esbuild 增量构建 main/preload → 启动 vite dev server（1420 端口）→
// 端口就绪后启动 Electron（注入 VITE_DEV_SERVER_URL）。Electron 退出时关闭 vite。
import { spawn } from "node:child_process";
import net from "node:net";
import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["electron"],
  sourcemap: "inline",
  logLevel: "info",
};

await build({ ...common, entryPoints: ["electron/main.ts"], outfile: "dist-electron/main.cjs" });
await build({ ...common, entryPoints: ["electron/preload.ts"], outfile: "dist-electron/preload.cjs" });

const vite = spawn("npx", ["vite"], { stdio: "inherit", shell: true });
let electron = null;
const cleanup = () => {
  try {
    if (vite.pid) vite.kill();
  } catch {
    // 进程已退出
  }
};
process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});

function waitPort(port, retries = 120) {
  return new Promise((resolve, reject) => {
    const attempt = async (left) => {
      const ok = await new Promise((res) => {
        const s = net.connect(port, "127.0.0.1", () => {
          s.end();
          res(true);
        });
        s.on("error", () => res(false));
      });
      if (ok) return resolve();
      if (left <= 0) return reject(new Error(`vite dev server（端口 ${port}）未就绪`));
      setTimeout(() => attempt(left - 1), 500);
    };
    attempt(retries);
  });
}

await waitPort(1420);
electron = spawn("npx", ["electron", "."], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, VITE_DEV_SERVER_URL: "http://localhost:1420" },
});
electron.on("exit", (code) => {
  cleanup();
  process.exit(code ?? 0);
});
