import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  Clock3,
  Download,
  HardDrive,
  ImagePlus,
  Info,
  Laptop,
  LockKeyhole,
  Moon,
  Network,
  Phone,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sun,
  Trash2,
  Upload,
  Wifi,
  X,
} from "lucide-react";
import {
  api,
  duration,
  rate,
  rec,
  rows,
  text,
  internetConnected,
  connectionType,
  wallpaperFile,
  type LogEntry,
  type Profile,
  type RecordData,
  type Result,
  type Session,
  type Snapshot,
} from "./api";
import type { AppId, ChangeRequest, Preferences } from "./App";
import { WifiBands } from "./ToolsPanels";

type SectionProps = { revision: number };
type ChangeProps = SectionProps & {
  change: (change: ChangeRequest) => Promise<void>;
};

function useSection(section: string, revision: number) {
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (section !== "devices") return;
    const timer = setInterval(() => setReload((v) => v + 1), 30000);
    return () => clearInterval(timer);
  }, [section]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api<Result>(`/read/${section}`)
      .then((data) => {
        if (!cancelled) setResult(data);
      })
      .catch((error) => {
        if (!cancelled)
          setResult({ available: false, data: null, message: error.message });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [section, revision, reload]);
  return { result, loading, refresh: () => setReload((v) => v + 1) };
}
function Unavailable({
  message = "Ce service n’est pas accessible sur cette Livebox ou avec ce firmware.",
}: {
  message?: string;
}) {
  return (
    <div className="unavailable">
      <Info size={21} />
      <div>
        <strong>Non disponible</strong>
        <p>{message}</p>
      </div>
    </div>
  );
}
function Loading() {
  return (
    <div className="loading">
      <RefreshCw size={20} className="spin" /> Lecture des données de la
      Livebox…
    </div>
  );
}
function PanelHeading({
  title,
  description,
  refresh,
  loading,
}: {
  title: string;
  description: string;
  refresh?: () => void;
  loading?: boolean;
}) {
  return (
    <div className="panel-heading">
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {refresh && (
        <button
          className="secondary small"
          disabled={loading}
          onClick={refresh}
        >
          <RefreshCw size={14} className={loading ? "spin" : ""} /> Actualiser
        </button>
      )}
    </div>
  );
}
function DataGrid({
  data,
  labels,
}: {
  data: RecordData;
  labels: [string, string][];
}) {
  return (
    <dl className="data-grid">
      {labels.map(([key, label]) => (
        <div key={key}>
          <dt>{label}</dt>
          <dd>{text(data[key])}</dd>
        </div>
      ))}
    </dl>
  );
}
function RawData({ data }: { data: unknown }) {
  return (
    <details className="raw-data">
      <summary>Voir la réponse de la Livebox</summary>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </details>
  );
}
function EmptyList({ children }: { children: string }) {
  return (
    <div className="empty-list">
      <Check size={22} />
      <p>{children}</p>
    </div>
  );
}

export function StatusPanel({
  snapshot,
  session,
  open,
}: {
  snapshot: Snapshot;
  session: Session;
  open: (id: AppId) => void;
}) {
  const info = rec(snapshot.info?.data),
    wan = rec(snapshot.wan?.data);
  const connected = internetConnected(snapshot);
  return (
    <div className="panel">
      <PanelHeading
        title="Bienvenue sur votre Livebox"
        description="L’essentiel de votre connexion, en temps réel."
      />
      <div className="connection-banner">
        <span className="banner-icon">
          <HardDrive size={32} />
        </span>
        <div>
          <span className="mini-label">{session.name}</span>
          <h3>
            {info.ProductClass === "Livebox Fibre"
              ? "Livebox 5"
              : text(info.ProductClass)}
          </h3>
          <span className={`connection-pill ${connected ? "good" : ""}`}>
            <i className={`status-dot ${connected ? "online" : ""}`} />
            {connected ? "Connectée à Internet" : text(wan.ConnectionState)}
          </span>
        </div>
        <div className="banner-network">
          <Network size={48} strokeWidth={1} />
        </div>
      </div>
      <div className="metric-grid">
        <div className="metric">
          <span>
            <ArrowDown size={15} /> Réception
          </span>
          <strong>
            {rate(snapshot.rate?.down)} <small>Mbit/s</small>
          </strong>
          <p>Trafic WAN mesuré</p>
        </div>
        <div className="metric">
          <span>
            <ArrowUp size={15} /> Envoi
          </span>
          <strong>
            {rate(snapshot.rate?.up)} <small>Mbit/s</small>
          </strong>
          <p>Trafic WAN mesuré</p>
        </div>
        <div className="metric">
          <span>
            <Clock3 size={15} /> Temps de fonctionnement
          </span>
          <strong className="uptime">{duration(info.UpTime)}</strong>
          <p>Depuis le dernier démarrage</p>
        </div>
      </div>
      {snapshot.wan && !snapshot.wan.available && (
        <Unavailable message={snapshot.wan.message} />
      )}
      <h3 className="section-title">Informations de la Livebox</h3>
      <DataGrid
        data={info}
        labels={[
          ["SoftwareVersion", "Version du firmware"],
          ["ProductClass", "Modèle déclaré"],
          ["Manufacturer", "Fabricant"],
          ["SerialNumber", "Numéro de série"],
        ]}
      />
      <DataGrid
        data={wan}
        labels={[
          ["IPAddress", "Adresse IP publique"],
          ["LinkType", "Type de connexion"],
          ["LinkState", "État du lien"],
          ["ConnectionState", "État Internet"],
        ]}
      />
      <div className="inline-links">
        <button onClick={() => open("devices")}>
          <Network size={17} /> Voir mes appareils <ChevronRight size={15} />
        </button>
        <button onClick={() => open("stats")}>
          <Activity size={17} /> Statistiques réseau <ChevronRight size={15} />
        </button>
      </div>
      <p className="footnote">
        {snapshot.updated
          ? `Dernière lecture : ${new Date(snapshot.updated * 1000).toLocaleTimeString("fr-FR")}.`
          : "Lecture en cours."}{" "}
        Les débits apparaissent après deux mesures valides. Il s’agit du trafic
        instantané, pas du débit maximal de votre offre.
      </p>
    </div>
  );
}

