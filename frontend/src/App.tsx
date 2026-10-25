import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type PointerEvent,
} from "react";
import {
  Activity,
  Bell,
  Check,
  ChevronRight,
  CircleHelp,
  EthernetPort,
  FolderOpen,
  Download,
  Grid2X2,
  HardDrive,
  LockKeyhole,
  LogOut,
  Maximize2,
  Minus,
  Moon,
  MoreHorizontal,
  Network,
  Paintbrush,
  Phone,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sun,
  Terminal,
  Users,
  Wifi,
  X,
} from "lucide-react";
import {
  api,
  rec,
  text,
  internetConnected,
  wallpaperFile,
  loadServerWallpaper,
  type Session,
  type Snapshot,
  type Profile,
  type LogEntry,
  type AuthState,
} from "./api";
import { ArcherPanel, TopologyPanel, AdvancedNATPanel, MonitorPanel } from "./NetworkPanels";
import AuthGate from "./AuthGate";
import SharesPanel from "./SharesPanel";
import { BackupPanel, DiagnosticsPanel, StoragePanel } from "./ToolsPanels";
import {
  StatusPanel,
  DevicesPanel,
  SettingsPanel,
  PortsPanel,
  StatisticsPanel,
  CallsPanel,
  JournalPanel,
  ProfilesPanel,
  PersonalizationPanel,
} from "./Panels";

export type AppId =
  | "status"
  | "devices"
  | "settings"
  | "ports"
  | "stats"
  | "phone"
  | "journal"
  | "profiles"
  | "storage"
  | "diagnostics"
  | "backup"
  | "personalization" | "archer" | "topology" | "advanced-nat" | "monitor";
export const APPS: {
  id: AppId;
  name: string;
  short: string;
  description: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  color: string;
}[] = [
  { id: "topology", name: "Topologie réseau", short: "Topologie", description: "Les liens observés entre vos routeurs", icon: Network, color: "teal" },
  { id: "archer", name: "Archer AX58", short: "Archer AX58", description: "Connexion et données TP-Link", icon: Wifi, color: "blue" },
  { id: "advanced-nat", name: "NAT avancé", short: "NAT avancé", description: "Ouvrir un port sur les deux routeurs", icon: EthernetPort, color: "purple" },
  { id: "monitor", name: "Surveillance réseau", short: "Surveillance", description: "Observations et alertes", icon: Activity, color: "green" },
  {
    id: "status",
    name: "État de la Livebox",
    short: "Ma Livebox",
    description: "Votre connexion en un regard",
    icon: Activity,
    color: "orange",
  },
  {
    id: "devices",
    name: "Périphériques réseau",
    short: "Périphériques",
    description: "Les appareils de votre réseau",
    icon: Network,
    color: "blue",
  },
  {
    id: "settings",
    name: "Paramètres Livebox",
    short: "Paramètres",
    description: "Wi-Fi, DHCP et réseau local",
    icon: Settings2,
    color: "slate",
  },
  {
    id: "ports",
    name: "Gestion des ports",
    short: "Ports NAT / PAT",
    description: "Les règles de redirection",
    icon: EthernetPort,
    color: "purple",
  },
  {
    id: "stats",
    name: "Statistiques",
    short: "Statistiques",
    description: "L’activité de votre connexion",
    icon: Activity,
    color: "green",
  },
  {
    id: "phone",
    name: "Téléphone",
    short: "Téléphone",
    description: "Votre journal d’appels",
    icon: Phone,
    color: "pink",
  },
  {
    id: "journal",
    name: "Journal système",
    short: "Journal système",
    description: "Les événements de votre réseau",
    icon: Terminal,
    color: "teal",
  },
  {
    id: "profiles",
    name: "Profils",
    short: "Profils",
    description: "Vos configurations Livebox",
    icon: Users,
    color: "gold",
  },
  {
    id: "personalization",
    name: "Personnalisation",
    short: "Personnalisation",
    description: "Un bureau à votre image",
    icon: Paintbrush,
    color: "violet",
  },
  {
    id: "storage",
    name: "Explorateur de stockage",
    short: "Stockage USB",
    description: "Les supports USB de votre Livebox",
    icon: FolderOpen,
    color: "gold",
  },
  {
    id: "diagnostics",
    name: "Diagnostic réseau",
    short: "Diagnostic",
    description: "Ping, DNS et état de la communication",
    icon: ShieldCheck,
    color: "blue",
  },
  {
    id: "backup",
    name: "Sauvegarde",
    short: "Sauvegarde",
    description: "Exporter et restaurer Livebox OS",
    icon: Download,
    color: "slate",
  },
];
export type Preferences = {
  theme: "light" | "dark";
  wallpaper: string;
  fit: "cover" | "contain" | "center";
  blur: number;
};
type WindowState = {
  id: AppId;
  x: number;
  y: number;
  z: number;
  minimized: boolean;
  maximized: boolean;
};
export type ChangeRequest = { kind: string; values: Record<string, unknown> };
type Prepared = {
  token: string;
  warning: string;
  values: Record<string, unknown>;
};
const defaults: Preferences = {
  theme: "light",
  wallpaper: "signature",
  fit: "cover",
  blur: 0,
};
function initialPreferences(): Preferences {
  try {
    const p = JSON.parse(localStorage.getItem("orange-preferences") || "{}");
    return {
      theme: p.theme === "dark" ? "dark" : "light",
      wallpaper: ["signature", "dune", "night", "custom"].includes(p.wallpaper)
        ? p.wallpaper
        : "signature",
      fit: ["cover", "contain", "center"].includes(p.fit) ? p.fit : "cover",
      blur: Math.min(20, Math.max(0, Number(p.blur) || 0)),
    };
  } catch {
    return defaults;
  }
}

