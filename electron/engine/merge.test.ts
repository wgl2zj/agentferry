// @vitest-environment node
// 内容级合并（merge）测试：行为预期清单 #2/#3（两边独有内容全保留、确定性）的锁定。

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { mergeJson, mergeMarkdown, mergeStrategyFor, readStrictUtf8, type JsonMergePreview } from "./merge";

const sha = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

describe("mergeStrategyFor（预期 #1：仅 .md/.json 支持合并）", () => {
  it("md/markdown/json 支持合并，其他类型返回 null", () => {
    expect(mergeStrategyFor("cli/memories/projects/p1/MEMORY.md")).toBe("markdown");
    expect(mergeStrategyFor("notes.MARKDOWN")).toBe("markdown");
    expect(mergeStrategyFor("cli/config.json")).toBe("json");
    expect(mergeStrategyFor("config.toml")).toBeNull();
    expect(mergeStrategyFor("skills/a/SKILL.txt")).toBeNull();
    expect(mergeStrategyFor("x.exe")).toBeNull();
    expect(mergeStrategyFor("db.sqlite")).toBeNull();
  });
});

describe("mergeMarkdown（预期 #2：行级并集，两边独有行全保留、重复去重、确定性）", () => {
  it("两边各自新增的记忆条目全部保留，重复条目只留一份，目标行序为基底", () => {
    const target = ["# MEMORY.md", "", "- [项目A记忆](a.md) — 新机攒的", "- [项目B记忆](b.md) — 两边都有"];
    const pkg = ["# MEMORY.md", "", "- [项目B记忆](b.md) — 两边都有", "- [旧机记忆C](c.md) — 旧机独有1", "- [旧机记忆D](d.md) — 旧机独有2"];
    const result = mergeMarkdown(target.join("\n"), pkg.join("\n"));
    const lines = result.text.split("\n");
    // 两边独有内容都在
    expect(lines).toContain("- [项目A记忆](a.md) — 新机攒的");
    expect(lines).toContain("- [旧机记忆C](c.md) — 旧机独有1");
    expect(lines).toContain("- [旧机记忆D](d.md) — 旧机独有2");
    // 重复只留一份
    expect(lines.filter((l) => l === "- [项目B记忆](b.md) — 两边都有")).toHaveLength(1);
    // 目标为基底（新机条目在前，旧机独有追加在后），追加块前有空行分隔
    expect(lines.indexOf("- [项目A记忆](a.md) — 新机攒的")).toBeLessThan(lines.indexOf("- [旧机记忆C](c.md) — 旧机独有1"));
    expect(lines[lines.indexOf("- [旧机记忆C](c.md) — 旧机独有1") - 1]).toBe("");
    // 预览统计自洽：追加 2 行
    expect(result.preview).toMatchObject({ strategy: "markdown", appended: 2 });
  });

  it("确定性：同一对输入永远得到同一输出哈希（执行复验依赖此性质）", () => {
    const t = "# 规则\n\n- 条目1\n- 条目2\n";
    const p = "# 规则\n\n- 条目2\n- 条目3\n";
    expect(sha(mergeMarkdown(t, p).text)).toBe(sha(mergeMarkdown(t, p).text));
  });

  it("CRLF 输入统一为 LF；目标无内容时包内容全部成为追加", () => {
    const result = mergeMarkdown("行1\r\n行2", "行1\r\n行3");
    expect(result.text).toBe("行1\n行2\n\n行3");
    expect(result.preview).toMatchObject({ appended: 1 });
  });
});

describe("mergeJson（预期 #3：深合并，包独有 key 加入，标量冲突取旧机包并逐条记录）", () => {
  it("包独有字段加入、嵌套对象递归、同值保留、标量冲突取包并记录路径与双方值", () => {
    const target = JSON.stringify({
      mcp: [{ cmd: "D:\\new\\py.exe" }],
      theme: "dark",
      keep: "same",
      nested: { a: 1, onlyTarget: true },
    });
    const pkg = JSON.stringify({
      mcp: [{ cmd: "C:\\Users\\old\\py.exe" }],
      theme: "light",
      keep: "same",
      nested: { a: 1, onlyOld: "旧机独有" },
      brandNew: { deep: [1, 2] },
    });
    const result = mergeJson(target, pkg);
    const merged = JSON.parse(result.text) as Record<string, unknown>;
    const preview = result.preview as JsonMergePreview;
    // 包独有 key 加入（含嵌套）
    expect(preview).toMatchObject({
      strategy: "json",
      added_keys: ["nested.onlyOld", "brandNew"],
    });
    expect(merged.brandNew).toEqual({ deep: [1, 2] });
    expect((merged.nested as Record<string, unknown>).onlyOld).toBe("旧机独有");
    // 新机独有 key 保留
    expect((merged.nested as Record<string, unknown>).onlyTarget).toBe(true);
    // 标量/数组冲突取旧机包，且逐条记录（新机值在备份中保留）
    expect(merged.mcp).toEqual([{ cmd: "C:\\Users\\old\\py.exe" }]);
    expect(merged.theme).toBe("light");
    expect(preview.scalar_conflicts).toEqual([
      { path: "mcp", target: '[{"cmd":"D:\\\\new\\\\py.exe"}]', package: '[{"cmd":"C:\\\\Users\\\\old\\\\py.exe"}]' },
      { path: "theme", target: '"dark"', package: '"light"' },
    ]);
    // 同值字段零冲突记录
    expect(preview.scalar_conflicts.some((c) => c.path === "keep")).toBe(false);
  });

  it("确定性：同一对输入永远得到同一输出哈希", () => {
    const t = '{"a":1,"n":{"x":1}}';
    const p = '{"a":2,"n":{"y":2}}';
    expect(sha(mergeJson(t, p).text)).toBe(sha(mergeJson(t, p).text));
  });

  it("非对象顶层：直接取包并记录冲突", () => {
    const result = mergeJson("[1,2]", "[3]");
    expect(JSON.parse(result.text)).toEqual([3]);
    expect((result.preview as JsonMergePreview).scalar_conflicts).toHaveLength(1);
  });

  it("无效 JSON 抛错（调用方降级为普通冲突动作）", () => {
    expect(() => mergeJson("{bad", "{}")).toThrow();
    expect(() => mergeJson("{}", "{bad")).toThrow();
  });
});

describe("readStrictUtf8（BOM/非 UTF-8 不支持合并）", () => {
  it("BOM 文件拒绝、非 UTF-8 拒绝、正常文本通过", () => {
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("x", "utf8")]);
    expect(readStrictUtf8(bom).ok).toBe(false);
    expect(readStrictUtf8(Buffer.from([0xff, 0xfe, 0x00])).ok).toBe(false);
    expect(readStrictUtf8(Buffer.from("正常", "utf8"))).toEqual({ ok: true, text: "正常" });
  });
});