export function DevicesPanel({ revision }: SectionProps) {
  const { result, loading, refresh } = useSection("devices", revision);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<RecordData | null>(null);
  const list = rows(result?.data);
  const filtered = list.filter(
    (d) =>
      (filter === "all" ||
        (filter === "online" ? d.Active === true : d.Active === false)) &&
      JSON.stringify(d).toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="panel">
      <PanelHeading
        title="Les appareils de la maison"
        description="Retrouvez les équipements connus de votre Livebox."
        refresh={refresh}
        loading={loading}
      />
      <div className="toolbar">
        <label className="search-field">
          <Search size={16} />
          <input
            placeholder="Rechercher un nom, une IP, une MAC…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <select
          aria-label="Filtrer les appareils"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">Tous les appareils</option>
          <option value="online">Connectés</option>
          <option value="offline">Déconnectés</option>
        </select>
      </div>
      {loading ? (
        <Loading />
      ) : !result?.available ? (
        <Unavailable message={result?.message} />
      ) : (
        <>
          <div className="list-caption">
            {filtered.length} appareil{filtered.length > 1 ? "s" : ""} ·{" "}
            {list.filter((d) => d.Active === true).length} connecté(s)
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Appareil</th>
                  <th>Adresse IP</th>
                  <th>Adresse MAC</th>
                  <th>Connexion</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((device, i) => (
                  <tr
                    key={text(device.Key || device.PhysAddress || i)}
                    onClick={() => setSelected(device)}
                  >
                    <td>
                      <button className="device-name">
                        <span
                          className={`device-icon ${device.Active === true ? "online-device" : ""}`}
                        >
                          <Laptop size={18} />
                        </span>
                        <span>
                          {text(device.Name || device.HostName)}
                          <small>
                            <i
                              className={`status-dot ${device.Active === true ? "online" : ""}`}
                            />
                            {device.Active === true
                              ? "Connecté"
                              : device.Active === false
                                ? "Déconnecté"
                                : "État non disponible"}
                          </small>
                        </span>
                      </button>
                    </td>
                    <td>{text(device.IPAddress)}</td>
                    <td className="mono">
                      {text(device.PhysAddress || device.Key)}
                    </td>
                    <td>
                      {connectionType(
                        device.Layer2Interface || device.InterfaceName,
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!filtered.length && (
            <EmptyList>
              Aucun appareil ne correspond à cette recherche.
            </EmptyList>
          )}
          {selected && (
            <div className="device-details">
              <div className="flex-heading">
                <h3>{text(selected.Name || selected.HostName)}</h3>
                <button
                  className="icon-button"
                  aria-label="Fermer le détail"
                  onClick={() => setSelected(null)}
                >
                  <X size={16} />
                </button>
              </div>
              <DataGrid
                data={selected}
                labels={[
                  ["IPAddress", "Adresse IPv4"],
                  ["PhysAddress", "Adresse MAC"],
                  ["DeviceType", "Type d’appareil"],
                  ["Layer2Interface", "Interface réseau"],
                ]}
              />
              <RawData data={selected} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function SettingsPanel({ revision, change }: ChangeProps) {
  const [tab, setTab] = useState("wifi");
  return (
    <div className="panel">
      <PanelHeading
        title="Votre réseau, vos réglages"
        description="Chaque modification importante nécessite votre confirmation."
      />
      <div className="tabs">
        {[
          ["wifi", "Wi-Fi", Wifi],
          ["dhcp", "DHCP & réseau", Network],
        ].map(([id, label, Icon]) => {
          const I = Icon as typeof Wifi;
          return (
            <button
              key={id as string}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id as string)}
            >
              <I size={16} />
              {label as string}
            </button>
          );
        })}
      </div>
      {tab === "wifi" ? (
        <WifiSettings revision={revision} change={change} />
      ) : (
        <DhcpSettings revision={revision} change={change} />
      )}
    </div>
  );
}
function WifiSettings({ revision, change }: ChangeProps) {
  const { result, loading, refresh } = useSection("wifi", revision);
  const data = rec(result?.data);
  const [pending, setPending] = useState(false);
  return (
    <>
      <div className="flex-heading">
        <h3 className="section-title">Réseau Wi-Fi principal</h3>
        <button
          className="icon-button"
          disabled={loading}
          aria-label="Actualiser le Wi-Fi"
          onClick={refresh}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      {loading ? (
        <Loading />
      ) : !result?.available ? (
        <Unavailable message={result?.message} />
      ) : (
        <>
          <div className="setting-card">
            <span className="setting-icon">
              <Wifi size={24} />
            </span>
            <div>
              <h3>Wi-Fi de la Livebox</h3>
              <p>
                {data.Enable === true
                  ? "Activé"
                  : data.Enable === false
                    ? "Désactivé"
                    : "Non disponible"}
              </p>
            </div>
            <button
              role="switch"
              aria-label="Activer le Wi-Fi"
              aria-checked={data.Enable === true}
              className={`toggle ${data.Enable === true ? "on" : ""}`}
              disabled={typeof data.Enable !== "boolean" || pending}
              onClick={async () => {
                setPending(true);
                await change({
                  kind: "wifi",
                  values: { enabled: !data.Enable },
                });
                setPending(false);
              }}
            >
              <span />
            </button>
          </div>
          <div className="info-note">
            <Info size={17} />
            <p>
              La désactivation du Wi-Fi déconnecte les appareils sans fil. Une
              connexion Ethernet est recommandée pour cette opération.
            </p>
          </div>
          <RawData data={data} />
          <WifiConfiguration revision={revision} change={change} />
          <WifiBands revision={revision} change={change} />
        </>
      )}
    </>
  );
}
function WifiConfiguration({ revision, change }: ChangeProps) {
  const { result, loading, refresh } = useSection("wifi_config", revision);
  const interfaces = rec(rec(result?.data).wlanvap);
  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const first = Object.values(rec(rec(result?.data).wlanvap))[0];
    setSsid(
      typeof rec(first).SSID === "string" ? (rec(first).SSID as string) : "",
    );
  }, [result]);
  return (
    <>
      <div className="flex-heading spaced">
        <h3 className="section-title">Nom et clé du réseau principal</h3>
        <button
          className="icon-button"
          aria-label="Actualiser le nom Wi-Fi"
          disabled={loading}
          onClick={refresh}
        >
          <RefreshCw size={15} />
        </button>
      </div>
      {loading ? (
        <Loading />
      ) : !result?.available || !Object.keys(interfaces).length ? (
        <Unavailable
          message={
            result?.message ||
            "La configuration du Wi-Fi principal n’est pas accessible."
          }
        />
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            await change({
              kind: "wifi_config",
              values: { SSID: ssid, password },
            });
            setPassword("");
            setBusy(false);
          }}
        >
          <div className="form-grid">
            <label>
              Nom commun à toutes les bandes (SSID)
              <input
                required
                value={ssid}
                onChange={(e) => setSsid(e.target.value)}
              />
            </label>
            <label>
              Nouvelle clé Wi-Fi (facultative)
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={63}
                placeholder="Laisser vide pour conserver la clé"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          </div>
          <p className="footnote">
            8 à 63 caractères ASCII pour la nouvelle clé. Les clés existantes ne
            sont jamais renvoyées au navigateur.
          </p>
          <button className="primary" disabled={busy}>
            Vérifier la configuration <ChevronRight size={16} />
          </button>
        </form>
      )}
    </>
  );
}
function DhcpSettings({ revision, change }: ChangeProps) {
  const { result, loading, refresh } = useSection("lan", revision);
  const pools = useSection("dhcp", revision);
  const current = rec(result?.data);
  const complete =
    typeof current.DHCPEnable === "boolean" &&
    ["Address", "Netmask", "DHCPMinAddress", "DHCPMaxAddress"].every(
      (key) => typeof current[key] === "string" && current[key] !== "",
    );
  const [form, setForm] = useState({
    Address: "",
    Netmask: "",
    DHCPEnable: true,
    DHCPMinAddress: "",
    DHCPMaxAddress: "",
  });
  useEffect(() => {
    const data = rec(result?.data);
    if (result?.available)
      setForm({
        Address: typeof data.Address === "string" ? data.Address : "",
        Netmask: typeof data.Netmask === "string" ? data.Netmask : "",
        DHCPEnable: data.DHCPEnable === true,
        DHCPMinAddress:
          typeof data.DHCPMinAddress === "string" ? data.DHCPMinAddress : "",
        DHCPMaxAddress:
          typeof data.DHCPMaxAddress === "string" ? data.DHCPMaxAddress : "",
      });
  }, [result]);
  const [pending, setPending] = useState(false);
  return (
    <>
      <div className="flex-heading">
        <h3 className="section-title">Adressage du réseau local</h3>
        <button
          className="icon-button"
          disabled={loading}
          aria-label="Actualiser le DHCP"
          onClick={() => {
            refresh();
            pools.refresh();
          }}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      {loading ? (
        <Loading />
      ) : !result?.available || !complete ? (
        <Unavailable
          message={
            result?.message ||
            "La Livebox n’a pas retourné une configuration DHCP complète."
          }
        />
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setPending(true);
            await change({ kind: "dhcp", values: form });
            setPending(false);
          }}
        >
          <div className="form-grid">
            {(
              [
                ["Address", "Adresse de la Livebox"],
                ["Netmask", "Masque de sous-réseau"],
                ["DHCPMinAddress", "Début de la plage DHCP"],
                ["DHCPMaxAddress", "Fin de la plage DHCP"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  required
                  placeholder="Non disponible"
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                />
              </label>
            ))}
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={form.DHCPEnable}
              onChange={(e) =>
                setForm({ ...form, DHCPEnable: e.target.checked })
              }
            />{" "}
            Activer le serveur DHCP
          </label>
          <div className="info-note">
            <ShieldCheck size={18} />
            <p>
              Une modification de l’adressage peut interrompre votre réseau.
              Vérifiez les paramètres avant de confirmer.
            </p>
          </div>
          <button className="primary" disabled={pending}>
            Vérifier les modifications <ChevronRight size={16} />
          </button>
        </form>
      )}
      <h3 className="section-title spaced">Configuration des pools DHCP</h3>
      {pools.loading ? (
        <Loading />
      ) : pools.result?.available ? (
        <RawData data={pools.result.data} />
      ) : (
        <Unavailable message={pools.result?.message} />
      )}
    </>
  );
}

export function PortsPanel({ revision, change }: ChangeProps) {
  const { result, loading, refresh } = useSection("ports", revision);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    id: "",
    internalPort: "8080",
    externalPort: "8080",
    destinationIPAddress: "",
    protocol: "6",
    description: "",
  });
  const list = rows(result?.data);
  return (
    <div className="panel">
      <PanelHeading
        title="Redirections de ports"
        description="Gérez les règles IPv4 NAT / PAT de votre Livebox."
        refresh={refresh}
        loading={loading}
      />
      <div className="info-note">
        <ShieldCheck size={18} />
        <p>
          Une redirection expose le service ciblé à Internet. Gardez
          l’administration Livebox OS accessible uniquement en local.
        </p>
      </div>
      {loading ? (
        <Loading />
      ) : !result?.available ? (
        <Unavailable message={result?.message} />
      ) : (
        <>
          <div className="flex-heading">
            <span className="list-caption">{list.length} règle(s)</span>
            <button
              className="primary small"
              onClick={() => setAdding(!adding)}
            >
              <Plus size={15} /> Ajouter une règle
            </button>
          </div>
          {adding && (
            <form
              className="inset-form"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                await change({
                  kind: "port_add",
                  values: {
                    ...form,
                    internalPort: Number(form.internalPort),
                    externalPort: Number(form.externalPort),
                  },
                });
                setBusy(false);
              }}
            >
              <h3>Nouvelle règle</h3>
              <div className="form-grid">
                <label>
                  Nom de la règle
                  <input
                    required
                    maxLength={48}
                    pattern="[A-Za-z0-9_-]+"
                    value={form.id}
                    onChange={(e) => setForm({ ...form, id: e.target.value })}
                    placeholder="mon-service"
                  />
                </label>
                <label>
                  Adresse IP de destination
                  <input
                    required
                    value={form.destinationIPAddress}
                    onChange={(e) =>
                      setForm({ ...form, destinationIPAddress: e.target.value })
                    }
                    placeholder="192.168.1.20"
                  />
                </label>
                <label>
                  Port externe
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    required
                    value={form.externalPort}
                    onChange={(e) =>
                      setForm({ ...form, externalPort: e.target.value })
                    }
                  />
                </label>
                <label>
                  Port interne
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    required
                    value={form.internalPort}
                    onChange={(e) =>
                      setForm({ ...form, internalPort: e.target.value })
                    }
                  />
                </label>
                <label>
                  Protocole
                  <select
                    value={form.protocol}
                    onChange={(e) =>
                      setForm({ ...form, protocol: e.target.value })
                    }
                  >
                    <option value="6">TCP</option>
                    <option value="17">UDP</option>
                    <option value="6,17">TCP + UDP</option>
                  </select>
                </label>
                <label>
                  Description
                  <input
                    maxLength={128}
                    value={form.description}
                    onChange={(e) =>
                      setForm({ ...form, description: e.target.value })
                    }
                  />
                </label>
              </div>
              <div className="button-row">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setAdding(false)}
                >
                  Fermer
                </button>
                <button className="primary" disabled={busy}>
                  Vérifier la règle <ChevronRight size={16} />
                </button>
              </div>
            </form>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nom / origine</th>
                  <th>Ports ext. → int.</th>
                  <th>Destination</th>
                  <th>Protocole</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((rule, i) => (
                  <tr key={i}>
                    <td>
                      <strong>{text(rule.description || rule.id)}</strong>
                      <small>{text(rule.origin)} · {rule.enabled === true ? "Activée" : rule.enabled === false ? "Désactivée" : text(rule.status)}</small>
                    </td>
                    <td>
                      {text(rule.externalPort)} → {text(rule.internalPort)}
                    </td>
                    <td>{text(rule.destinationIPAddress)}</td>
                    <td>
                      {rule.protocol === "6" || rule.protocol === 6
                        ? "TCP"
                        : rule.protocol === "17" || rule.protocol === 17
                          ? "UDP"
                          : text(rule.protocol)}
                    </td>
                    <td>
                      {rule.origin === "webui" && (
                        <button
                          className="icon-button danger"
                          aria-label={`Supprimer ${text(rule.id)}`}
                          onClick={() =>
                            change({
                              kind: "port_delete",
                              values: {
                                id: rule.id,
                                destinationIPAddress: rule.destinationIPAddress,
                                origin: rule.origin,
                              },
                            })
                          }
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!list.length && (
            <EmptyList>
              Aucune redirection de port déclarée par la Livebox.
            </EmptyList>
          )}
          <RawData data={result.data} />
        </>
      )}
    </div>
  );
}

export function StatisticsPanel({ snapshot }: { snapshot: Snapshot }) {
  const [range, setRange] = useState(15);
  const samples = (snapshot.history || []).filter(
    (s) => s.time >= Date.now() / 1000 - range * 60,
  );
  const hasData = samples.some((s) => s.down !== null || s.up !== null);
  const max = Math.max(1, ...samples.flatMap((s) => [s.down || 0, s.up || 0]));
  const x = (time: number) =>
    48 +
    ((time - (samples[0]?.time || time)) /
      Math.max(
        1,
        (samples.at(-1)?.time || time) - (samples[0]?.time || time),
      )) *
      570;
  function paths(key: "down" | "up") {
    let drawing = false;
    return samples
      .map((s) => {
        const value = s[key];
        if (value === null) {
          drawing = false;
          return "";
        }
        const p = `${drawing ? "L" : "M"}${x(s.time).toFixed(1)},${(220 - (value / max) * 180).toFixed(1)}`;
        drawing = true;
        return p;
      })
      .join(" ");
  }
  return (
    <div className="panel">
      <PanelHeading
        title="L’activité de votre réseau"
        description="Débits calculés à partir des compteurs WAN réels, toutes les 10 secondes."
      />
      <div className="stats-top">
        <div className="metric">
          <span>
            <ArrowDown size={15} /> Réception
          </span>
          <strong>
            {rate(snapshot.rate?.down)} <small>Mbit/s</small>
          </strong>
        </div>
        <div className="metric">
          <span>
            <ArrowUp size={15} /> Envoi
          </span>
          <strong>
            {rate(snapshot.rate?.up)} <small>Mbit/s</small>
          </strong>
        </div>
        <div className="segmented">
          {[5, 15, 60].map((v) => (
            <button
              key={v}
              className={range === v ? "active" : ""}
              onClick={() => setRange(v)}
            >
              {v === 60 ? "1 h" : `${v} min`}
            </button>
          ))}
        </div>
      </div>
      <div className="chart-card">
        <div className="chart-label">
          <span>
            <i className="legend-down" /> Réception
          </span>
          <span>
            <i className="legend-up" /> Envoi
          </span>
          <small>Mbit/s</small>
        </div>
        {hasData ? (
          <svg
            className="network-chart"
            viewBox="0 0 650 260"
            role="img"
            aria-label="Évolution réelle des débits WAN en mégabits par seconde"
          >
            {[0, 1, 2, 3, 4].map((i) => (
              <g key={i}>
                <line
                  x1="48"
                  x2="620"
                  y1={40 + i * 45}
                  y2={40 + i * 45}
                  stroke="currentColor"
                  opacity=".1"
                />
                <text
                  x="38"
                  y={44 + i * 45}
                  textAnchor="end"
                  fill="currentColor"
                  opacity=".5"
                  fontSize="10"
                >
                  {rate((max * (4 - i)) / 4)}
                </text>
              </g>
            ))}
            <path
              d={paths("down")}
              fill="none"
              stroke="#ff7900"
              strokeWidth="2.5"
            />
            <path
              d={paths("up")}
              fill="none"
              stroke="#6366f1"
              strokeWidth="2"
            />
            {samples
              .filter((s) => s.down !== null)
              .map((s, i) => (
                <circle
                  key={i}
                  cx={x(s.time)}
                  cy={220 - ((s.down || 0) / max) * 180}
                  r={samples.length < 3 ? 3 : 0}
                  fill="#ff7900"
                />
              ))}
            <text x="48" y="246" fill="currentColor" opacity=".5" fontSize="10">
              {new Date((samples[0]?.time || 0) * 1000).toLocaleTimeString(
                "fr-FR",
              )}
            </text>
            <text
              x="620"
              y="246"
              textAnchor="end"
              fill="currentColor"
              opacity=".5"
              fontSize="10"
            >
              {new Date((samples.at(-1)?.time || 0) * 1000).toLocaleTimeString(
                "fr-FR",
              )}
            </text>
          </svg>
        ) : (
          <div className="empty-state compact">
            <Activity size={32} />
            <h3>En attente des mesures</h3>
            <p>
              Le graphique apparaîtra après deux lectures valides des compteurs
              de la Livebox.
            </p>
          </div>
        )}
      </div>
      {snapshot.stats && !snapshot.stats.available && (
        <Unavailable message={snapshot.stats.message} />
      )}
      <p className="footnote">
        Historique conservé en mémoire pour cette session (1 heure maximum). Une
        baisse ou réinitialisation des compteurs crée une interruption dans la
        courbe. Aucun échantillon n’est simulé.
      </p>
    </div>
  );
}

export function CallsPanel({ revision }: SectionProps) {
  const { result, loading, refresh } = useSection("calls", revision);
  const list = rows(result?.data);
  return (
    <div className="panel">
      <PanelHeading
        title="Votre journal d’appels"
        description="Les appels de la ligne téléphonique, si le service est disponible."
        refresh={refresh}
        loading={loading}
      />
      {loading ? (
        <Loading />
      ) : !result?.available ? (
        <Unavailable message={result?.message} />
      ) : (
        <>
          {list.length ? (
            <div className="call-list">
              {list.map((call, i) => (
                <article key={i}>
                  <span className="call-icon">
                    <Phone size={19} />
                  </span>
                  <div>
                    <strong>
                      {text(
                        call.remoteNumber || call.number || call.peerNumber,
                      )}
                    </strong>
                    <p>{text(call.callType || call.type || call.direction)}</p>
                  </div>
                  <div className="call-time">
                    <strong>
                      {text(call.startTime || call.date || call.time)}
                    </strong>
                    <small>
                      {call.duration === undefined
                        ? "Durée non disponible"
                        : `${text(call.duration)} s`}
                    </small>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyList>Aucun appel retourné par la Livebox.</EmptyList>
          )}
          <RawData data={result.data} />
        </>
      )}
    </div>
  );
}

export function JournalPanel({
  entries,
  revision,
}: {
  entries: LogEntry[];
  revision: number;
}) {
  const { result, loading, refresh } = useSection("logs", revision);
  const [tab, setTab] = useState("observed");
  const [search, setSearch] = useState("");
  const filtered = entries.filter((e) =>
    e.message.toLowerCase().includes(search.toLowerCase()),
  );
  function exportLog() {
    const url = URL.createObjectURL(
      new Blob(
        [JSON.stringify({ observations: entries, dhcp: result }, null, 2)],
        { type: "application/json" },
      ),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "orange-os-journal.json";
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="panel">
      <PanelHeading
        title="Ce qui se passe sur votre réseau"
        description="Observations locales de la session et journal DHCP de la Livebox."
      />
      <div className="tabs">
        <button
          className={tab === "observed" ? "active" : ""}
          onClick={() => setTab("observed")}
        >
          Événements observés <span>{entries.length}</span>
        </button>
        <button
          className={tab === "dhcp" ? "active" : ""}
          onClick={() => setTab("dhcp")}
        >
          Journal DHCP
        </button>
      </div>
      <div className="toolbar">
        <label className="search-field">
          <Search size={15} />
          <input
            placeholder="Rechercher un événement…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <button className="secondary small" onClick={exportLog}>
          <Download size={14} /> Exporter
        </button>
      </div>
      {tab === "observed" ? (
        <>
          <div className="event-list">
            {filtered.map((entry, i) => (
              <article key={i}>
                <span className="timeline-dot" />
                <time>
                  {new Date(entry.time * 1000).toLocaleTimeString("fr-FR")}
                </time>
                <div>
                  <strong>{entry.message}</strong>
                  <small>{entry.source}</small>
                </div>
              </article>
            ))}
          </div>
          {!filtered.length && (
            <EmptyList>
              Aucun événement correspondant pour cette session.
            </EmptyList>
          )}
          <p className="footnote">
            Ces événements correspondent aux changements détectés lors des
            lectures périodiques d’Livebox OS. Ils ne constituent pas le journal
            interne complet de la Livebox.
          </p>
        </>
      ) : (
        <>
          <button
            className="secondary small"
            disabled={loading}
            onClick={refresh}
          >
            <RefreshCw size={14} /> Actualiser le journal
          </button>
          {loading ? (
            <Loading />
          ) : !result?.available ? (
            <Unavailable message={result?.message} />
          ) : (
            <RawData data={result.data} />
          )}
        </>
      )}
    </div>
  );
}

export function ProfilesPanel({
  connect,
  notify,
  revision,
}: {
  connect: (profile: Profile) => void;
  notify: (message: string) => void;
  revision: number;
}) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [originalName, setOriginalName] = useState<string | null>(null);
  const [form, setForm] = useState<Profile>({
    name: "",
    url: "http://192.168.1.1",
    username: "admin",
  });
  useEffect(() => {
    api<Profile[]>("/profiles")
      .then(setProfiles)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [revision]);
  return (
    <div className="panel">
      <PanelHeading
        title="Vos Livebox, au même endroit"
        description="Enregistrez plusieurs adresses de connexion, sans conserver les mots de passe."
      />
      <div className="flex-heading">
        <span className="list-caption">
          {profiles.length} profil(s) enregistré(s)
        </span>
        <button
          className="primary small"
          onClick={() => {
            setForm({ name: "", url: "http://192.168.1.1", username: "admin" });
            setOriginalName(null);
            setEditing(true);
          }}
        >
          <Plus size={15} /> Nouveau profil
        </button>
      </div>
      {error && <div className="error-message">{error}</div>}
      {loading ? (
        <Loading />
      ) : (
        <div className="profile-grid">
          {profiles.map((profile) => (
            <article className="profile-card" key={profile.name}>
              <div className="flex-heading">
                <span className="profile-symbol">
                  <HardDrive size={24} />
                </span>
                <button
                  className="icon-button danger"
                  aria-label={`Supprimer le profil ${profile.name}`}
                  onClick={() => setDeleting(profile.name)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
              <h3>{profile.name}</h3>
              <p>{profile.url}</p>
              <small>{profile.username}</small>
              <div className="button-row">
                <button
                  className="secondary small"
                  onClick={() => {
                    setForm(profile);
                    setOriginalName(profile.name);
                    setEditing(true);
                  }}
                >
                  Modifier
                </button>
                <button
                  className="primary small"
                  onClick={() => connect(profile)}
                >
                  Connecter <ChevronRight size={14} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      {!profiles.length && !editing && !loading && (
        <div className="empty-state compact">
          <UsersIcon />
          <h3>Une Livebox à ajouter ?</h3>
          <p>
            Créez votre premier profil pour retrouver son adresse en un clic.
          </p>
        </div>
      )}
      {deleting && (
        <div className="info-note">
          <Trash2 size={18} />
          <div>
            <p>Supprimer le profil « {deleting} » ?</p>
            <div className="button-row">
              <button
                className="secondary small"
                onClick={() => setDeleting(null)}
              >
                Annuler
              </button>
              <button
                className="primary small"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    setProfiles(
                      await api<Profile[]>(
                        `/profiles/${encodeURIComponent(deleting)}`,
                        undefined,
                        "DELETE",
                      ),
                    );
                    setDeleting(null);
                    notify("Profil supprimé.");
                  } catch (e) {
                    notify((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}
      {editing && (
        <form
          className="inset-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              setProfiles(
                await api<Profile[]>(
                  originalName === null
                    ? "/profiles"
                    : `/profiles/${encodeURIComponent(originalName)}`,
                  form,
                  originalName === null ? "POST" : "PUT",
                ),
              );
              setEditing(false);
              notify("Profil enregistré.");
            } catch (e) {
              notify((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <h3>Configurer un profil</h3>
          <div className="form-grid">
            <label>
              Nom du profil
              <input
                required
                maxLength={60}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label>
              Adresse de la Livebox
              <input
                required
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
              />
            </label>
            <label>
              Identifiant
              <input
                required
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
            </label>
          </div>
          <div className="button-row">
            <button
              type="button"
              className="secondary"
              onClick={() => setEditing(false)}
            >
              Annuler
            </button>
            <button className="primary" disabled={busy}>
              Enregistrer <Check size={15} />
            </button>
          </div>
        </form>
      )}
      <div className="info-note">
        <LockKeyhole size={17} />
        <p>
          Seuls le nom, l’adresse privée et l’identifiant sont enregistrés sur
          le serveur local. Le mot de passe est demandé à chaque connexion.
        </p>
      </div>
    </div>
  );
}
function UsersIcon() {
  return <Network size={30} />;
}

export function PersonalizationPanel({
  preferences,
  update,
  image,
  onImage,
  notify,
}: {
  preferences: Preferences;
  update: Dispatch<SetStateAction<Preferences>>;
  image: string;
  onImage: (url: string) => void;
  notify: (message: string) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const wallpapers = [
    ["signature", "Signature", "L’énergie Orange"],
    ["dune", "Dune", "La douceur des reliefs"],
    ["night", "Minuit", "Une autre lumière"],
  ];
  async function importImage(file?: File) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      notify("Choisissez une image JPG, PNG ou WebP.");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      notify("L’image doit peser moins de 15 Mo.");
      return;
    }
    setUploading(true);
    try {
      const bitmap = await createImageBitmap(file);
      const pixels = bitmap.width * bitmap.height;
      bitmap.close();
      if (pixels > 60_000_000)
        throw new Error(
          "L’image dépasse 60 mégapixels. Réduisez sa résolution.",
        );
      await wallpaperFile(file);
      await api("/wallpaper", file, "PUT");
      onImage(URL.createObjectURL(file));
      update((p) => ({ ...p, wallpaper: "custom" }));
      notify("Votre fond d’écran est enregistré sur cet appareil.");
    } catch (e) {
      notify((e as Error).message || "Impossible de lire cette image.");
    } finally {
      setUploading(false);
    }
  }
  return (
    <div className="panel">
      <PanelHeading
        title="Un bureau à votre image"
        description="Vos préférences sont automatiquement enregistrées sur cet appareil."
      />
      <h3 className="section-title">Fond d’écran</h3>
      <div className="wallpaper-options">
        {wallpapers.map(([id, title, subtitle]) => (
          <button
            key={id}
            className={`wallpaper-option ${preferences.wallpaper === id ? "chosen" : ""}`}
            onClick={() => update((p) => ({ ...p, wallpaper: id }))}
          >
            <span className={`wallpaper-thumb wallpaper-${id}`}>
              <span className="thumb-orb" />
              {preferences.wallpaper === id && (
                <i>
                  <Check size={14} />
                </i>
              )}
            </span>
            <strong>{title}</strong>
            <small>{subtitle}</small>
          </button>
        ))}
      </div>
      <div className="custom-wallpaper">
        <span className="setting-icon">
          <ImagePlus size={24} />
        </span>
        <div>
          <h3>Votre propre image</h3>
          <p>JPG, PNG ou WebP · 15 Mo maximum</p>
        </div>
        <input
          ref={fileInput}
          type="file"
          className="sr-only"
          accept="image/jpeg,image/png,image/webp"
          aria-label="Importer un fond d’écran"
          onChange={(e) => {
            importImage(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <button
          className="secondary small"
          disabled={uploading}
          onClick={() => fileInput.current?.click()}
        >
          <Upload size={14} />
          {uploading ? "Importation…" : "Importer"}
        </button>
      </div>
      {image && (
        <button
          className={`imported-preview ${preferences.wallpaper === "custom" ? "chosen" : ""}`}
          onClick={() => update((p) => ({ ...p, wallpaper: "custom" }))}
        >
          <img src={image} alt="Votre fond d’écran importé" />
          <span>Utiliser mon image</span>
          {preferences.wallpaper === "custom" && <Check size={15} />}
        </button>
      )}
      <div className="appearance-row">
        <label>
          Ajustement de l’image
          <select
            value={preferences.fit}
            onChange={(e) =>
              update((p) => ({
                ...p,
                fit: e.target.value as Preferences["fit"],
              }))
            }
          >
            <option value="cover">Remplir</option>
            <option value="contain">Adapter</option>
            <option value="center">Centrer</option>
          </select>
        </label>
        <label className="blur-label">
          Flou <span>{preferences.blur} px</span>
          <input
            type="range"
            min={0}
            max={20}
            value={preferences.blur}
            onChange={(e) =>
              update((p) => ({ ...p, blur: Number(e.target.value) }))
            }
          />
        </label>
      </div>
      <h3 className="section-title spaced">Apparence</h3>
      <div className="theme-options">
        <button
          className={preferences.theme === "light" ? "chosen" : ""}
          onClick={() => update((p) => ({ ...p, theme: "light" }))}
        >
          <Sun size={20} />
          <span>
            Clair<small>Un espace lumineux</small>
          </span>
          {preferences.theme === "light" && <Check size={16} />}
        </button>
        <button
          className={preferences.theme === "dark" ? "chosen" : ""}
          onClick={() => update((p) => ({ ...p, theme: "dark" }))}
        >
          <Moon size={20} />
          <span>
            Sombre<small>Tout en douceur</small>
          </span>
          {preferences.theme === "dark" && <Check size={16} />}
        </button>
      </div>
      <div className="personalization-footer">
        <span>
          <Check size={13} /> Enregistrement automatique
        </span>
        <button
          className="text-button"
          onClick={() =>
            update((p) => ({
              ...p,
              wallpaper: "signature",
              fit: "cover",
              blur: 0,
            }))
          }
        >
          Restaurer le fond par défaut
        </button>
      </div>
    </div>
  );
}
