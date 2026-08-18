// 打包向导 4 步：选择档案 → 盘点结果 → 档位与输出 → 执行打包与报告。
// 所有后端调用经 mock-aware 的 apiCall/useProgress；消息走四通道（横幅/Toast/弹窗/行内）。
// 类别名称与档位判定唯一数据源：list_profiles 返回的 ProfileSummary.categories（禁止硬编码）。
import { useEffect, useMemo, useRef, useState } from "react";
import {
  COMMANDS,
  type AppErrorPayload,
  type CategoryReport,
  type PackResult,
  type ProfileSummary,
  type ProgressPayload,
  type ScanReport,
} from "../lib/ipc";
import { apiCall, pickDirectory, useProgress } from "../lib/mock";
import { formatBytes } from "../lib/format";
import { Banner } from "../components/Banner";
import { WizardSteps } from "../components/WizardSteps";
import { ProgressBar } from "../components/ProgressBar";
import { StatusTag, SkipTag } from "../components/StatusTag";
import { useToast } from "../components/Toast";
import { IconWarning } from "../components/icons";
import { addHistory } from "../components/history";
import { joinPath } from "../components/paths";
import {
  categoryLabel,
  excludedCategories,
  fullIds,
  recommendedIds,
  type PresetKind,
} from "../components/categoryNames";

const STEPS = ["选择档案", "盘点结果", "档位与输出", "执行打包"];

