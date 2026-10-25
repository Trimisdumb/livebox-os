import { useEffect, useState } from "react";
import {
  Activity,
  Check,
  ChevronRight,
  Download,
  FolderOpen,
  HardDrive,
  Info,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
  Wifi,
} from "lucide-react";
import {
  api,
  loadServerWallpaper,
  rec,
  rows,
  text,
  wallpaperFile,
  type LogEntry,
  type RecordData,
  type Result,
} from "./api";
import type { ChangeRequest, Preferences } from "./App";

function Header({
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
          <RefreshCw size={14} /> Actualiser
        </button>
      )}
    </div>
  );
}
function Failure({ error }: { error: string }) {
  return (
    <div className="unavailable" role="status">
      <Info size={20} />
      <div>
        <strong>Non disponible</strong>
        <p>{error}</p>
      </div>
    </div>
  );
}
function useRead<T>(path: string, revision = 0) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    api<T>(path)
      .then((value) => {
        if (alive) setData(value);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [path, revision, tick]);
  return { data, error, loading, refresh: () => setTick((v) => v + 1) };
}

type Storage = {
  source: string;
  usb: Result;
  disks: Result;
  volumes: Result;
  capabilities: Result;
  file_access: { available: boolean; message: string; source: string };
};
export function StoragePanel({ revision }: { revision: number }) {
  const { data, loading, error, refresh } = useRead<Storage>(
    "/storage",
    revision,
  );
  const [selected, setSelected] = useState<RecordData | null>(null);
  const disks = rows(data?.disks.data),
    volumes = rows(data?.volumes.data);
  function capacity(volume: RecordData, field: string) {
    return typeof volume[field] === "number"
      ? `${((volume[field] as number) / 1024 / 1024).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} Gio`
      : "Non disponible";
  }
  return (
    <div className="panel">
      <Header
        title="Explorateur de stockage"
        description="Périphériques USB de la Livebox uniquement. Aucun disque du serveur n’est exploré."
        refresh={refresh}
        loading={loading}
      />
      {loading && (
        <div className="loading">
          <RefreshCw className="spin" size={20} /> Interrogation des services
          USB…
        </div>
      )}
      {error && <Failure error={error} />}
      {data && !loading && (
        <>
          <div className="info-note">
            <HardDrive size={19} />
            <p>
              Source : {data.source}. La détection matérielle et la capacité
              dépendent des services encore proposés par votre firmware.
            </p>
          </div>
          {data.disks.available ? (
            disks.length ? (
              <div className="profile-grid">
                {disks.map((disk, i) => (
                  <button
                    className="profile-card storage-disk"
                    key={i}
                    onClick={() => setSelected(disk)}
                  >
                    <HardDrive size={27} />
                    <h3>{text(disk.Name || disk.Model)}</h3>
                    <p>
                      {text(disk.Vendor)} · {text(disk.Status)}
                    </p>
                    <small>{text(disk.ConnectionType)}</small>
                  </button>
                ))}
              </div>
            ) : (
              <div className="empty-list">
                <HardDrive size={28} />
                <p>Aucun disque retourné par StorageService.</p>
              </div>
            )
          ) : (
            <Failure
              error={
                data.disks.message ||
                "La détection des supports n’est pas proposée."
              }
            />
          )}
          {data.volumes.available &&
            volumes.map((volume, i) => (
              <div className="volume-card" key={i}>
                <h3>
                  {text(volume.Name)} <small>{text(volume.FileSystem)}</small>
                </h3>
                <div className="metric-grid">
                  <div className="metric">
                    <span>Capacité totale</span>
                    <strong className="uptime">
                      {capacity(volume, "CapacityKb")}
                    </strong>
                  </div>
                  <div className="metric">
                    <span>Espace utilisé</span>
                    <strong className="uptime">
                      {capacity(volume, "UsedSpaceKb")}
                    </strong>
                  </div>
                  <div className="metric">
                    <span>Espace libre</span>
                    <strong className="uptime">
                      {typeof volume.CapacityKb === "number" &&
                      typeof volume.UsedSpaceKb === "number" &&
                      volume.CapacityKb >= volume.UsedSpaceKb
                        ? capacity(
                            { free: volume.CapacityKb - volume.UsedSpaceKb },
                            "free",
                          )
                        : "Non disponible"}
                    </strong>
                  </div>
                </div>
              </div>
            ))}
          <div className="storage-actions">
            {[
              [FolderOpen, "Explorer"],
              [Download, "Télécharger"],
              [Upload, "Envoyer"],
              [Plus, "Nouveau dossier"],
              [RefreshCw, "Renommer"],
              [Trash2, "Supprimer"],
            ].map(([Icon, label]) => {
              const I = Icon as typeof HardDrive;
              return (
                <button
                  key={label as string}
                  className="secondary small"
                  disabled
                  title={data.file_access.message}
                >
                  <I size={14} />
                  {label as string}
                </button>
              );
            })}
          </div>
          <Failure error={data.file_access.message} />
          <a
            className="source-link"
            href={data.file_access.source}
            target="_blank"
            rel="noopener noreferrer"
          >
            Explication officielle Orange <ChevronRight size={13} />
          </a>
          {selected && (
            <details className="raw-data" open>
              <summary>Informations du support sélectionné</summary>
              <pre>{JSON.stringify(selected, null, 2)}</pre>
            </details>
          )}
          <details className="raw-data">
            <summary>Réponses USB et capacités de la Livebox</summary>
            <pre>
              {JSON.stringify(
                {
                  usb: data.usb,
                  disks: data.disks,
                  volumes: data.volumes,
                  capabilities: data.capabilities,
                },
                null,
                2,
              )}
            </pre>
          </details>
          <p className="footnote">
            Seuls les champs explicitement nommés CapacityKb et UsedSpaceKb sont
            convertis en Gio. Une capacité dont l’unité n’est pas documentée
            reste consultable dans la réponse brute.
          </p>
        </>
      )}
    </div>
  );
}

