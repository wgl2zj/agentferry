// Vite 构建 + Vitest 测试配置（Tauri 开发定制项见注释）
/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

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

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