/** 建议文件名按档案动态生成：`<档案id>-迁移包-<日期>.zam`（档案 id 即 zcode/codex/claude 小写形式）。 */
function suggestedFileName(profileId: string): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(
    d.getDate(),
  ).padStart(2, "0")}`;
  return `${profileId}-迁移包-${ymd}.zam`;
}

function isAppError(e: unknown): e is AppErrorPayload {
  return typeof e === "object" && e !== null && "code" in e && "message" in e;
}

export function PackWizard(props: { onExit: () => void }) {
  const toast = useToast();
  const [step, setStep] = useState(0);

  // 第 1 步：档案与根目录
  const [profiles, setProfiles] = useState<ProfileSummary[] | null>(null);
  const [profilesError, setProfilesError] = useState<string | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [root, setRoot] = useState("");

  // 第 2 步：盘点
  const [scan, setScan] = useState<ScanReport | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());

  // 第 3 步：档位与输出
  const [preset, setPreset] = useState<PresetKind>("recommended");
  const [customSel, setCustomSel] = useState<Set<string>>(new Set());
  const [outputPath, setOutputPath] = useState("");
  /** 输出路径被手动编辑过后不再跟随档案切换重生成（浏览改目录不算手动编辑文件名）。 */
  const [outputDirty, setOutputDirty] = useState(false);
  const [outputError, setOutputError] = useState<string | null>(null);

  // 第 4 步：执行
  const [progress, setProgress] = useState<ProgressPayload | null>(null);
  const [packing, setPacking] = useState(false);
  const [result, setResult] = useState<PackResult | null>(null);
  const [packError, setPackError] = useState<AppErrorPayload | null>(null);
  const startedRef = useRef(false);

  useProgress((p) => {
    if (p.task === "pack") setProgress(p);
  });

  /** 当前选中档案：默认取列表第一个；类别表/默认根/版本号/包名全部跟随它。 */
  const profile = useMemo(
    () => profiles?.find((p) => p.id === selectedProfileId) ?? profiles?.[0] ?? null,
    [profiles, selectedProfileId],
  );
  // 供挂载期异步回调读取当前档案（listProfiles/loadSettings 两个 Promise 谁先返回不定）
  const profileRef = useRef<ProfileSummary | null>(null);
  profileRef.current = profile;

  // 进入向导即加载档案列表与默认输出目录
  useEffect(() => {
    let disposed = false;
    apiCall<ProfileSummary[]>(COMMANDS.listProfiles)
      .then((list) => {
        if (disposed) return;
        setProfiles(list);
        if (list[0]) setRoot(list[0].default_root);
      })
      .catch((e: unknown) => {
        if (disposed) return;
        setProfilesError(isAppError(e) ? e.message : "加载档案列表失败");
      });
    apiCall<{ default_output_dir: string }>(COMMANDS.loadSettings)
      .then((s) => {
        if (disposed) return;
        // 默认目录为空时只预填文件名，避免拼到盘根；非空用正斜杠拼接
        setOutputPath(
          joinPath(
            s.default_output_dir,
            suggestedFileName(profileRef.current?.id ?? "zcode"),
          ),
        );
      })
      .catch(() => {
        if (!disposed)
          setOutputPath(suggestedFileName(profileRef.current?.id ?? "zcode"));
      });
    return () => {
      disposed = true;
    };
  }, []);

  /** 档案类别表：类别名/档位/排除的唯一数据源 */
  const categoryTable = useMemo(() => profile?.categories ?? [], [profile]);

  /** 切换档案：类别表/默认根/盘点结果/自定义勾选全部跟随刷新；
   *  输出文件名未被手动编辑过时，保留目录部分、按新档案重生成建议名。 */
  const switchProfile = (id: string) => {
    const next = profiles?.find((p) => p.id === id);
    if (!next || next.id === profile?.id) return;
    setSelectedProfileId(next.id);
    setRoot(next.default_root);
    setScan(null);
    setScanError(null);
    setSkipped(new Set());
    setCustomSel(new Set());
    if (!outputDirty) {
      setOutputPath((prev) => {
        const dir = prev.includes("/") ? prev.slice(0, prev.lastIndexOf("/")) : "";
        return joinPath(dir, suggestedFileName(next.id));
      });
    }
  };

  const runScan = () => {
    if (!profile) return;
    setScanning(true);
    setScanError(null);
    apiCall<ScanReport>(COMMANDS.scanAssets, { profileId: profile.id, root })
      .then((report) => {
        setScan(report);
        // 重新检测后，之前"跳过"的类别若已恢复 ready，则清掉跳过标记
        setSkipped((prev) => {
          const next = new Set(prev);
          for (const c of report.categories) {
            if (c.status.status === "ready") next.delete(c.category_id);
          }
          return next;
        });
      })
      .catch((e: unknown) => {
        setScanError(isAppError(e) ? e.message : "扫描失败，请检查根目录是否正确");
      })
      .finally(() => setScanning(false));
  };

  const goStep2 = () => {
    setStep(1);
    if (!scan) runScan();
  };

  const blockedCategories = useMemo(
    () =>
      (scan?.categories ?? []).filter(
        (c) => c.status.status === "blocked" && !skipped.has(c.category_id),
      ),
    [scan, skipped],
  );

  const skipBlocked = (c: CategoryReport) => {
    setSkipped((prev) => new Set(prev).add(c.category_id));
    toast.info(
      `已跳过「${categoryLabel(categoryTable, c.category_id)}」，该选择会记入迁移包的警告清单。`,
    );
  };

  /** 排除类（永不迁移）的 id 集合，来自档案 tier === "excluded"。 */
  const excludedIds = useMemo(
    () => new Set(excludedCategories(categoryTable).map((c) => c.id)),
    [categoryTable],
  );

  const readyCategories = useMemo(
    () =>
      (scan?.categories ?? []).filter(
        (c) => c.status.status === "ready" && !excludedIds.has(c.category_id),
      ),
    [scan, excludedIds],
  );

  /** 当前档位按档案 tier 应包含的类别（不考虑 ready 与否，用于 warnings 补记）。 */
  const presetWantedIds = useMemo(() => {
    if (preset === "recommended") return recommendedIds(categoryTable);
    if (preset === "full") return fullIds(categoryTable);
    return [...customSel];
  }, [preset, categoryTable, customSel]);

  // 当前档位下实际入包的类别（ready 且非排除）
  const selectedCategories = useMemo(() => {
    const readyIds = readyCategories.map((c) => c.category_id);
    if (preset === "custom") return readyIds.filter((id) => customSel.has(id));
    return readyIds.filter((id) => presetWantedIds.includes(id));
  }, [preset, readyCategories, customSel, presetWantedIds]);

  /** 选中类别携带的档案级打包警告（pack_warning 来自 list_profiles 类别数据，
   *  与 manifest.warnings 同源；前端只展示数据字符串，不手写文案）。 */
  const packWarnings = useMemo(() => {
    const byId = new Map(categoryTable.map((c) => [c.id, c.pack_warning]));
    const seen = new Set<string>();
    const list: string[] = [];
    for (const id of selectedCategories) {
      const w = byId.get(id);
      if (w && !seen.has(w)) {
        seen.add(w);
        list.push(w);
      }
    }
    return list;
  }, [selectedCategories, categoryTable]);

  /** 警告清单：显式跳过的阻断类 + 档位应含但因阻断未入包的类别（与横幅承诺一致）。 */
  const warnings = useMemo(() => {
    const list: string[] = [];
    for (const c of scan?.categories ?? []) {
      if (c.status.status !== "blocked") continue;
      const name = categoryLabel(categoryTable, c.category_id);
      if (skipped.has(c.category_id)) {
        list.push(`已按用户选择跳过被阻断的类别「${name}」`);
      } else if (presetWantedIds.includes(c.category_id)) {
        list.push(`「${name}」因源程序未完全退出被跳过，未入包`);
      }
    }
    return list;
  }, [scan, skipped, presetWantedIds, categoryTable]);

  /** 弹系统目录选择框选输出目录；选中后拼回建议文件名（取消不改动）。 */
  const browseOutput = async () => {
    const dir = await pickDirectory(outputPath);
    if (dir) {
      setOutputPath(joinPath(dir, suggestedFileName(profile?.id ?? "zcode")));
      setOutputError(null);
      // 只改了目录、文件名仍是建议名 → 继续跟随档案切换
      setOutputDirty(false);
    }
  };

  const startPack = () => {
    if (!profile || !scan) return;
    if (!outputPath.trim()) {
      setOutputError("输出路径不能为空");
      return;
    }
    if (selectedCategories.length === 0) {
      toast.warning("当前档位没有选中任何可迁移类别，请调整档位或勾选类别。");
      return;
    }
    setStep(3);
    if (startedRef.current) return;
    startedRef.current = true;
    setPacking(true);
    setPackError(null);
    apiCall<PackResult>(COMMANDS.packAssets, {
      profileId: profile.id,
      root,
      categories: selectedCategories,
      presetKind: preset,
      outputPath,
      warnings,
    })
      .then((r) => {
        setResult(r);
        addHistory({
          kind: "pack",
          summary: `打包完成：${r.manifest.counts.files} 个文件 · ${formatBytes(r.package_bytes)}`,
          location: r.output_path,
        });
        toast.success(`迁移包已生成：${r.output_path}`);
      })
      .catch((e: unknown) => {
        setPackError(isAppError(e) ? e : { code: "internal", message: "打包失败" });
      })
      .finally(() => setPacking(false));
  };

  const resetWizard = () => {
    setStep(0);
    setScan(null);
    setSkipped(new Set());
    setResult(null);
    setProgress(null);
    setPackError(null);
    startedRef.current = false;
  };

  return (
    <section className="page" aria-labelledby="pack-title">
      <header className="page-head">
        <h1 id="pack-title">打包：把本机资产打成迁移包</h1>
        <p className="page-head-desc">
          扫描 → 盘点 → 选档位 → 生成 .zam 迁移包。源目录全程只读，凭据与可再生缓存永不入包。
        </p>
      </header>

      <WizardSteps steps={STEPS} current={step} />

      {step === 0 && (
        <div className="stack">
          {profilesError && (
            <Banner kind="danger" title="档案列表加载失败" onClose={() => setProfilesError(null)}>
              {profilesError}
            </Banner>
          )}
          <div className="card stack">
            <div className="field">
              <label className="field-label" htmlFor="pack-profile">
                资产档案
              </label>
              <select
                id="pack-profile"
                className="input"
                value={profile?.id ?? ""}
                disabled={!profiles}
                onChange={(e) => switchProfile(e.target.value)}
              >
                {(profiles ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.display_name}（{p.category_count} 类）
                  </option>
                ))}
              </select>
              <p className="field-hint">
                选择要迁移哪一款 agent 软件的资产；切换后类别表、默认根目录与盘点结果全部跟随刷新。
              </p>
            </div>
            {profile ? (
              <>
                <div className="row">
                  <h2 className="card-title" style={{ marginBottom: 0 }}>
                    {profile.display_name} 资产档案
                  </h2>
                  <StatusTag kind="info">v{profile.version}</StatusTag>
                </div>
                <dl className="kv-grid">
                  <div className="kv-item">
                    <dt>覆盖类别</dt>
                    <dd>{profile.category_count} 类</dd>
                  </div>
                  <div className="kv-item">
                    <dt>默认根目录</dt>
                    <dd className="mono">{profile.default_root}</dd>
                  </div>
                </dl>
              </>
            ) : (
              !profilesError && <p className="secondary">正在加载资产档案…</p>
            )}
            <div className="field">
              <label className="field-label" htmlFor="pack-root">
                资产根目录
              </label>
              <input
                id="pack-root"
                className="input input-mono"
                value={root}
                onChange={(e) => setRoot(e.target.value)}
              />
              <p className="field-hint">默认取档案登记的根目录，一般无需修改。</p>
            </div>
          </div>
          <footer className="wizard-footer">
            <button type="button" className="btn" onClick={props.onExit}>
              返回首页
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!profile || !root.trim()}
              onClick={goStep2}
            >
              下一步：扫描盘点
            </button>
          </footer>
        </div>
      )}

      {step === 1 && (
        <div className="stack">
          {blockedCategories.map((c) => (
            <Banner
              key={c.category_id}
              kind="warning"
              title={`「${categoryLabel(categoryTable, c.category_id)}」暂时无法打包`}
              actions={
                <>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={runScan}
                    disabled={scanning}
                  >
                    我已退出，重新检测
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => skipBlocked(c)}
                  >
                    跳过该库继续
                  </button>
                </>
              }
            >
              {c.status.status === "blocked" ? c.status.detail : ""}
              请先完全退出 {profile?.display_name ?? "源程序"}{" "}
              再重新检测；或跳过该库，其余资产照常打包（会记入警告清单）。
            </Banner>
          ))}
          {scanError && (
            <Banner kind="danger" title="扫描失败" onClose={() => setScanError(null)}>
              {scanError}
            </Banner>
          )}

          <div className="table-shell">
            <table className="data-table">
              <thead>
                <tr>
                  <th>类别</th>
                  <th className="num">文件数</th>
                  <th className="num">体量</th>
                  <th className="center">状态</th>
                </tr>
              </thead>
              <tbody>
                {(scan?.categories ?? []).map((c) => {
                  const excluded = excludedIds.has(c.category_id);
                  return (
                    <tr
                      key={c.category_id}
                      className={excluded ? "check-row-disabled" : undefined}
                    >
                      <td>{categoryLabel(categoryTable, c.category_id)}</td>
                      <td className="num">{c.files.length > 0 ? c.files.length : "—"}</td>
                      <td className="num">
                        {c.files.length > 0 ? formatBytes(c.total_bytes) : "—"}
                      </td>
                      <td className="center">
                        {excluded && <SkipTag>不迁移</SkipTag>}
                        {!excluded && c.status.status === "ready" && (
                          <StatusTag kind="success">可迁移</StatusTag>
                        )}
                        {!excluded &&
                          c.status.status === "blocked" &&
                          (skipped.has(c.category_id) ? (
                            <SkipTag>已跳过</SkipTag>
                          ) : (
                            <StatusTag kind="warning">已阻断</StatusTag>
                          ))}
                        {!excluded && c.status.status === "missing" && (
                          <SkipTag>本机不存在</SkipTag>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {scan === null && (
                  <tr>
                    <td colSpan={4} className="secondary">
                      {scanning ? "正在扫描资产目录…" : "等待扫描"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h2 className="card-title">以下内容不迁移</h2>
            <div className="check-list">
              {excludedCategories(categoryTable).map((c) => (
                <div key={c.id} className="check-row check-row-disabled">
                  <SkipTag>不迁移</SkipTag>
                  <span className="check-row-label">{c.display_name}</span>
                  <span className="muted">{c.description}</span>
                </div>
              ))}
            </div>
          </div>

          <footer className="wizard-footer">
            <button type="button" className="btn" onClick={() => setStep(0)}>
              上一步
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!scan || scanning}
              onClick={() => setStep(2)}
            >
              下一步：选择档位与输出
            </button>
          </footer>
        </div>
      )}

      {step === 2 && (
        <div className="stack">
          {blockedCategories.length > 0 && (
            <Banner kind="warning" title="仍有类别处于阻断状态">
              「{blockedCategories.map((c) => categoryLabel(categoryTable, c.category_id)).join("、")}
              」不会入包，且会记入警告清单。如需打包，请返回上一步处理。
            </Banner>
          )}
          {packWarnings.length > 0 && (
            <Banner kind="warning" title="凭据随包迁移提醒">
              <ul className="warn-list">
                {packWarnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
              不需要时可改用自定义档位，取消勾选对应类别。
            </Banner>
          )}
          <div className="card stack">
            <h2 className="card-title">打包档位</h2>
            <div className="choice-grid" role="group" aria-label="打包档位">
              <button
                type="button"
                className="choice-card"
                aria-pressed={preset === "recommended"}
                onClick={() => setPreset("recommended")}
              >
                <span className="choice-card-title">推荐（纯资产）</span>
                <span className="choice-card-desc">
                  档案标记为推荐档的 {recommendedIds(categoryTable).length}{" "}
                  个类别，约 1MB，换机必带。
                </span>
              </button>
              <button
                type="button"
                className="choice-card"
                aria-pressed={preset === "full"}
                onClick={() => setPreset("full")}
              >
                <span className="choice-card-title">完整（含会话历史）</span>
                <span className="choice-card-desc">
                  全部 {fullIds(categoryTable).length}{" "}
                  个可迁移类别，追加会话历史等，可能达数百 MB；打包前需完全退出{" "}
                  {profile?.display_name ?? "源程序"}。
                </span>
              </button>
              <button
                type="button"
                className="choice-card"
                aria-pressed={preset === "custom"}
                onClick={() => setPreset("custom")}
              >
                <span className="choice-card-title">自定义</span>
                <span className="choice-card-desc">逐个类别勾选，完全由你决定带什么。</span>
              </button>
            </div>

            {preset === "custom" && (
              <fieldset className="check-list" style={{ border: "none", padding: 0, margin: 0 }}>
                <legend className="field-label">勾选要打包的类别</legend>
                {(scan?.categories ?? [])
                  .filter((c) => !excludedIds.has(c.category_id))
                  .map((c) => {
                    const ready = c.status.status === "ready";
                    const checked = customSel.has(c.category_id);
                    return (
                      <label
                        key={c.category_id}
                        className={`check-row${ready ? "" : " check-row-disabled"}`}
                      >
                        <input
                          type="checkbox"
                          disabled={!ready}
                          checked={ready && checked}
                          onChange={(e) => {
                            setCustomSel((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(c.category_id);
                              else next.delete(c.category_id);
                              return next;
                            });
                          }}
                        />
                        <span className="check-row-label">
                          {categoryLabel(categoryTable, c.category_id)}
                        </span>
                        {!ready && (
                          <span className="muted">
                            {c.status.status === "blocked" ? "已阻断，不可选" : "本机不存在"}
                          </span>
                        )}
                      </label>
                    );
                  })}
              </fieldset>
            )}

            <p className="secondary">
              将打包 {selectedCategories.length} 个类别：
              {selectedCategories.map((id) => categoryLabel(categoryTable, id)).join("、") ||
                "（未选择）"}
            </p>

            <div className="field">
              <label className="field-label" htmlFor="pack-output">
                迁移包输出路径
              </label>
              <div className="input-group">
                <input
                  id="pack-output"
                  className="input input-mono"
                  value={outputPath}
                  aria-invalid={outputError ? true : undefined}
                  aria-describedby={outputError ? "pack-output-error" : undefined}
                  onChange={(e) => {
                    setOutputPath(e.target.value);
                    setOutputDirty(true);
                    if (e.target.value.trim()) setOutputError(null);
                  }}
                />
                <button type="button" className="btn" onClick={browseOutput}>
                  浏览…
                </button>
              </div>
              {outputError && (
                <p className="field-error" id="pack-output-error" role="alert">
                  <IconWarning size={14} /> {outputError}
                </p>
              )}
              <p className="field-hint">默认取设置页的「默认输出目录」，可改到 U 盘或同步盘。</p>
            </div>
          </div>

          <footer className="wizard-footer">
            <button type="button" className="btn" onClick={() => setStep(1)}>
              上一步
            </button>
            <button type="button" className="btn btn-primary" onClick={startPack}>
              开始打包
            </button>
          </footer>
        </div>
      )}

      {step === 3 && (
        <div className="stack">
          {packError && (
            <Banner
              kind="danger"
              title={`打包失败（${packError.code}）`}
              onClose={() => setPackError(null)}
              actions={
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    startedRef.current = false;
                    setStep(2);
                  }}
                >
                  返回修改
                </button>
              }
            >
              {packError.message}
            </Banner>
          )}
          {!result && (
            <div className="card stack">
              <h2 className="card-title">正在打包</h2>
              <ProgressBar progress={progress} idleText="正在准备打包任务…" />
            </div>
          )}
          {result && (
            <div className="card stack">
              <div className="row">
                <h2 className="card-title" style={{ marginBottom: 0 }}>
                  打包完成
                </h2>
                <StatusTag kind="success">成功</StatusTag>
              </div>
              <dl className="kv-grid">
                <div className="kv-item">
                  <dt>入包文件数</dt>
                  <dd>{result.manifest.counts.files} 个</dd>
                </div>
                <div className="kv-item">
                  <dt>包大小</dt>
                  <dd>{formatBytes(result.package_bytes)}</dd>
                </div>
                <div className="kv-item">
                  <dt>覆盖类别</dt>
                  <dd>{result.manifest.counts.categories} 类</dd>
                </div>
                <div className="kv-item">
                  <dt>迁移包路径</dt>
                  <dd className="mono">{result.output_path}</dd>
                </div>
              </dl>
              {result.manifest.warnings.length > 0 && (
                <div>
                  <h3 className="card-sub" style={{ marginBottom: "var(--space-2)" }}>
                    警告（{result.manifest.warnings.length} 条）
                  </h3>
                  <ul className="warn-list">
                    {result.manifest.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          <footer className="wizard-footer">
            <button type="button" className="btn" onClick={props.onExit}>
              回到首页
            </button>
            <button
              type="button"
              className="btn"
              disabled={packing}
              onClick={resetWizard}
            >
              再打一个包
            </button>
          </footer>
        </div>
      )}
    </section>
  );
}