type DiagnosticResult = {
  available: boolean;
  ok: boolean;
  message: string;
  api_available?: boolean;
  api_message?: string;
  target: string;
  duration_ms: number;
  time: number;
};
export function DiagnosticsPanel() {
  const incidents = useRead<LogEntry[]>("/incidents");
  const [test, setTest] = useState("livebox"),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState<DiagnosticResult | null>(null),
    [error, setError] = useState("");
  return (
    <div className="panel">
      <Header
        title="Diagnostic réseau"
        description="Tests exécutés depuis le backend Livebox OS, sur des destinations autorisées."
      />
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            setResult(await api<DiagnosticResult>("/diagnostics", { test }));
            incidents.refresh();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="toolbar">
          <select
            aria-label="Test de diagnostic"
            value={test}
            onChange={(e) => setTest(e.target.value)}
          >
            <option value="livebox">
              Livebox : ping et communication Sysbus
            </option>
            <option value="internet">Internet : ping 1.1.1.1</option>
            <option value="tplink">Routeur TP-Link : ping et API authentifiée</option>
            <option value="dns">Résolution DNS : orange.fr</option>
            <option value="https">Connexion HTTPS : www.orange.fr</option>
          </select>
          <button className="primary small" disabled={busy}>
            {busy ? (
              <RefreshCw size={14} className="spin" />
            ) : (
              <Activity size={14} />
            )}{" "}
            {busy ? "Test en cours…" : "Lancer le test"}
          </button>
        </div>
      </form>
      {error && <Failure error={error} />}
      {result && (
        <div className="diagnostic-result">
          <div className="flex-heading">
            <h3>
              {!result.available
                ? "Non disponible"
                : result.ok
                  ? "Test réussi"
                  : "Échec du test"}
            </h3>
            <span>{result.duration_ms} ms</span>
          </div>
          <p>
            {result.target} ·{" "}
            {new Date(result.time * 1000).toLocaleString("fr-FR")}
          </p>
          <pre>{result.message}</pre>
          {result.api_message && (
            <div
              className={result.api_available ? "info-note" : "error-message"}
            >
              {result.api_message}
            </div>
          )}
          <p className="footnote">
            Un ping peut être filtré alors qu’Internet fonctionne. Le test
            Sysbus vérifie séparément la communication authentifiée avec la
            Livebox.
          </p>
        </div>
      )}
      <div className="flex-heading spaced">
        <h3 className="section-title">
          Historique des incidents et diagnostics
        </h3>
        <button
          className="icon-button"
          aria-label="Actualiser les incidents"
          onClick={incidents.refresh}
        >
          <RefreshCw size={15} />
        </button>
      </div>
      {incidents.error && <Failure error={incidents.error} />}
      <div className="event-list">
        {incidents.data?.slice(0, 40).map((entry, i) => (
          <article key={i}>
            <span className="timeline-dot" />
            <time>{new Date(entry.time * 1000).toLocaleString("fr-FR")}</time>
            <div>
              <strong>{entry.message}</strong>
              <small>{entry.source}</small>
            </div>
          </article>
        ))}
      </div>
      {!incidents.loading && incidents.data?.length === 0 && (
        <div className="empty-list">Aucun incident enregistré.</div>
      )}
      <p className="footnote">
        Historique persistant sur le volume Livebox OS, limité aux 1 000 derniers
        événements.
      </p>
    </div>
  );
}

