// 首页：应用门面 + 打包/解包两张功能卡 + 最近任务（localStorage 历史）。
import { useEffect, useState } from "react";
import { IconPack, IconUnpack } from "../components/icons";
import { EmptyState } from "../components/EmptyState";
import { loadHistory, type HistoryEntry } from "../components/history";
import type { Route } from "../App";

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", { hour12: false });
}

export function HomePage(props: { onNavigate: (route: Route) => void }) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  // 每次进入首页重新读历史（打包/解包完成后返回可见最新记录）
  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  return (
    <section className="page" aria-labelledby="home-title">
      <header className="page-head">
        <h1 id="home-title">资产摆渡</h1>
        <p className="page-head-desc">
          AgentFerry · agent 软件个人资产迁移工具：把旧机器上的规则、技能、命令、记忆等资产，
          打成带完整性校验的迁移包，安全恢复到新机器。
        </p>
      </header>

      <div className="feature-grid">
        <button
          type="button"
          className="feature-card"
          onClick={() => props.onNavigate("pack")}
        >
          <span className="feature-card-icon">
            <IconPack size={22} />
          </span>
          <h2>打包：旧机导出</h2>
          <p>扫描本机 agent 资产，按档位勾选后压缩为 .zam 迁移包（含逐文件 SHA-256 清单）。</p>
          <span className="feature-card-cta">开始打包 →</span>
        </button>
        <button
          type="button"
          className="feature-card"
          onClick={() => props.onNavigate("unpack")}
        >
          <span className="feature-card-icon">
            <IconUnpack size={22} />
          </span>
          <h2>解包：新机恢复</h2>
          <p>校验迁移包完整性，预览内容，dry-run 确认变更计划后再执行，替换前自动备份。</p>
          <span className="feature-card-cta">开始解包 →</span>
        </button>
      </div>

      <div className="card">
        <h2 className="card-title">最近任务</h2>
        {history.length === 0 ? (
          <EmptyState
            title="还没有迁移任务记录"
            reason="最近任务只记录本机上完成过的打包与解包；当前一份都没有，说明本机还没执行过迁移。"
            nextStep="点击上方「打包」把本机资产导出为迁移包，或点击「解包」恢复已有迁移包。"
            action={
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => props.onNavigate("pack")}
              >
                去打包本机资产
              </button>
            }
          />
        ) : (
          <ul className="history-list">
            {history.map((h) => (
              <li key={h.id} className="history-item">
                <span className="history-icon">
                  {h.kind === "pack" ? <IconPack size={18} /> : <IconUnpack size={18} />}
                </span>
                <div className="history-body">
                  <p className="history-summary">{h.summary}</p>
                  <p className="history-loc">{h.location}</p>
                </div>
                <time className="history-time" dateTime={h.time}>
                  {formatTime(h.time)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
