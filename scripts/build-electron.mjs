// Electron 主进程与预加载脚本打包：esbuild 单文件打包到 dist-electron/*.cjs。
// 输出 CJS（.cjs）以兼容 package.json "type": "module" 与沙箱预加载要求。
import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["electron"],
  sourcemap: false,
  logLevel: "info",
};

await build({ ...common, entryPoints: ["electron/main.ts"], outfile: "dist-electron/main.cjs" });
await build({ ...common, entryPoints: ["electron/preload.ts"], outfile: "dist-electron/preload.cjs" });
console.log("Electron 构建完成：dist-electron/main.cjs、dist-electron/preload.cjs");