export function WifiBands({
  revision,
  change,
}: {
  revision: number;
  change: (change: ChangeRequest) => Promise<void>;
}) {
  const { data, error, loading, refresh } = useRead<Result>(
    "/wifi/bands",
    revision,
  );
  const bands = rows(data?.data);
  return (
    <>
      <div className="flex-heading spaced">
        <h3 className="section-title">Bandes et canaux Wi-Fi</h3>
        <button
          className="icon-button"
          aria-label="Actualiser les bandes Wi-Fi"
          onClick={refresh}
        >
          <RefreshCw size={15} />
        </button>
      </div>
      {loading && <div className="loading">Lecture des radios Wi-Fi…</div>}
      {error && <Failure error={error} />}
      {data && !data.available && (
        <Failure
          error={data.message || "Le firmware ne fournit pas ces informations."}
        />
      )}
      <div className="wifi-bands">
        {bands.map((band, i) => (
          <BandCard
            key={`${band.interface}-${i}`}
            band={band}
            change={change}
          />
        ))}
      </div>
    </>
  );
}
function BandCard({
  band,
  change,
}: {
  band: RecordData;
  change: (change: ChangeRequest) => Promise<void>;
}) {
  const [channel, setChannel] = useState(
    band.auto === true ? "auto" : text(band.channel),
  );
  const [busy, setBusy] = useState(false);
  useEffect(
    () => setChannel(band.auto === true ? "auto" : text(band.channel)),
    [band.auto, band.channel],
  );
  const channels =
    typeof band.channels === "string"
      ? band.channels
          .split(",")
          .map((v) => v.trim())
          .filter((v) => /^\d+$/.test(v))
      : Array.isArray(band.channels)
        ? band.channels.map(String)
        : [];
  return (
    <div className="band-card">
      <div className="flex-heading">
        <h3>
          <Wifi size={18} /> {text(band.band)}
        </h3>
        <span className="connection-pill">
          {band.enabled === true
            ? "Activé"
            : band.enabled === false
              ? "Désactivé"
              : "Non disponible"}
        </span>
      </div>
      <p>{text(band.ssid)}</p>
      <div className="band-info">
        <span>
          Canal{" "}
          <strong>
            {text(band.channel)}
            {band.auto === true ? " · Auto" : ""}
          </strong>
        </span>
        <span>
          Standard <strong>{text(band.standard)}</strong>
        </span>
        <span>
          Appareils{" "}
          <strong>
            {Array.isArray(band.devices)
              ? band.devices.length
              : "Non disponible"}
          </strong>
        </span>
      </div>
      {typeof band.auto === "boolean" && band.radio ? (
        <div className="toolbar">
          <select
            aria-label={`Canal ${text(band.band)}`}
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
          >
            <option value="auto">Automatique</option>
            {channels.map((value) => (
              <option key={value} value={value}>
                Canal {value}
              </option>
            ))}
            {!channels.includes(String(band.channel)) && band.auto !== true && (
              <option value={String(band.channel)}>
                Canal actuel : {text(band.channel)}
              </option>
            )}
          </select>
          <button
            className="secondary small"
            disabled={
              busy || (channel !== "auto" && !channels.includes(channel))
            }
            onClick={async () => {
              setBusy(true);
              await change({
                kind: "wifi_radio",
                values: {
                  interface: band.radio,
                  auto: channel === "auto",
                  channel: channel === "auto" ? 0 : Number(channel),
                },
              });
              setBusy(false);
            }}
          >
            Vérifier
          </button>
        </div>
      ) : (
        <p className="footnote">Modification du canal non disponible.</p>
      )}
      {Array.isArray(band.devices) && band.devices.length > 0 && (
        <details className="raw-data">
          <summary>Appareils connectés à cette bande</summary>
          <div className="band-devices">
            {band.devices.map((device, i) => (
              <p key={i}>
                {text(rec(device).name)} <small>{text(rec(device).ip)}</small>
              </p>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

export function BackupPanel({
  preferences,
  update,
  onImage,
  notify,
  restored,
}: {
  preferences: Preferences;
  update: (p: Preferences) => void;
  onImage: (url: string) => void;
  notify: (message: string) => void;
  restored: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [prepared, setPrepared] = useState<{
    token: string;
    warning: string;
    profiles: number;
    wallpaper: boolean;
  } | null>(null);
  async function download() {
    setBusy(true);
    setError("");
    try {
      await api("/preferences", preferences, "PUT");
      const backup = await api("/backup");
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(backup, null, 2)], {
          type: "application/json",
        }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "livebox-os-sauvegarde.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="panel">
      <Header
        title="Votre espace, en sécurité"
        description="Sauvegardez les profils, l’apparence et votre image personnalisée Livebox OS."
      />
      <div className="info-note">
        <ShieldCheck size={18} />
        <p>
          Cette sauvegarde concerne l’application Livebox OS. Elle ne contient
          aucun mot de passe, aucune session ni sauvegarde du firmware de la
          Livebox.
        </p>
      </div>
      <div className="setting-card">
        <span className="setting-icon">
          <Download size={23} />
        </span>
        <div>
          <h3>Exporter ma configuration</h3>
          <p>Fichier JSON portable pour votre prochain appareil.</p>
        </div>
        <button className="primary small" disabled={busy} onClick={download}>
          Exporter
        </button>
      </div>
      <div className="setting-card">
        <span className="setting-icon">
          <Upload size={23} />
        </span>
        <div>
          <h3>Restaurer une sauvegarde</h3>
          <p>Vérifiez le contenu avant de remplacer votre configuration.</p>
        </div>
        <label className="secondary small file-label">
          Choisir un fichier
          <input
            className="sr-only"
            type="file"
            accept="application/json,.json"
            disabled={busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setBusy(true);
              setError("");
              try {
                if (file.size > 22 * 1024 * 1024)
                  throw new Error("Sauvegarde trop volumineuse.");
                setPrepared(
                  await api("/backup/prepare", JSON.parse(await file.text())),
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
      </div>
      {error && <Failure error={error} />}
      {prepared && (
        <div
          className="inset-form"
          role="alertdialog"
          aria-label="Confirmer la restauration Livebox OS"
        >
          <h3>Vérifier la restauration</h3>
          <p>{prepared.warning}</p>
          <p className="footnote">
            {prepared.profiles} profil(s) · Image personnalisée :{" "}
            {prepared.wallpaper ? "oui" : "non"}
          </p>
          <div className="button-row">
            <button
              className="secondary small"
              disabled={busy}
              onClick={() => setPrepared(null)}
            >
              Annuler
            </button>
            <button
              className="primary small"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const result = await api<{ preferences: Preferences }>(
                    "/backup/confirm",
                    { token: prepared.token },
                  );
                  const image = await loadServerWallpaper();
                  await wallpaperFile(image || null);
                  onImage(image ? URL.createObjectURL(image) : "");
                  update(result.preferences);
                  restored();
                  setPrepared(null);
                  notify(
                    "Configuration Livebox OS restaurée. Les paramètres Livebox n’ont pas été modifiés.",
                  );
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Confirmer la restauration <Check size={14} />
            </button>
          </div>
        </div>
      )}
      <p className="footnote">
        Les préférences et l’image importée sont aussi conservées sur le serveur
        local. Les mots de passe Livebox doivent être saisis à chaque nouvelle
        session.
      </p>
    </div>
  );
}
