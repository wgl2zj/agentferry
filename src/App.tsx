// 应用根组件：左侧导航边栏 + 右侧内容区的全局骨架，状态路由四个页面。
import { useState } from "react";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/app.css";
import { ToastProvider } from "./components/Toast";
import { IconHome, IconPack, IconSettings, IconUnpack } from "./components/icons";
import { HomePage } from "./pages/HomePage";
import { PackWizard } from "./pages/PackWizard";
import { UnpackWizard } from "./pages/UnpackWizard";
import { SettingsPage } from "./pages/SettingsPage";

export type Route = "home" | "pack" | "unpack" | "settings";

const NAV: { id: Route; label: string; icon: (p: { size?: number }) => React.ReactNode }[] = [
  { id: "home", label: "首页", icon: (p) => <IconHome {...p} /> },
  { id: "pack", label: "打包", icon: (p) => <IconPack {...p} /> },
  { id: "unpack", label: "解包", icon: (p) => <IconUnpack {...p} /> },
  { id: "settings", label: "设置", icon: (p) => <IconSettings {...p} /> },
];

function App() {
  const [route, setRoute] = useState<Route>("home");
  // 向导从首页/导航重新进入时重置内部状态（key 变化触发重挂载）
  const [wizardEpoch, setWizardEpoch] = useState(0);
  const navigate = (r: Route) => {
    if (r === route) return;
    setWizardEpoch((n) => n + 1);
    setRoute(r);
  };

  return (
    <ToastProvider>
      <div className="app-shell">
        <nav className="sidebar" aria-label="主导航">
          <div className="brand">
            <span className="brand-name">资产摆渡</span>
            <span className="brand-sub">AgentFerry</span>
          </div>
          <ul className="nav-list">
            {NAV.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="nav-item"
                  aria-current={route === item.id ? "page" : undefined}
                  onClick={() => navigate(item.id)}
                >
                  {item.icon({ size: 18 })}
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <main className="content">
          {route === "home" && <HomePage onNavigate={navigate} />}
          {route === "pack" && (
            <PackWizard key={`pack-${wizardEpoch}`} onExit={() => navigate("home")} />
          )}
          {route === "unpack" && (
            <UnpackWizard key={`unpack-${wizardEpoch}`} onExit={() => navigate("home")} />
          )}
          {route === "settings" && <SettingsPage />}
        </main>
      </div>
    </ToastProvider>
  );
}

export default App;
