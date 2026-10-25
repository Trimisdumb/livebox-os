import { useEffect, useId, useState, type ReactNode, type Dispatch, type SetStateAction } from 'react';
import { rec, text, duration, internetConnected, rate, type Session, type Snapshot } from './api';
import { Automations, DataView, Devices, Diagnostics, Feedback, History, Notifications, ResourcesPanel, VPN, useRemote } from './ControlPanels';
import { desktopPreferences, orderApplications } from './desktop';
import type { AppId, Preferences } from './App';
import type { Resource } from './ControlPanels';

type Open = (id: AppId) => void;
type AppDescription = { id: AppId; name: string };

export function V4Application({ children }: { children: ReactNode }) {
  return <div className="v4-application">{children}</div>;
}

export function Tabs({ tabs }: { tabs: { name: string; content: ReactNode }[] }) {
  const [selected, select] = useState(0);
  const id = useId();
  return <><div className="application-tabs" role="tablist" aria-label="Vues de l’application">{tabs.map((tab, index) => <button role="tab" key={tab.name} id={`${id}-${index}`} aria-controls={`${id}-panel`} tabIndex={selected === index ? 0 : -1} aria-selected={selected === index} onClick={() => select(index)} onKeyDown={e => {
    const next = e.key === 'ArrowRight' ? (index + 1) % tabs.length : e.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
    if (next === null) return;
    e.preventDefault(); select(next); e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next].focus();
  }}>{tab.name}</button>)}</div><div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${selected}`}>{tabs[selected].content}</div></>;
}

export function RouterApplication({ legacy }: { legacy: ReactNode }) {
  return <V4Application><Tabs tabs={[
    { name: 'Mes routeurs', content: <ResourcesPanel /> },
    { name: 'Connexion NAT TP-Link', content: legacy },
  ]} /></V4Application>;
}

export function DeviceApplication({ legacy }: { legacy: ReactNode }) {
  const resources = useRemote<Resource[]>('/control/resources', 30000);
  return <V4Application><Feedback {...resources} /><Tabs tabs={[
    { name: 'Tous les équipements', content: <Devices resources={resources.data || []} /> },
    { name: 'Détails Livebox', content: legacy },
  ]} /></V4Application>;
}

export function StatisticsApplication({ legacy }: { legacy: ReactNode }) {
  const resources = useRemote<Resource[]>('/control/resources', 30000);
  return <V4Application><Feedback {...resources} /><Tabs tabs={[
    { name: 'Débits Livebox', content: legacy },
    { name: 'Historique des équipements', content: <History resources={resources.data || []} /> },
  ]} /></V4Application>;
}

export function DiagnosticApplication({ legacy }: { legacy: ReactNode }) {
  const resources = useRemote<Resource[]>('/control/resources');
  return <V4Application><Feedback {...resources} /><Tabs tabs={[
    { name: 'Livebox et Internet', content: legacy },
    { name: 'Équipement enregistré', content: <Diagnostics resources={resources.data || []} /> },
  ]} /></V4Application>;
}

export function RegistryApplication({ kind, open }: { kind: 'servers' | 'vpn' | 'automations'; open: Open }) {
  if (kind === 'servers') return <V4Application><ResourcesPanel kind="server" /></V4Application>;
  return <RegistryView kind={kind} open={open} />;
}

function RegistryView({ kind, open }: { kind: 'vpn' | 'automations'; open: Open }) {
  const resources = useRemote<Resource[]>('/control/resources', kind === 'vpn' ? 30000 : 0);
  return <V4Application><Feedback {...resources} />{kind === 'vpn' ? <><VPN resources={resources.data || []} /><button onClick={() => open('servers')}>Ajouter ou connecter un serveur</button></> : <Automations resources={resources.data || []} />}</V4Application>;
}

export function NotificationApplication({ open }: { open: Open }) {
  return <V4Application><Notifications /><button onClick={() => open('automations')}>Configurer les règles de notification</button></V4Application>;
}

export function LiveboxTools({ connected, connect, open }: { connected: boolean; connect: () => void; open: Open }) {
  const [section, select] = useState('guest');
  const sections = [['guest', 'Wi-Fi invité'], ['schedule', 'Planification Wi-Fi'], ['wan', 'Connexion Internet'], ['lan', 'Réseau local'], ['dhcp', 'DHCP'], ['firewall', 'Pare-feu IPv4'], ['firewall6', 'Pare-feu IPv6'], ['ping', 'Réponse au ping WAN'], ['dmz', 'DMZ'], ['dyndns', 'DynDNS'], ['reboots', 'Historique des redémarrages'], ['info', 'Informations matérielles']];
  return <V4Application><h2>Fonctions Livebox</h2><p>Les lectures dépendent du firmware. Aucune donnée n’est inventée si le service est absent.</p>{connected ? <><label>Information à consulter<select value={section} onChange={e => select(e.target.value)}>{sections.map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label><DataView key={section} title={sections.find(([key]) => key === section)![1]} path={`/livebox/features/${section}`} /></> : <div className="cc-empty"><p>Connectez votre Livebox pour interroger ces services.</p><button className="cc-primary" onClick={connect}>Connecter ma Livebox</button></div>}<p className="cc-notice">Les actions invité, pare-feu et redémarrage se préparent dans la fiche du routeur enregistré, avec confirmation. La réinitialisation, les écritures DMZ/DynDNS et la restauration de configuration du routeur ne sont pas disponibles.</p><button onClick={() => open('archer')}>Ouvrir les routeurs enregistrés</button></V4Application>;
}

export function SecurityApplication({ session, open }: { session: Session; open: Open }) {
  return <V4Application><h2>Contrôles de configuration</h2><p>Ces lectures ne constituent pas un audit exhaustif de sécurité.</p><div className="cc-actions"><button onClick={() => open('livebox-tools')}>Lire les paramètres du pare-feu</button><button onClick={() => open('advanced-nat')}>Examiner les redirections</button><button onClick={() => open('devices')}>Examiner les appareils</button></div>{session.connected ? <><DataView title="Pare-feu IPv4" path="/livebox/features/firewall" /><DataView title="Exposition DMZ déclarée" path="/livebox/features/dmz" /><DataView title="Wi-Fi invité déclaré" path="/livebox/features/guest" /></> : <p className="cc-empty">Aucune Livebox connectée. Les contrôles apparaîtront après connexion.</p>}<p className="cc-notice">La présence d’une redirection ne prouve pas son accessibilité depuis Internet. L’analyse automatisée UPnP, les recommandations DNS et le contrôle de sécurité radio restent à développer.</p></V4Application>;
}

export function AuditApplication({ legacy }: { legacy: ReactNode }) {
  const state = useRemote<{ time: number; message: string; source: string }[]>('/incidents', 30000);
  const audit = <><h2>Observations et actions du backend</h2><Feedback {...state} />{!state.data?.length && !state.busy && <p className="cc-empty">Aucun événement enregistré. Les observations et actions confirmées apparaîtront ici.</p>}{state.data?.map((entry, index) => <article className="cc-row" key={index}><time>{new Date(entry.time * 1000).toLocaleString()}</time><div><p>{entry.message}</p><small>{entry.source}</small></div></article>)}</>;
  return <V4Application><Tabs tabs={[{ name: 'Audit local', content: audit }, { name: 'Événements Livebox', content: legacy }]} /></V4Application>;
}

function savedWidgets(): string[] {
  try { const v = JSON.parse(localStorage.getItem('livebox-widgets') || 'null'); if (Array.isArray(v) && v.every(w => ['connection', 'equipment', 'history'].includes(w))) return v; } catch { /* Storage may be blocked. */ }
  return ['connection', 'equipment', 'history'];
}

export function OverviewApplication({ session, snapshot, connect, open, statistics }: { session: Session; snapshot: Snapshot; connect: () => void; open: Open; statistics: ReactNode }) {
  const resources = useRemote<Resource[]>('/control/resources', 30000);
  const [view, setView] = useState('simple');
  const [widgets, setWidgets] = useState(savedWidgets);
  const [error, setError] = useState('');
  const wan = rec(snapshot.wan?.data), info = rec(snapshot.info?.data);
  useEffect(() => { try { localStorage.setItem('livebox-widgets', JSON.stringify(widgets)); } catch { setError('Le navigateur ne peut pas enregistrer le choix des sections.'); } }, [widgets]);
  const metrics = [['Adresse WAN', wan.IPAddress], ['Adresse du routeur', session.url], ['Type de connexion', wan.LinkType], ['Réception', snapshot.rate?.down == null ? null : `${rate(snapshot.rate.down)} Mbit/s`], ['Envoi', snapshot.rate?.up == null ? null : `${rate(snapshot.rate.up)} Mbit/s`], ['Uptime', info.UpTime == null ? null : duration(info.UpTime)]];
  return <V4Application><h2>Vue réseau</h2><Feedback error={error || resources.error} busy={resources.busy} /><div className="cc-toolbar"><label>Vue<select value={view} onChange={e => setView(e.target.value)}><option value="simple">Simplifiée</option><option value="advanced">Avancée</option><option value="admin">Administrateur</option></select></label><details><summary>Sections affichées</summary>{[['connection', 'Connexion'], ['equipment', 'Équipements'], ['history', 'Débits Livebox']].map(([key, label]) => <label className="cc-check" key={key}><input type="checkbox" checked={widgets.includes(key)} onChange={e => setWidgets(e.target.checked ? [...widgets, key] : widgets.filter(w => w !== key))} />{label}</label>)}</details></div>
    {widgets.includes('connection') && <section className="cc-section"><h3>{!session.connected ? 'Livebox non connectée' : !snapshot.wan?.available ? 'État Internet non disponible' : internetConnected(snapshot) ? 'Connexion Internet établie' : 'Connexion Internet non établie'}</h3>{!session.connected && <button onClick={connect}>Connecter ma Livebox</button>}<dl className="cc-facts">{metrics.slice(0, view === 'simple' ? 4 : metrics.length).map(([key, value]) => <div key={key as string}><dt>{key as string}</dt><dd>{text(value)}</dd></div>)}</dl></section>}
    {widgets.includes('equipment') && <section className="cc-section"><h3>Équipements enregistrés</h3>{resources.data?.length ? resources.data.map(r => <article className="cc-row" key={r.id}><div><strong>{r.name}</strong><p>{r.host} · {!r.connected ? 'À reconnecter' : r.observation?.summary.reachable ? 'Lecture réussie' : 'Lecture indisponible'}</p></div><button onClick={() => open(r.kind === 'server' ? 'servers' : 'archer')}>Consulter</button></article>) : <p className="cc-empty">Aucun équipement dans le registre.</p>}</section>}
    {view === 'admin' && <section className="cc-section"><p>Cette présentation ne crée pas un rôle distinct. L’application utilise encore le compte administrateur local.</p><div className="cc-actions"><button onClick={() => open('security')}>Sécurité</button><button onClick={() => open('backup')}>Sauvegarde</button><button onClick={() => open('journal')}>Journal</button></div></section>}
    {widgets.includes('history') && statistics}
  </V4Application>;
}

export function ApplicationSettings({ density, setDensity, preferences, update, open }: { density: string; setDensity: (value: 'comfortable' | 'compact') => void; preferences: Preferences; update: Dispatch<SetStateAction<Preferences>>; open: Open }) {
  const [message, setMessage] = useState('');
  const health = useRemote<{ version: string }>('/health');
  function exportSettings() {
    const blob = new Blob([JSON.stringify({ schema: 2, density, widgets: savedWidgets(), desktop: desktopPreferences(preferences.desktop) }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = 'livebox-os-preferences.json'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <V4Application><h2>Paramètres de l’application</h2><label>Densité des vues réseau<select value={density} onChange={e => setDensity(e.target.value as 'comfortable' | 'compact')}><option value="comfortable">Confortable</option><option value="compact">Compacte</option></select></label><p>Les paramètres du bureau, du dock et des fenêtres se règlent dans Personnalisation. L’intervalle de collecte se choisit par équipement.</p><div className="cc-actions"><button onClick={() => open('personalization')}>Personnaliser mon bureau</button><button onClick={exportSettings}>Exporter les préférences non sensibles</button></div><label className="cc-file">Importer les préférences<input type="file" accept="application/json,.json" onChange={async e => {
      const file = e.target.files?.[0]; if (!file) return;
      try {
        if (file.size > 16384) throw new Error('Fichier trop volumineux.');
        const data = JSON.parse(await file.text());
        if (![1, 2].includes(data.schema) || !['comfortable', 'compact'].includes(data.density) || !Array.isArray(data.widgets) || data.widgets.some((w: unknown) => !['connection', 'equipment', 'history'].includes(String(w)))) throw new Error('Format de préférences invalide.');
        localStorage.setItem('livebox-widgets', JSON.stringify(data.widgets)); setDensity(data.density);
        if (data.schema === 2 && data.desktop && typeof data.desktop === 'object') update(p => ({ ...p, desktop: desktopPreferences(data.desktop) }));
        setMessage('Préférences importées. Votre image et votre thème actuels sont conservés.');
      } catch (e) { setMessage((e as Error).message); }
    }} /></label>{message && <p role="status">{message}</p>}<Feedback {...health} /><p>Version : {health.data?.version || 'Lecture en cours'}. Développement V4, sans release stable.</p><p>La traduction complète et les rôles utilisateurs restent à développer. Les intégrations non compatibles sont indiquées dans chaque application.</p><a href="https://github.com/Trimisdumb/livebox-os/releases" target="_blank" rel="noreferrer">Consulter les versions publiées</a></V4Application>;
}

export function DesktopAppearance({ preferences, update, apps }: { preferences: Preferences; update: Dispatch<SetStateAction<Preferences>>; apps: AppDescription[] }) {
  const value = desktopPreferences(preferences.desktop);
  const [selected, select] = useState(apps[0].id);
  function set(patch: Partial<typeof value>) { update(p => ({ ...p, desktop: { ...desktopPreferences(p.desktop), ...patch } })); }
  const ordered = orderApplications(apps, value.icon_order);
  function move(delta: number) {
    const order = ordered.map(a => a.id), index = order.indexOf(selected), target = index + delta;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]]; set({ icon_order: order });
  }
  return <V4Application><h3>Bureau, dock et fenêtres</h3><div className="cc-fields"><label>Taille des icônes<select value={value.icon_size} onChange={e => set({ icon_size: e.target.value as typeof value.icon_size })}><option value="small">Petite</option><option value="medium">V3, taille habituelle</option><option value="large">Grande</option></select></label><label>Couleur des actions<select value={value.accent} onChange={e => set({ accent: e.target.value as typeof value.accent })}><option value="orange">Orange</option><option value="amber">Ambre</option></select></label><label>Position horizontale du fond ({value.wallpaper_x} %)<input type="range" min={0} max={100} value={value.wallpaper_x} onChange={e => set({ wallpaper_x: Number(e.target.value) })} /></label><label>Position verticale du fond ({value.wallpaper_y} %)<input type="range" min={0} max={100} value={value.wallpaper_y} onChange={e => set({ wallpaper_y: Number(e.target.value) })} /></label></div>
    <label className="cc-check"><input type="checkbox" checked={value.remember_windows} onChange={e => set({ remember_windows: e.target.checked })} />Mémoriser les positions et dimensions sur ce navigateur</label><label className="cc-check"><input type="checkbox" checked={value.animations} onChange={e => set({ animations: e.target.checked })} />Activer les animations discrètes (les préférences du système restent prioritaires)</label>
    <div className="cc-fields"><label>Application à déplacer<select value={selected} onChange={e => select(e.target.value as AppId)}>{ordered.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label><div className="cc-actions"><button disabled={ordered[0].id === selected} onClick={() => move(-1)}>Monter</button><button disabled={ordered.at(-1)?.id === selected} onClick={() => move(1)}>Descendre</button><button onClick={() => set({ icon_order: [] })}>Ordre par défaut</button></div></div>
    <details><summary>Applications épinglées au dock</summary><p>Les fenêtres ouvertes restent accessibles, même si leur application n’est pas épinglée.</p>{apps.map(a => <label className="cc-check" key={a.id}><input type="checkbox" checked={value.dock_pinned === null || value.dock_pinned.includes(a.id)} onChange={e => { const current = value.dock_pinned || apps.map(v => v.id); set({ dock_pinned: e.target.checked ? [...new Set([...current, a.id])] : current.filter(id => id !== a.id) }); }} />{a.name}</label>)}<button onClick={() => set({ dock_pinned: null })}>Dock par défaut</button></details><p>Ces options ne remplacent pas l’image importée. Les positions de fenêtres restent locales au navigateur.</p>
  </V4Application>;
}
