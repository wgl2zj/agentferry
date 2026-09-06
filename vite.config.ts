// Vite 构建 + Vitest 测试配置
/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Electron 以 file:// 加载 dist/index.html，资源必须用相对路径（Tauri 自定义协议不需要）。
  base: "./",

  // Vitest：渲染层默认 jsdom 环境，收集 src 与 electron（引擎）下的测试；
  // 引擎测试为 Node 环境，用文件内 `@vitest-environment node` 注释声明。
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}", "electron/**/*.test.{ts,tsx}"],
  },

  // 开发服务器：固定端口，与 scripts/dev-electron.mjs 的等待逻辑一致
  server: {
    port: 1420,
    strictPort: true,
  },
}));
