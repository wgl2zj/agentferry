// 解包向导 6 步：选包校验 → 内容预览 → 恢复模式 → dry-run 计划确认 → 执行与报告 → 路径适配。
// 路径适配必须在执行之后：detect/apply 作用对象是目标树，执行前目标文件尚不存在（契约时序红线）。
// 高风险动作（执行计划、路径替换）统一走居中确认对话框；进度走真实事件。
import { useEffect, useMemo, useRef, useState } from "react";
import {
  COMMANDS,
  type AppErrorPayload,
  type ApplyMode,
  type ApplyPlan,
  type ApplyReport,
  type DetectResult,
  type Manifest,
  type PathFixReport,
  type ProfileSummary,
  type ProgressPayload,
} from "../lib/ipc";
import { apiCall, pickDirectory, pickPackage, useProgress } from "../lib/mock";
import { formatBytes } from "../lib/format";
import { Banner } from "../components/Banner";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { WizardSteps } from "../components/WizardSteps";
import { ProgressBar } from "../components/ProgressBar";
import { StatusTag, SkipTag } from "../components/StatusTag";
import { EmptyState } from "../components/EmptyState";
import { useToast } from "../components/Toast";
import { IconWarning } from "../components/icons";
import { addHistory } from "../components/history";
import { joinPath } from "../components/paths";
import { categoryLabel } from "../components/categoryNames";

const STEPS = ["选包并校验", "内容预览", "恢复模式", "计划确认", "执行与报告", "路径适配"];

/** 路径适配清单中的一行（映射可编辑、可勾选停用）。 */
interface MappingRow {
  old: string;
  new: string;
  total_hits: number;
  enabled: boolean;
}

function isAppError(e: unknown): e is AppErrorPayload {
  return typeof e === "object" && e !== null && "code" in e && "message" in e;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", { hour12: false });
}

