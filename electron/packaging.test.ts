// @vitest-environment node
// 打包配置契约测试：锁定 electron-builder 安装包配置的关键不变量（行为预期清单 E5）
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

interface BuildConfig {
  appId: string;
  productName: string;
  directories: { output: string };
  files: string[];
  electronDownload: { mirror: string };
  win: { target: Array<{ target: string; arch: string[] }>; artifactName: string };
}
const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
  version: string;
  main: string;
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
  build: BuildConfig;
};

describe("packaging_config_contract_locks_installer_shape", () => {
  it("入口与打包文件范围：main 指向 dist-electron，files 覆盖 dist 与 dist-electron", () => {
    expect(pkg.main).toBe("dist-electron/main.cjs");
    expect(pkg.build.files).toContain("dist/**/*");
    expect(pkg.build.files).toContain("dist-electron/**/*");
  });

  it("win 目标为 nsis x64，产物名用版本号模板", () => {
    const hasNsisX64 = pkg.build.win.target.some(
      (t) => t.target === "nsis" && t.arch.includes("x64"),
    );
    expect(hasNsisX64).toBe(true);
    expect(pkg.build.win.artifactName).toBe("AgentFerry-Setup-${version}.exe");
  });

  it("appId/productName/输出目录已设，且输出目录被 gitignore 覆盖（产物不入库）", () => {
    expect(pkg.build.appId).toBe("com.wgl2zj.agentferry");
    expect(pkg.build.productName).toBe("AgentFerry");
    expect(pkg.build.directories.output).toBe("release");
    const gitignore = readFileSync(join(process.cwd(), ".gitignore"), "utf8");
    expect(gitignore).toContain("release/");
  });

  it("Electron 本体下载镜像已固化（国内网络 GitHub 直连拉不动，2026-10-14 实测）", () => {
    expect(pkg.build.electronDownload.mirror).toContain("npmmirror.com/mirrors/electron/");
  });

  it("安装包命令存在且串联构建与 electron-builder；依赖已声明", () => {
    expect(pkg.scripts["build:installer"]).toContain("npm run build");
    expect(pkg.scripts["build:installer"]).toContain("electron-builder --win nsis");
    expect(pkg.devDependencies["electron-builder"]).toBeTruthy();
  });
});