export default function App() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [session, setSession] = useState<Session>({ connected: false });
  const [snapshot, setSnapshot] = useState<Snapshot>({});
  const [events, setEvents] = useState<LogEntry[]>([]);
  const [windows, setWindows] = useState<WindowState[]>([]);
  const [preferences, setPreferences] =
    useState<Preferences>(initialPreferences);
  const [image, setImage] = useState("");
  const [clock, setClock] = useState(new Date());
  const [login, setLogin] = useState<Profile | null>(null);
  const [launcher, setLauncher] = useState(false);
  const [query, setQuery] = useState("");
  const [notifications, setNotifications] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [toast, setToast] = useState("");
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [revision, setRevision] = useState(0);
  const [stream, setStream] = useState(false);
  const [backend, setBackend] = useState(true);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const savedPreferences = useRef('');
  const z = useRef(10);
  const drag = useRef<{ id: AppId; dx: number; dy: number } | null>(null);

  function notify(message: string) {
    setToast(message);
  }
  const checkAuth = () =>
    api<AuthState>("/auth/state")
      .then(setAuth)
      .catch(() => {
        setAuth(null);
        setBackend(false);
      });
  useEffect(() => {
    checkAuth();
  }, []);
  useEffect(() => {
    if (auth?.authenticated)
      api<Session>("/session")
        .then(setSession)
        .catch(() => setBackend(false));
  }, [auth?.authenticated]);
  useEffect(() => {
    if (!auth?.authenticated) {
      setPreferencesLoaded(false);
      return;
    }
    let alive = true;
    api<Partial<Preferences>>("/preferences")
      .then(async (saved) => {
        if (!alive) return;
        if (saved.theme) {
          savedPreferences.current = JSON.stringify(saved);
          setPreferences(saved as Preferences);
        }
        const blob = await loadServerWallpaper();
        if (blob && alive) {
          await wallpaperFile(blob);
          setImage(URL.createObjectURL(blob));
        } else if (alive) {
          const localImage = await wallpaperFile();
          if (localImage) await api('/wallpaper', localImage, 'PUT');
        }
        if (alive) setPreferencesLoaded(true);
      })
      .catch((e) => {
        if (alive) {
          notify(e.message);
          setPreferencesLoaded(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [auth?.authenticated]);
  useEffect(() => {
    if (!auth?.authenticated || !preferencesLoaded) return;
    const serialized = JSON.stringify(preferences);
    if (serialized === savedPreferences.current) return;
    const timer = setTimeout(
      () =>
        api("/preferences", preferences, "PUT")
          .then(() => { savedPreferences.current = serialized; })
          .catch((e) => notify(e.message)),
      600,
    );
    return () => clearTimeout(timer);
  }, [preferences, preferencesLoaded, auth?.authenticated]);
  useEffect(() => {
    const expired = (event: Event) => {
      const code = (event as CustomEvent).detail;
      setSession({ connected: false });
      setSnapshot({});
      setEvents([]);
      if (code === "APP_AUTH_REQUIRED") {
        setAuth((s) => (s ? { ...s, authenticated: false } : null));
        setWindows([]);
      } else notify("La session Livebox a expiré. Reconnectez votre Livebox.");
    };
    window.addEventListener("orange-session-expired", expired);
    return () => window.removeEventListener("orange-session-expired", expired);
  }, []);
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 6500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    try {
      localStorage.setItem("orange-preferences", JSON.stringify(preferences));
    } catch {
      notify(
        "Les préférences ne peuvent pas être enregistrées dans ce navigateur.",
      );
    }
  }, [preferences]);
  useEffect(() => {
    wallpaperFile()
      .then((blob) => {
        if (blob) setImage(URL.createObjectURL(blob));
      })
      .catch(() => {});
  }, []);
  useEffect(
    () => () => {
      if (image) URL.revokeObjectURL(image);
    },
    [image],
  );
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenu(null);
        setLauncher(false);
        setNotifications(false);
        if (!confirming) setPrepared(null);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [confirming]);
  useEffect(() => {
    if (!session.connected) {
      setSnapshot({});
      setStream(false);
      return;
    }
    let stopped = false;
    let socket: WebSocket;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      socket = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws`,
      );
      socket.onopen = () => {
        if (!stopped) setStream(true);
      };
      socket.onmessage = (e) => {
        try {
          const data: Snapshot = JSON.parse(e.data);
          if (data.updated) setSnapshot(data);
          if (data.events) setEvents(data.events);
        } catch {
          /* Ignore malformed frames. */
        }
      };
      socket.onclose = () => {
        if (stopped) return;
        setStream(false);
        api<AuthState>("/auth/state")
          .then((state) => {
            if (!stopped) setAuth(state);
            return api<Session>("/session");
          })
          .then((s) => {
            if (!stopped) {
              setSession(s);
              if (s.connected) retry = setTimeout(connect, 5000);
            }
          })
          .catch(() => {
            if (!stopped) retry = setTimeout(connect, 5000);
          });
      };
    };
    api<Snapshot>("/status")
      .then((d) => {
        if (!stopped) setSnapshot(d);
      })
      .catch((e) => notify(e.message));
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      socket?.close();
    };
  }, [session.connected, session.url, revision]);

  const openApp = (id: AppId) => {
    setLauncher(false);
    setMenu(null);
    setWindows((current) =>
      current.some((w) => w.id === id)
        ? current.map((w) =>
            w.id === id ? { ...w, minimized: false, z: ++z.current } : w,
          )
        : [
            ...current,
            {
              id,
              x: Math.max(
                10,
                Math.min(window.innerWidth - 760, 180 + current.length * 25),
              ),
              y: 90 + (current.length % 5) * 24,
              minimized: false,
              maximized: false,
              z: ++z.current,
            },
          ],
    );
  };
  const focus = (id: AppId) =>
    setWindows((current) =>
      current.map((w) => (w.id === id ? { ...w, z: ++z.current } : w)),
    );
  const patchWindow = (id: AppId, patch: Partial<WindowState>) =>
    setWindows((current) =>
      current.map((w) => (w.id === id ? { ...w, ...patch } : w)),
    );
  const showLogin = (profile?: Profile) =>
    setLogin(
      profile || {
        name: "Ma Livebox",
        url: "http://192.168.1.1",
        username: "admin",
      },
    );
  const disconnected = (
    <div className="empty-state">
      <span className="empty-icon">
        <LockKeyhole size={28} />
      </span>
      <h3>Votre Livebox vous attend</h3>
      <p>
        Connectez-vous pour accéder aux informations réelles de votre réseau.
      </p>
      <button className="primary" onClick={() => showLogin()}>
        Connecter ma Livebox <ChevronRight size={16} />
      </button>
    </div>
  );
  async function requestChange(change: ChangeRequest) {
    try {
      setPrepared(await api<Prepared>("/changes/prepare", change));
    } catch (e) {
      notify((e as Error).message);
    }
  }
  async function confirmChange() {
    if (!prepared || confirming) return;
    setConfirming(true);
    try {
      const result = await api<{ message: string }>("/changes/confirm", {
        token: prepared.token,
      });
      notify(result.message);
      setRevision((r) => r + 1);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setPrepared(null);
      setConfirming(false);
    }
  }
  async function logout() {
    try {
      await api("/logout", {});
      await api("/auth/logout", {});
      setAuth((s) => (s ? { ...s, authenticated: false } : null));
      setSession({ connected: false });
      setEvents([]);
      notify("Session fermée.");
    } catch (e) {
      notify((e as Error).message);
    }
  }
  const connected = session.connected && internetConnected(snapshot);
  const info = rec(snapshot.info?.data);
  const panel = (id: AppId) => {
    if (id === "personalization")
      return (
        <PersonalizationPanel
          preferences={preferences}
          update={setPreferences}
          image={image}
          onImage={setImage}
          notify={notify}
        />
      );
    if (id === "profiles")
      return <ProfilesPanel connect={showLogin} notify={notify} revision={revision} />;
    if (id === "diagnostics") return <DiagnosticsPanel />;
    if (id === "backup")
      return (
        <BackupPanel
          restored={() => setRevision(value => value + 1)}
          preferences={preferences}
          update={setPreferences}
          onImage={setImage}
          notify={notify}
        />
      );
    if (id === "archer") return <ArcherPanel />;
    if (id === "topology") return <TopologyPanel />;
    if (id === "advanced-nat") return <AdvancedNATPanel />;
    if (id === "monitor") return <MonitorPanel />;
    if (id === "storage") return <><SharesPanel />{session.connected ? <StoragePanel revision={revision} /> : <div className="panel"><p>Connectez la Livebox pour consulter ses supports USB.</p></div>}</>;
    if (!session.connected) return disconnected;
    switch (id) {
      case "status":
        return (
          <StatusPanel snapshot={snapshot} session={session} open={openApp} />
        );
      case "devices":
        return <DevicesPanel revision={revision} />;
      case "settings":
        return <SettingsPanel revision={revision} change={requestChange} />;
      case "ports":
        return <PortsPanel revision={revision} change={requestChange} />;
      case "stats":
        return <StatisticsPanel snapshot={snapshot} />;
      case "phone":
        return <CallsPanel revision={revision} />;
      case "journal":
        return <JournalPanel entries={events} revision={revision} />;
    }
  };

  return (
    <main
      className={`os ${preferences.theme}`}
      onClick={() => menu && setMenu(null)}
    >
      <div
        className={`wallpaper wallpaper-${preferences.wallpaper === "custom" && !image ? "signature" : preferences.wallpaper}`}
        style={{
          filter: `blur(${preferences.blur}px)`,
          ...(preferences.wallpaper === "custom" && image
            ? {
                backgroundImage: `url(${image})`,
                backgroundSize:
                  preferences.fit === "center" ? "auto" : preferences.fit,
              }
            : {}),
        }}
      >
        <div className="orb orb-one" />
        <div className="orb orb-two" />
        <div className="wallpaper-lines" />
      </div>
      <div
        className="desktop-surface"
        onContextMenu={(e) => {
          if (
            !(e.target as HTMLElement).closest(
              ".os-window, button, .login-modal",
            )
          ) {
            e.preventDefault();
            setMenu({
              x: Math.min(e.clientX, innerWidth - 245),
              y: Math.min(e.clientY, innerHeight - 210),
            });
          }
        }}
      >
        <header className="desktop-header">
          <div className="brand">
            <img
              className="brand-logo"
              src="/livebox-logo.svg"
              alt="Logo Livebox OS 3.0"
            />
            <span className="brand-name">
              Livebox <b>OS</b>
              <small>VOTRE LIVEBOX, SIMPLEMENT.</small>
            </span>
            <span className="version">3.0</span>
          </div>
          <div className="header-right">
            <span className="local-badge">
              <ShieldCheck size={14} /> Espace local sécurisé
            </span>
            <button
              className="round-button"
              title="Changer de thème"
              aria-label="Changer de thème"
              onClick={() =>
                setPreferences((p) => ({
                  ...p,
                  theme: p.theme === "dark" ? "light" : "dark",
                }))
              }
            >
              {preferences.theme === "light" ? (
                <Moon size={18} />
              ) : (
                <Sun size={18} />
              )}
            </button>
            <span className="header-divider" />
            <button
              className="avatar"
              title="Profils Livebox"
              aria-label="Profils Livebox"
              onClick={() => openApp("profiles")}
            >
              M
            </button>
          </div>
        </header>
        <section className="desktop-intro">
          <span className="eyebrow">BIENVENUE CHEZ VOUS</span>
          <h1>
            Tout votre réseau.
            <br />
            <span>À portée de main.</span>
          </h1>
          <p>Un espace pour votre Livebox. Et tout ce qui s’y connecte.</p>
        </section>
        <section className="desktop-apps" aria-label="Applications Livebox OS">
          {APPS.map((app) => (
            <button
              className="desktop-app"
              key={app.id}
              onClick={() => openApp(app.id)}
              title={app.description}
            >
              <span className={`app-icon ${app.color}`}>
                <app.icon size={29} strokeWidth={1.7} />
              </span>
              <span>{app.name}</span>
              {windows.some((w) => w.id === app.id) && (
                <i className="app-running" />
              )}
            </button>
          ))}
        </section>
        <aside className="connection-widget">
          <div className="widget-heading">
            <span>
              <i className={`status-dot ${connected ? "online" : ""}`} />{" "}
              {connected
                ? "VOTRE LIVEBOX EST CONNECTÉE"
                : session.connected
                  ? "SESSION LIVEBOX OUVERTE"
                  : "VOTRE ESPACE LIVEBOX"}
            </span>
            <button
              className="icon-button"
              aria-label="Ouvrir l’état de la Livebox"
              onClick={() => openApp("status")}
            >
              <MoreHorizontal size={19} />
            </button>
          </div>
          <div className="router-scene">
            <div className="router-shadow" />
            <div className="router-box">
              <span className="router-grid" />
              <div className="router-face">
                <span className="router-label">Livebox</span>
                <div className="router-leds">
                  <i />
                  <i />
                  <i />
                </div>
                <span className="router-orange">orange</span>
              </div>
            </div>
            <div className="router-orbit orbit-a" />
            <div className="router-orbit orbit-b" />
            <span className="router-spark spark-a" />
            <span className="router-spark spark-b" />
          </div>
          <div className="widget-body">
            <span className="mini-label">VOTRE MAISON CONNECTÉE</span>
            <h2>
              {session.connected
                ? text(
                    info.ProductClass === "Livebox Fibre"
                      ? "Livebox 5"
                      : info.ProductClass,
                  )
                : "Faites comme chez vous."}
            </h2>
            <p>
              {session.connected
                ? `Profil ${session.name}. Retrouvez l’état et l’activité de votre réseau en temps réel.`
                : "Connectez votre Livebox pour retrouver votre réseau et tous vos appareils."}
            </p>
            <button
              className="primary wide"
              onClick={() =>
                session.connected ? openApp("status") : showLogin()
              }
            >
              {session.connected ? "Ouvrir ma Livebox" : "Connecter ma Livebox"}
              <ChevronRight size={17} />
            </button>
            <span className="privacy-note">
              <LockKeyhole size={11} /> Vos identifiants restent sur votre
              serveur local.
            </span>
          </div>
        </aside>
        <div className="desktop-footer">
          <span>
            <i className={`status-dot ${connected ? "online" : ""}`} />
            {!backend
              ? "Backend local indisponible"
              : session.connected
                ? stream
                  ? "Session active · actualisation en direct"
                  : "Session active · reconnexion du flux…"
                : "Prêt à se connecter"}
          </span>
          <button onClick={() => openApp("personalization")}>
            <Paintbrush size={13} /> Personnaliser mon bureau
          </button>
        </div>
      </div>
      {windows.map((win) => {
        const app = APPS.find((a) => a.id === win.id)!;
        return (
          <section
            key={win.id}
            aria-label={app.name}
            className={`os-window ${win.maximized ? "maximized" : ""}`}
            style={
              {
                "--window-x": `${win.x}px`,
                "--window-y": `${win.y}px`,
                zIndex: win.z,
                display: win.minimized ? "none" : undefined,
              } as CSSProperties
            }
            onPointerDown={() => focus(win.id)}
          >
            <div
              className="window-titlebar"
              onDoubleClick={() =>
                patchWindow(win.id, { maximized: !win.maximized })
              }
              onPointerDown={(e: PointerEvent<HTMLDivElement>) => {
                if (
                  (e.target as HTMLElement).closest("button") ||
                  win.maximized
                )
                  return;
                drag.current = {
                  id: win.id,
                  dx: e.clientX - win.x,
                  dy: e.clientY - win.y,
                };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (drag.current?.id === win.id)
                  patchWindow(win.id, {
                    x: Math.min(
                      innerWidth - 120,
                      Math.max(0, e.clientX - drag.current.dx),
                    ),
                    y: Math.min(
                      innerHeight - 140,
                      Math.max(0, e.clientY - drag.current.dy),
                    ),
                  });
              }}
              onPointerUp={() => {
                drag.current = null;
              }}
              onLostPointerCapture={() => {
                drag.current = null;
              }}
            >
              <span className={`title-icon ${app.color}`}>
                <app.icon size={16} />
              </span>
              <strong>{app.name}</strong>
              <div className="window-controls">
                <button
                  aria-label={`Réduire ${app.name}`}
                  onClick={() => patchWindow(win.id, { minimized: true })}
                >
                  <Minus size={16} />
                </button>
                <button
                  aria-label={`Agrandir ${app.name}`}
                  onClick={() =>
                    patchWindow(win.id, { maximized: !win.maximized })
                  }
                >
                  <Maximize2 size={13} />
                </button>
                <button
                  className="close-window"
                  aria-label={`Fermer ${app.name}`}
                  onClick={() =>
                    setWindows((w) => w.filter((a) => a.id !== win.id))
                  }
                >
                  <X size={17} />
                </button>
              </div>
            </div>
            <div className="window-content">{panel(win.id)}</div>
            <div className="window-status">
              <span>
                <i
                  className={`status-dot ${session.connected ? "online" : ""}`}
                />
                {win.id === "personalization"
                  ? "Préférences enregistrées sur cet appareil"
                  : session.connected
                    ? `${session.name} · ${session.url}`
                    : "Aucune Livebox connectée"}
              </span>
              <span>Livebox OS</span>
            </div>
          </section>
        );
      })}
      <nav className="taskbar" aria-label="Barre des tâches">
        <button
          className={`launcher-button ${launcher ? "selected" : ""}`}
          aria-label="Toutes les applications"
          onClick={() => {
            setLauncher(!launcher);
            setNotifications(false);
          }}
        >
          <Grid2X2 size={23} />
        </button>
        <span className="task-divider" />
        <div className="task-apps">
          {APPS.map((app) => (
            <button
              className={`task-app ${windows.some((w) => w.id === app.id && !w.minimized) ? "active" : ""}`}
              key={app.id}
              aria-label={app.name}
              title={app.name}
              onClick={() => {
                const win = windows.find((w) => w.id === app.id);
                if (
                  win &&
                  !win.minimized &&
                  win.z ===
                    Math.max(
                      ...windows.filter((w) => !w.minimized).map((w) => w.z),
                    )
                )
                  patchWindow(app.id, { minimized: true });
                else openApp(app.id);
              }}
            >
              <span className={`task-app-icon ${app.color}`}>
                <app.icon size={20} strokeWidth={1.8} />
              </span>
              {windows.some((w) => w.id === app.id) && <i />}
            </button>
          ))}
        </div>
        <div className="taskbar-right">
          <span className="task-divider" />
          <button
            className={`tray-connect ${connected ? "is-online" : ""}`}
            aria-label="Connexion Livebox"
            title={
              connected ? "Connexion Internet active" : "Connexion Livebox"
            }
            onClick={() =>
              session.connected ? openApp("status") : showLogin()
            }
          >
            <Wifi size={19} />
          </button>
          <button
            className="notification-button"
            aria-label="Notifications"
            onClick={() => {
              setNotifications(!notifications);
              setLauncher(false);
            }}
          >
            <Bell size={18} />
            {events.length > 0 && <i />}
          </button>
          <button
            className="task-clock"
            onClick={() => setNotifications(!notifications)}
          >
            <strong>
              {clock.toLocaleTimeString("fr-FR", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </strong>
            <span>
              {clock.toLocaleDateString("fr-FR", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
              })}
            </span>
          </button>
          <button
            className="show-desktop"
            aria-label="Afficher le bureau"
            onClick={() =>
              setWindows((w) => w.map((a) => ({ ...a, minimized: true })))
            }
          />
        </div>
      </nav>
      {launcher && (
        <>
          <div className="dismiss-layer" onClick={() => setLauncher(false)} />
          <section className="launcher popup">
            <div className="launcher-header">
              <h2>Vos applications</h2>
              <span>Livebox OS</span>
            </div>
            <label className="search-field">
              <Search size={16} />
              <input
                autoFocus
                placeholder="Rechercher une application…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <div className="launcher-grid">
              {APPS.filter((a) =>
                a.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
              ).map((app) => (
                <button key={app.id} onClick={() => openApp(app.id)}>
                  <span className={`task-app-icon ${app.color}`}>
                    <app.icon size={23} />
                  </span>
                  <span>
                    {app.name}
                    <small>{app.description}</small>
                  </span>
                  <ChevronRight size={14} />
                </button>
              ))}
            </div>
            {!APPS.some((a) =>
              a.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
            ) && <p className="muted">Aucune application trouvée.</p>}
            <div className="launcher-bottom">
              <span>
                <ShieldCheck size={14} /> Administration locale
              </span>
              <button onClick={logout}>
                <LogOut size={15} /> Verrouiller Livebox OS
              </button>
            </div>
          </section>
        </>
      )}
      {notifications && (
        <>
          <div
            className="dismiss-layer"
            onClick={() => setNotifications(false)}
          />
          <section className="notifications popup">
            <div className="launcher-header">
              <h2>Notifications</h2>
              <button
                className="icon-button"
                aria-label="Fermer les notifications"
                onClick={() => setNotifications(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="notification-date">
              {clock.toLocaleDateString("fr-FR", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
            </div>
            {events.length ? (
              events.slice(0, 10).map((entry, i) => (
                <div key={i} className="notification-item">
                  <span className="notification-icon">
                    <Activity size={16} />
                  </span>
                  <div>
                    <strong>{entry.message}</strong>
                    <small>
                      {new Date(entry.time * 1000).toLocaleTimeString("fr-FR")}{" "}
                      · {entry.source}
                    </small>
                  </div>
                </div>
              ))
            ) : (
              <div className="empty-state compact">
                <Bell size={29} />
                <h3>Tout est tranquille.</h3>
                <p>
                  Les événements observés apparaîtront ici après connexion à
                  votre Livebox.
                </p>
              </div>
            )}
          </section>
        </>
      )}
      {menu && (
        <div
          className="context-menu popup"
          style={{ left: menu.x, top: menu.y }}
        >
          <button onClick={() => openApp("personalization")}>
            <Paintbrush size={15} /> Changer le fond d’écran
          </button>
          <button
            onClick={() => {
              setPreferences((p) => ({
                ...p,
                theme: p.theme === "dark" ? "light" : "dark",
              }));
              setMenu(null);
            }}
          >
            <Moon size={15} /> Changer de thème
          </button>
          <hr />
          <button
            onClick={() => {
              setWindows((w) => w.map((a) => ({ ...a, minimized: true })));
              setMenu(null);
            }}
          >
            <Grid2X2 size={15} /> Afficher le bureau
          </button>
          <button
            onClick={() => {
              setRevision((r) => r + 1);
              setMenu(null);
              notify("Bureau actualisé.");
            }}
          >
            <RefreshCw size={15} /> Actualiser
          </button>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <span className="notification-icon">
            <CircleHelp size={17} />
          </span>
          <span>{toast}</span>
          <button
            className="icon-button"
            aria-label="Fermer le message"
            onClick={() => setToast("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {login && (
        <LoginModal
          profile={login}
          close={() => setLogin(null)}
          connected={(s) => {
            setSession(s);
            setBackend(true);
            setLogin(null);
            setRevision((r) => r + 1);
            notify("Votre Livebox est connectée. Bienvenue chez vous.");
            openApp("status");
          }}
        />
      )}
      {prepared && (
        <div className="modal-backdrop">
          <section
            className="confirmation-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirmation-title"
          >
            <span className="modal-symbol">
              <ShieldCheck size={27} />
            </span>
            <h2 id="confirmation-title">Confirmer la modification</h2>
            <p>{prepared.warning}</p>
            <details open>
              <summary>Paramètres envoyés à la Livebox</summary>
              <pre>{JSON.stringify(prepared.values, null, 2)}</pre>
            </details>
            <div className="button-row">
              <button
                disabled={confirming}
                className="secondary"
                onClick={() => setPrepared(null)}
              >
                Annuler
              </button>
              <button
                disabled={confirming}
                className="primary"
                onClick={confirmChange}
              >
                {confirming ? "Application…" : "Confirmer et appliquer"}
                <Check size={16} />
              </button>
            </div>
          </section>
        </div>
      )}
      {!auth?.authenticated && (
        <AuthGate
          state={auth}
          retry={checkAuth}
          complete={(state) => {
            setAuth(state);
            setBackend(true);
          }}
        />
      )}
    </main>
  );
}

function LoginModal({
  profile,
  close,
  connected,
}: {
  profile: Profile;
  close: () => void;
  connected: (session: Session) => void;
}) {
  const [form, setForm] = useState(profile);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="modal-backdrop">
      <section
        className="login-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-title"
      >
        <button
          className="modal-close icon-button"
          onClick={close}
          disabled={busy}
          aria-label="Fermer la connexion"
        >
          <X size={19} />
        </button>
        <span className="modal-symbol">
          <HardDrive size={28} />
        </span>
        <span className="eyebrow">BIENVENUE CHEZ VOUS</span>
        <h2 id="login-title">Connecter ma Livebox</h2>
        <p>
          Utilisez les identifiants de l’interface d’administration de votre
          Livebox.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              connected(await api<Session>("/login", { ...form, password }));
              setPassword("");
            } catch (error) {
              setError((error as Error).message);
              setPassword("");
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Nom du profil
            <input
              value={form.name}
              maxLength={60}
              required
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label>
            Adresse de la Livebox
            <input
              value={form.url}
              required
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              placeholder="http://192.168.1.1"
            />
          </label>
          <div className="form-grid">
            <label>
              Identifiant
              <input
                autoComplete="username"
                value={form.username}
                required
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
            </label>
            <label>
              Mot de passe
              <input
                autoFocus
                type="password"
                autoComplete="current-password"
                value={password}
                required
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          </div>
          {error && (
            <div role="alert" className="error-message">
              {error}
            </div>
          )}
          <button className="primary wide" disabled={busy}>
            {busy ? "Connexion en cours…" : "Se connecter"}
            <ChevronRight size={17} />
          </button>
        </form>
        <div className="login-security">
          <LockKeyhole size={15} />
          <span>
            Le mot de passe n’est jamais enregistré. La session Livebox reste en
            mémoire côté serveur.
          </span>
        </div>
      </section>
    </div>
  );
}