export function UnpackWizard(props: { onExit: () => void }) {
  const toast = useToast();
  const [step, setStep] = useState(0);

  // 档案清单（类别中文名与默认根目录的唯一数据源；具体跟随哪个档案由包内 profile_id 决定）
  const [profiles, setProfiles] = useState<ProfileSummary[] | null>(null);
  const profilesRef = useRef<ProfileSummary[] | null>(null);
  profilesRef.current = profiles;

  // 第 1 步：选包与校验
  const [pkgPath, setPkgPath] = useState("");
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<AppErrorPayload | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);

  // 第 3 步：恢复模式与目标根目录
  const [mode, setMode] = useState<ApplyMode>("incremental");
  const [targetRoot, setTargetRoot] = useState("");
  /** 目标根目录被手动编辑/浏览选择过后，打开新包时不再按包内档案重填。 */
  const targetDirtyRef = useRef(false);

  // 第 4 步：dry-run 计划
  const [plan, setPlan] = useState<ApplyPlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Set<string>>(new Set());
  const [confirmApply, setConfirmApply] = useState(false);

  // 第 5 步：执行与报告
  const [executing, setExecuting] = useState(false);
  const [report, setReport] = useState<ApplyReport | null>(null);
  const [applyError, setApplyError] = useState<AppErrorPayload | null>(null);

  // 第 6 步：路径适配（执行完成后进行，目标树此时已存在）
  const [detecting, setDetecting] = useState(false);
  const [detect, setDetect] = useState<DetectResult | null>(null);
  const [mappings, setMappings] = useState<MappingRow[]>([]);
  const [pathfixing, setPathfixing] = useState(false);
  const [pathfixReport, setPathfixReport] = useState<PathFixReport | null>(null);
  const [confirmPathfix, setConfirmPathfix] = useState(false);

  const [progress, setProgress] = useState<ProgressPayload | null>(null);
  const activeTask =
    step === 0 ? "open" : step === 3 ? "plan" : step === 4 ? "apply" : step === 5 ? "pathfix" : "";
  useProgress((p) => {
    if (p.task === activeTask) setProgress(p);
  });

  // 预填包路径 + 加载档案清单
  useEffect(() => {
    let disposed = false;
    apiCall<{ default_output_dir: string }>(COMMANDS.loadSettings)
      .then((s) => {
        if (disposed) return;
        setPkgPath((prev) => prev || joinPath(s.default_output_dir, "迁移包.zam"));
      })
      .catch(() => undefined);
    apiCall<ProfileSummary[]>(COMMANDS.listProfiles)
      .then((list) => {
        if (disposed) return;
        setProfiles(list);
        // 未选包前先以第一个档案根目录预填；打开包后按包内档案重填（见 openPackage）
        if (list[0]) setTargetRoot((prev) => prev || list[0].default_root);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, []);

  /** 包内档案：manifest 打开后按 profile_id 定位；未打开时回退列表第一个（仅用于预填默认值）。 */
  const pkgProfile = useMemo(() => {
    if (!profiles || profiles.length === 0) return null;
    return profiles.find((p) => p.id === manifest?.profile_id) ?? profiles[0];
  }, [profiles, manifest]);

  /** 档案类别表（类别中文名的唯一数据源）：跟随包内档案。 */
  const categoryTable = useMemo(() => pkgProfile?.categories ?? [], [pkgProfile]);

  /** 弹系统文件选择框选 .zam 迁移包；取消不改动，选中后仍需手动点「打开并校验」。 */
  const browsePackage = async () => {
    const file = await pickPackage(pkgPath);
    if (file) setPkgPath(file);
  };

  const openPackage = () => {
    if (!pkgPath.trim()) return;
    setOpening(true);
    setOpenError(null);
    setProgress(null);
    apiCall<Manifest>(COMMANDS.openPackage, { path: pkgPath.trim() })
      .then((m) => {
        setManifest(m);
        // 解包目标默认按包内档案推导为本机资产根目录（如 ~/.codex）；用户手动改过则不覆盖
        const prof = profilesRef.current?.find((p) => p.id === m.profile_id);
        if (prof) {
          setTargetRoot((prev) =>
            targetDirtyRef.current && prev.trim() ? prev : prof.default_root,
          );
        }
      })
      .catch((e: unknown) =>
        setOpenError(isAppError(e) ? e : { code: "internal", message: "打开迁移包失败" }),
      )
      .finally(() => setOpening(false));
  };

  const runPlan = (ov: Set<string>) => {
    setPlanning(true);
    setPlanError(null);
    apiCall<ApplyPlan>(COMMANDS.planApply, {
      path: pkgPath.trim(),
      mode,
      conflictOverrides: [...ov],
      targetRoot: targetRoot.trim(),
    })
      .then((p) => setPlan(p))
      .catch((e: unknown) => setPlanError(isAppError(e) ? e.message : "生成变更计划失败"))
      .finally(() => setPlanning(false));
  };

  const goPlanStep = () => {
    if (!targetRoot.trim()) {
      toast.warning("请先填写恢复目标目录（默认取包内档案的本机资产根目录）。");
      return;
    }
    setStep(3);
    runPlan(overrides);
  };

  /** 弹系统目录选择框选恢复目标根目录；取消不改动。 */
  const browseTarget = async () => {
    const dir = await pickDirectory(targetRoot);
    if (dir) {
      setTargetRoot(dir);
      targetDirtyRef.current = true;
    }
  };

  /** 冲突行改判：勾选"备份后替换"则加入 overrides 并重新 plan。 */
  const setConflictAction = (targetRel: string, toReplace: boolean) => {
    setOverrides((prev) => {
      const next = new Set(prev);
      if (toReplace) next.add(targetRel);
      else next.delete(targetRel);
      runPlan(next);
      return next;
    });
  };

  const setAllConflicts = (toReplace: boolean) => {
    const conflicts = (plan?.items ?? []).filter(
      (i) => i.action === "replace" || i.action === "keep",
    );
    const next = new Set<string>(toReplace ? conflicts.map((c) => c.target_rel) : []);
    setOverrides(next);
    runPlan(next);
  };

  const groups = useMemo(() => {
    const items = plan?.items ?? [];
    return {
      create: items.filter((i) => i.action === "create"),
      skip_same: items.filter((i) => i.action === "skip_same"),
      replace: items.filter((i) => i.action === "replace"),
      keep: items.filter((i) => i.action === "keep"),
    };
  }, [plan]);

  const writeBytes = useMemo(
    () => [...groups.create, ...groups.replace].reduce((s, i) => s + i.size, 0),
    [groups],
  );

  const executeApply = () => {
    if (!plan) return;
    setConfirmApply(false);
    setStep(4);
    setExecuting(true);
    setProgress(null);
    const confirmed: ApplyPlan = { ...plan, confirmed_overrides: [...overrides] };
    apiCall<ApplyReport>(COMMANDS.executeApply, { plan: confirmed })
      .then((r) => {
        setReport(r);
        addHistory({
          kind: "unpack",
          summary: `解包完成：复验 ${r.verified_files} 个文件`,
          location: r.target_root,
        });
        toast.success("解包执行完成，写入文件已通过哈希复验。");
      })
      .catch((e: unknown) =>
        setApplyError(isAppError(e) ? e : { code: "internal", message: "执行失败" }),
      )
      .finally(() => setExecuting(false));
  };

  /** 包内需要路径适配的文件数（来自 manifest 的逐文件标记）。 */
  const needsAdaptCount = useMemo(
    () => (manifest?.files ?? []).filter((f) => f.needs_path_adapt).length,
    [manifest],
  );

  const runDetect = () => {
    setDetecting(true);
    apiCall<DetectResult>(COMMANDS.detectPathMappings, {
      path: pkgPath.trim(),
      targetRoot: targetRoot.trim(),
    })
      .then((d) => {
        setDetect(d);
        setMappings(d.seeds.map((s) => ({ ...s, enabled: true })));
      })
      .catch((e: unknown) => {
        toast.error(isAppError(e) ? e.message : "路径检出失败");
      })
      .finally(() => setDetecting(false));
  };

  /** 进入路径适配步：执行完成后目标树已存在，此时检出才有意义。 */
  const goPathfixStep = () => {
    setStep(5);
    if (!detect) runDetect();
  };

  const enabledMappings = mappings.filter((m) => m.enabled && m.new.trim() && m.old !== m.new);

  const doPathfix = () => {
    setConfirmPathfix(false);
    setPathfixing(true);
    setProgress(null);
    // 契约：后端已移除 backup 参数，替换前必备份是后端红线
    apiCall<PathFixReport>(COMMANDS.applyPathMappings, {
      path: pkgPath.trim(),
      targetRoot: targetRoot.trim(),
      mappings: enabledMappings.map((m) => ({ old: m.old, new: m.new })),
    })
      .then((r) => {
        setPathfixReport(r);
        const n = r.replaced.reduce((s, x) => s + x.replacements, 0);
        toast.success(`路径替换完成：${r.replaced.length} 个文件、${n} 处替换，替换前已备份。`);
      })
      .catch((e: unknown) => {
        toast.error(isAppError(e) ? e.message : "路径替换失败");
      })
      .finally(() => setPathfixing(false));
  };

  const manifestCategories = useMemo(() => {
    if (!manifest) return [];
    const map = new Map<string, { files: number; bytes: number; needAdapt: number }>();
    for (const f of manifest.files) {
      const cur = map.get(f.category) ?? { files: 0, bytes: 0, needAdapt: 0 };
      cur.files += 1;
      cur.bytes += f.size;
      if (f.needs_path_adapt) cur.needAdapt += 1;
      map.set(f.category, cur);
    }
    return [...map.entries()].map(([id, v]) => ({ id, ...v }));
  }, [manifest]);

  return (
    <section className="page" aria-labelledby="unpack-title">
      <header className="page-head">
        <h1 id="unpack-title">解包：把迁移包恢复到本机</h1>
        <p className="page-head-desc">
          校验 → 预览 → 选模式 → dry-run 确认 → 执行 → 路径适配。任何替换前先备份，两模式都不删目标文件。
        </p>
      </header>

      <WizardSteps steps={STEPS} current={step} />

      {/* 第 1 步：选包并校验 */}
      {step === 0 && (
        <div className="stack">
          {openError && (
            <Banner
              kind="danger"
              title={`无法打开迁移包（${openError.code}）`}
              onClose={() => setOpenError(null)}
            >
              {openError.message}
            </Banner>
          )}
          <div className="card stack">
            <div className="field">
              <label className="field-label" htmlFor="pkg-path">
                迁移包路径（.zam）
              </label>
              <div className="input-group">
                <input
                  id="pkg-path"
                  className="input input-mono"
                  value={pkgPath}
                  onChange={(e) => setPkgPath(e.target.value)}
                  placeholder="例如 D:/迁移包/codex-迁移包-20260817.zam"
                />
                <button type="button" className="btn" onClick={browsePackage}>
                  浏览…
                </button>
              </div>
              <p className="field-hint">打开后会逐文件校验 SHA-256，确认包在拷贝过程中没有损坏。</p>
            </div>
            {opening && <ProgressBar progress={progress} idleText="正在打开迁移包…" />}
            {!manifest && !opening && (
              <div>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!pkgPath.trim()}
                  onClick={openPackage}
                >
                  打开并校验
                </button>
              </div>
            )}
          </div>

          {manifest && (
            <div className="card stack">
              <div className="row">
                <h2 className="card-title" style={{ marginBottom: 0 }}>
                  包校验通过
                </h2>
                <StatusTag kind="success">完整性 OK</StatusTag>
              </div>
              <dl className="kv-grid">
                <div className="kv-item">
                  <dt>来源机器</dt>
                  <dd>
                    {manifest.source.hostname}（{manifest.source.os}/{manifest.source.arch}）
                  </dd>
                </div>
                <div className="kv-item">
                  <dt>来源用户</dt>
                  <dd className="mono">{manifest.source.username}</dd>
                </div>
                <div className="kv-item">
                  <dt>打包时间</dt>
                  <dd>{formatTime(manifest.created_at)}</dd>
                </div>
                <div className="kv-item">
                  <dt>文件数 / 体量</dt>
                  <dd>
                    {manifest.counts.files} 个 · {formatBytes(manifest.total_bytes)}
                  </dd>
                </div>
              </dl>
              {manifest.warnings.length > 0 && (
                <div>
                  <h3 className="card-sub" style={{ marginBottom: "var(--space-2)" }}>
                    打包时记录的警告（{manifest.warnings.length} 条）
                  </h3>
                  <ul className="warn-list">
                    {manifest.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <footer className="wizard-footer">
            <button type="button" className="btn" onClick={props.onExit}>
              返回首页
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!manifest || opening}
              onClick={() => setStep(1)}
            >
              下一步：预览内容
            </button>
          </footer>
        </div>
      )}

      {/* 第 2 步：内容预览 */}
      {step === 1 && manifest && (
        <div className="stack">
          <div className="table-shell">
            <table className="data-table">
              <thead>
                <tr>
                  <th>类别</th>
                  <th className="num">文件数</th>
                  <th className="num">体量</th>
                  <th className="center">路径适配</th>
                </tr>
              </thead>
              <tbody>
                {manifestCategories.map((c) => (
                  <tr key={c.id}>
                    <td>{categoryLabel(categoryTable, c.id)}</td>
                    <td className="num">{c.files}</td>
                    <td className="num">{formatBytes(c.bytes)}</td>
                    <td className="center">
                      {c.needAdapt > 0 ? (
                        <StatusTag kind="info">{c.needAdapt} 个文件需要</StatusTag>
                      ) : (
                        <SkipTag>不需要</SkipTag>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="secondary">
            标记「需要路径适配」的文件内含旧机器的绝对路径；解包执行完成后，最后一步会生成逐条确认的替换建议。
          </p>
          <footer className="wizard-footer">
            <button type="button" className="btn" onClick={() => setStep(0)}>
              上一步
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setStep(2)}>
              下一步：选择恢复模式
            </button>
          </footer>
        </div>
      )}

      {/* 第 3 步：恢复模式 */}
      {step === 2 && (
        <div className="stack">
          <div className="card stack">
            <h2 className="card-title">恢复模式</h2>
            <div className="choice-grid" role="group" aria-label="恢复模式">
              <button
                type="button"
                className="choice-card"
                aria-pressed={mode === "overwrite"}
                onClick={() => setMode("overwrite")}
              >
                <span className="choice-card-title">覆盖模式</span>
                <span className="choice-card-desc">
                  目标已存在且内容不同的文件：先备份到 zam-backups，再用包内版本替换。
                </span>
              </button>
              <button
                type="button"
                className="choice-card"
                aria-pressed={mode === "incremental"}
                onClick={() => setMode("incremental")}
              >
                <span className="choice-card-title">增量模式（默认更稳）</span>
                <span className="choice-card-desc">
                  冲突文件默认保留目标不动，可在下一步计划里逐条或整组改判为替换。
                </span>
              </button>
            </div>
            <p className="secondary">
              两种模式都不会删除目标机器上的任何文件；内容一致的一律跳过。
            </p>

            <div className="field">
              <label className="field-label" htmlFor="unpack-target-root">
                恢复目标目录
              </label>
              <div className="input-group">
                <input
                  id="unpack-target-root"
                  className="input input-mono"
                  value={targetRoot}
                  aria-describedby="unpack-target-root-hint"
                  onChange={(e) => {
                    setTargetRoot(e.target.value);
                    targetDirtyRef.current = true;
                  }}
                />
                <button type="button" className="btn" onClick={browseTarget}>
                  浏览…
                </button>
              </div>
              <p className="field-hint" id="unpack-target-root-hint">
                资产会恢复到这里。默认取包内档案（{pkgProfile?.display_name ?? "…"}
                ）在本机的资产根目录，确认无误即可，一般无需修改。
              </p>
            </div>
          </div>

          <footer className="wizard-footer">
            <button type="button" className="btn" onClick={() => setStep(1)}>
              上一步
            </button>
            <button type="button" className="btn btn-primary" onClick={goPlanStep}>
              下一步：生成变更计划
            </button>
          </footer>
        </div>
      )}

      {/* 第 4 步：dry-run 计划确认 */}
      {step === 3 && (
        <div className="stack">
          {plan?.backup_cleanup_hint && (
            <Banner kind="warning" title="备份目录超出保留上限">
              {plan.backup_cleanup_hint}
            </Banner>
          )}
          {planError && (
            <Banner kind="danger" title="生成变更计划失败" onClose={() => setPlanError(null)}>
              {planError}
            </Banner>
          )}
          {planning && <ProgressBar progress={progress} idleText="正在生成变更计划…" />}

          {plan && !planning && (
            <div className="card stack">
              <p className="secondary">
                以下是 dry-run 计划，<strong>尚未写入任何文件</strong>
                。确认无误后点「执行解包」才会真正改动目标目录。
              </p>

              <div>
                <div className="group-head">
                  <h3>新增文件</h3>
                  <span className="count-badge count-badge-accent">{groups.create.length}</span>
                  <StatusTag kind="success">create</StatusTag>
                </div>
                <ItemList items={groups.create} empty="没有需要新增的文件" />
              </div>

              <div>
                <div className="group-head">
                  <h3>内容一致，跳过</h3>
                  <span className="count-badge">{groups.skip_same.length}</span>
                  <StatusTag kind="neutral">skip_same</StatusTag>
                </div>
                <ItemList items={groups.skip_same} empty="没有内容一致的文件" />
              </div>

              <div>
                <div className="group-head">
                  <h3>冲突：备份后替换</h3>
                  <span className="count-badge count-badge-accent">{groups.replace.length}</span>
                  <StatusTag kind="danger">replace</StatusTag>
                  {mode === "incremental" && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => setAllConflicts(true)}
                    >
                      整组改判为替换
                    </button>
                  )}
                </div>
                <ConflictList
                  items={groups.replace}
                  toReplace
                  onChange={setConflictAction}
                  empty="没有标记为替换的冲突文件"
                />
              </div>

              <div>
                <div className="group-head">
                  <h3>冲突：保留目标</h3>
                  <span className="count-badge">{groups.keep.length}</span>
                  <StatusTag kind="warning">keep</StatusTag>
                  {mode === "incremental" && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => setAllConflicts(false)}
                    >
                      整组改判为保留
                    </button>
                  )}
                </div>
                <ConflictList
                  items={groups.keep}
                  toReplace={false}
                  onChange={setConflictAction}
                  empty="没有保留目标的冲突文件"
                />
              </div>
            </div>
          )}

          <footer className="wizard-footer">
            <button type="button" className="btn" onClick={() => setStep(2)}>
              上一步
            </button>
            <div className="wizard-footer-stats" aria-live="polite">
              {plan && (
                <span>
                  新增 {groups.create.length} · 跳过 {groups.skip_same.length} · 替换{" "}
                  {groups.replace.length} · 保留 {groups.keep.length} · 写入体量{" "}
                  {formatBytes(writeBytes)}
                </span>
              )}
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!plan || planning}
              onClick={() => setConfirmApply(true)}
            >
              执行解包
            </button>
          </footer>
        </div>
      )}

      {/* 第 5 步：执行与报告 */}
      {step === 4 && (
        <div className="stack">
          {applyError && (
            <Banner kind="danger" title={`执行失败（${applyError.code}）`}>
              {applyError.message}已写入的文件保持现状，备份目录可用于恢复。
            </Banner>
          )}
          {!report && (
            <div className="card stack">
              <h2 className="card-title">正在执行解包</h2>
              <ProgressBar progress={progress} idleText="正在准备执行…" />
            </div>
          )}
          {report && (
            <div className="card stack">
              <div className="row">
                <h2 className="card-title" style={{ marginBottom: 0 }}>
                  解包完成
                </h2>
                <StatusTag kind="success">复验通过</StatusTag>
              </div>
              <dl className="kv-grid">
                <div className="kv-item">
                  <dt>成功写入</dt>
                  <dd>{report.executed.filter((i) => i.status === "ok").length} 个</dd>
                </div>
                <div className="kv-item">
                  <dt>跳过</dt>
                  <dd>{report.executed.filter((i) => i.status === "skipped").length} 个</dd>
                </div>
                <div className="kv-item">
                  <dt>复验文件数</dt>
                  <dd>{report.verified_files} 个</dd>
                </div>
                <div className="kv-item">
                  <dt>备份目录</dt>
                  <dd className="mono">{report.backup_dir ?? "本次无替换，未产生备份"}</dd>
                </div>
              </dl>
              <div className="table-shell">
                <table className="data-table" aria-label="执行明细">
                  <thead>
                    <tr>
                      <th>文件</th>
                      <th className="center">动作</th>
                      <th className="center">结果</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.executed.slice(0, 20).map((i) => (
                      <tr key={i.target_rel}>
                        <td className="mono">{i.target_rel}</td>
                        <td className="center">{actionLabel(i.action)}</td>
                        <td className="center">
                          {i.status === "ok" ? (
                            <StatusTag kind="success">成功</StatusTag>
                          ) : (
                            <SkipTag>跳过</SkipTag>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {report.executed.length > 20 && (
                <p className="muted">仅展示前 20 条，共 {report.executed.length} 条。</p>
              )}
            </div>
          )}
          <footer className="wizard-footer">
            <button type="button" className="btn" onClick={props.onExit}>
              回到首页
            </button>
            {report && needsAdaptCount > 0 ? (
              <button type="button" className="btn btn-primary" onClick={goPathfixStep}>
                下一步：路径适配（{needsAdaptCount} 个文件需要）
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                disabled={executing}
                onClick={() => {
                  // 无适配需求时也落到路径适配步（其内为空状态说明），保持向导出口一致
                  if (report) goPathfixStep();
                }}
              >
                {report ? "下一步：路径适配" : "等待执行完成…"}
              </button>
            )}
          </footer>
        </div>
      )}

      {/* 第 6 步：路径适配（执行完成后，目标树已存在） */}
      {step === 5 && (
        <div className="stack">
          <div className="card stack">
            <div className="row">
              <h2 className="card-title" style={{ marginBottom: 0 }}>
                路径适配（旧机绝对路径 → 本机）
              </h2>
              {detecting && <StatusTag kind="info">正在检出…</StatusTag>}
            </div>
            <p className="secondary">
              文件已写入目标目录，现在检测其中的旧机绝对路径并逐条确认替换；只处理文本类文件，且替换前会先备份。
            </p>

            {needsAdaptCount === 0 && (
              <EmptyState
                title="本包无需路径适配"
                reason="迁移包内没有任何文件被标记为需要路径适配（不含旧机绝对路径的文本资产）。"
                nextStep="直接回到首页，本次解包已全部完成。"
              />
            )}

            {needsAdaptCount > 0 && detect && (
              <>
                <div className="table-shell">
                  <table className="data-table" aria-label="路径替换建议清单">
                    <thead>
                      <tr>
                        <th className="center">启用</th>
                        <th>旧机路径串</th>
                        <th>替换为（可编辑）</th>
                        <th className="num">命中数</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mappings.map((m) => (
                        <tr key={m.old}>
                          <td className="center">
                            <input
                              type="checkbox"
                              checked={m.enabled}
                              aria-label={`启用映射 ${m.old}`}
                              onChange={(e) =>
                                setMappings((prev) =>
                                  prev.map((x) =>
                                    x.old === m.old ? { ...x, enabled: e.target.checked } : x,
                                  ),
                                )
                              }
                            />
                          </td>
                          <td className="mono">{m.old}</td>
                          <td>
                            <input
                              className="inline-input"
                              value={m.new}
                              aria-label={`映射 ${m.old} 的新路径`}
                              onChange={(e) =>
                                setMappings((prev) =>
                                  prev.map((x) =>
                                    x.old === m.old ? { ...x, new: e.target.value } : x,
                                  ),
                                )
                              }
                            />
                          </td>
                          <td className="num">{m.total_hits}</td>
                        </tr>
                      ))}
                      {mappings.length === 0 && (
                        <tr>
                          <td colSpan={4} className="secondary">
                            未检出旧机绝对路径，无需适配。
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {detect.files.some((f) => f.skipped_reason) && (
                  <div className="table-shell">
                    <table className="data-table" aria-label="被跳过的文件">
                      <thead>
                        <tr>
                          <th>文件</th>
                          <th>跳过原因</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detect.files
                          .filter((f) => f.skipped_reason)
                          .map((f) => (
                            <tr key={f.target_rel}>
                              <td className="mono">{f.target_rel}</td>
                              <td>
                                <span
                                  className="field-error"
                                  style={{ color: "var(--color-warning)" }}
                                >
                                  <IconWarning size={14} /> {f.skipped_reason}
                                </span>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {pathfixReport && (
                  <Banner
                    kind="success"
                    title={`路径替换完成：${pathfixReport.replaced.length} 个文件已替换`}
                    onClose={() => setPathfixReport(null)}
                  >
                    {pathfixReport.backup_dir && `替换前已备份到 ${pathfixReport.backup_dir}。`}
                    {pathfixReport.skipped.length > 0 &&
                      `另有 ${pathfixReport.skipped.length} 个文件按规则跳过。`}
                  </Banner>
                )}

                {pathfixing && <ProgressBar progress={progress} idleText="正在执行路径替换…" />}

                {!pathfixReport && (
                  <div className="row">
                    <button
                      type="button"
                      className="btn"
                      disabled={enabledMappings.length === 0 || pathfixing}
                      onClick={() => setConfirmPathfix(true)}
                    >
                      确认并执行路径替换（{enabledMappings.length} 条映射）
                    </button>
                    <span className="muted">也可不做替换，直接回到首页结束。</span>
                  </div>
                )}
              </>
            )}
          </div>

          <footer className="wizard-footer">
            <button type="button" className="btn" onClick={() => setStep(4)}>
              上一步：查看执行报告
            </button>
            <button type="button" className="btn btn-primary" onClick={props.onExit}>
              完成，回到首页
            </button>
          </footer>
        </div>
      )}

      {/* 路径替换确认对话框（高风险动作） */}
      <ConfirmDialog
        open={confirmPathfix}
        title="确认执行路径替换？"
        danger
        points={[
          {
            label: "对象",
            text: `${enabledMappings.length} 条路径映射，作用于已写入目标目录的文本资产`,
          },
          {
            label: "影响",
            text: `预计替换 ${enabledMappings.reduce((s, m) => s + m.total_hits, 0)} 处旧机绝对路径`,
          },
          { label: "后果", text: "替换写入目标文件前会先备份；含 BOM 或非 UTF-8 的文件自动跳过" },
          { label: "目标状态", text: "文本资产中的旧机路径替换为本机路径，编码保持 UTF-8 无 BOM" },
        ]}
        confirmText="确认替换"
        onConfirm={doPathfix}
        onCancel={() => setConfirmPathfix(false)}
      />

      {/* 执行解包确认对话框（高风险动作） */}
      <ConfirmDialog
        open={confirmApply}
        title="确认执行解包计划？"
        danger={groups.replace.length > 0}
        points={[
          {
            label: "目标根目录",
            text: targetRoot,
          },
          {
            label: "对象",
            text: `迁移包 ${plan?.items.length ?? 0} 个文件的 dry-run 计划`,
          },
          {
            label: "影响",
            text: `新增 ${groups.create.length} 个、替换 ${groups.replace.length} 个（先备份）、跳过 ${groups.skip_same.length} 个、保留 ${groups.keep.length} 个`,
          },
          {
            label: "后果",
            text:
              groups.replace.length > 0
                ? "被替换的目标文件会先备份到 zam-backups，可从备份恢复；本操作不删除任何目标文件"
                : "只新增文件，不改动任何已有内容",
          },
          {
            label: "目标状态",
            text:
              mode === "overwrite"
                ? "目标目录内容与迁移包一致（冲突已备份替换）"
                : "目标目录补充迁移包新增内容，冲突文件按你的逐条选择处理",
          },
        ]}
        confirmText="确认执行"
        onConfirm={executeApply}
        onCancel={() => setConfirmApply(false)}
      />
    </section>
  );
}

function actionLabel(action: string): string {
  switch (action) {
    case "create":
      return "新增";
    case "skip_same":
      return "一致跳过";
    case "replace":
      return "备份后替换";
    case "keep":
      return "保留目标";
    default:
      return action;
  }
}

/** 普通计划行列表（新增/跳过组）。 */
function ItemList(props: {
  items: { target_rel: string; size: number }[];
  empty: string;
}) {
  if (props.items.length === 0) return <p className="muted">{props.empty}</p>;
  return (
    <div className="table-shell">
      <table className="data-table">
        <tbody>
          {props.items.slice(0, 10).map((i) => (
            <tr key={i.target_rel}>
              <td className="mono">{i.target_rel}</td>
              <td className="num">{formatBytes(i.size)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {props.items.length > 10 && (
        <p className="muted" style={{ padding: "var(--space-2) var(--space-4)" }}>
          仅展示前 10 条，共 {props.items.length} 条。
        </p>
      )}
    </div>
  );
}

/** 冲突组行列表：每行带「保留目标 / 备份后替换」分段切换，改判触发重新 plan。 */
function ConflictList(props: {
  items: { target_rel: string; size: number }[];
  toReplace: boolean;
  onChange: (targetRel: string, toReplace: boolean) => void;
  empty: string;
}) {
  if (props.items.length === 0) return <p className="muted">{props.empty}</p>;
  return (
    <div className="table-shell">
      <table className="data-table">
        <tbody>
          {props.items.map((i) => (
            <tr key={i.target_rel}>
              <td className="mono">{i.target_rel}</td>
              <td className="num">{formatBytes(i.size)}</td>
              <td>
                <div
                  className="segmented"
                  role="group"
                  aria-label={`冲突文件 ${i.target_rel} 的处理方式`}
                >
                  <button
                    type="button"
                    aria-pressed={!props.toReplace}
                    onClick={() => props.onChange(i.target_rel, false)}
                  >
                    保留目标
                  </button>
                  <button
                    type="button"
                    aria-pressed={props.toReplace}
                    onClick={() => props.onChange(i.target_rel, true)}
                  >
                    备份后替换
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
