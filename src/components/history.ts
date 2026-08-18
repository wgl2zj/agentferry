// 最近任务记录：v1 用 localStorage 持久化打包/解包历史，首页展示。
const STORAGE_KEY = "agentferry.recentTasks";

export interface HistoryEntry {
  id: string;
  kind: "pack" | "unpack";
  /** 一句话结果，如"打包完成：64 个文件 · 1.2 MB" */
  summary: string;
  /** 关键位置，如包路径或目标根目录 */
  location: string;
  /** ISO 时间串 */
  time: string;
}

const MAX_ENTRIES = 10;

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as HistoryEntry[];
  } catch {
    return [];
  }
}

export function addHistory(entry: Omit<HistoryEntry, "id" | "time">): void {
  try {
    const list = loadHistory();
    const next: HistoryEntry = {
      ...entry,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      time: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify([next, ...list].slice(0, MAX_ENTRIES)));
  } catch {
    // localStorage 不可用（隐私模式等）时静默降级，历史仅本次会话内存可见性放弃。
  }
}
