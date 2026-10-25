import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Activity, Network, Shield, Settings2, Search, Sun, Moon, LogOut, Menu } from 'lucide-react';
import { rec, text, duration, internetConnected, rate, type Session, type Snapshot } from './api';
import type { AppId } from './App';
import { Automations, DataView, Devices, Diagnostics, Feedback, History, Notifications, ResourcesPanel, VPN, useRemote } from './ControlPanels';
import type { Resource } from './ControlPanels';

const groups = [
  { name: 'Vue réseau', icon: Network, pages: [['dashboard', 'Tableau de bord'], ['status', 'Livebox'], ['routers', 'Routeurs'], ['devices', 'Appareils'], ['settings', 'Wi-Fi'], ['lan', 'Réseau local'], ['internet', 'Internet']] },
  { name: 'Accès et protection', icon: Shield, pages: [['vpn', 'VPN'], ['security', 'Sécurité'], ['firewall', 'Pare-feu'], ['advanced-nat', 'NAT et ports'], ['dns', 'DNS et DHCP']] },
  { name: 'Exploitation', icon: Activity, pages: [['stats', 'Statistiques'], ['diagnostics', 'Diagnostics'], ['automations', 'Automatisations'], ['notifications', 'Notifications'], ['servers', 'Serveurs'], ['journal', 'Journaux']] },
  { name: 'Application', icon: Settings2, pages: [['preferences', 'Paramètres'], ['profiles', 'Profils Livebox'], ['personalization', 'Personnalisation'], ['backup', 'Sauvegarde'], ['storage', 'Stockage'], ['phone', 'Téléphone']] },
];
const labels = Object.fromEntries(groups.flatMap(g => g.pages));

type Props = {
  session: Session; snapshot: Snapshot; panel: (id: AppId) => ReactNode; connect: () => void;
  logout: () => void; desktop: () => void; theme: 'light' | 'dark'; toggleTheme: () => void;
  requestedApp: { id: AppId; revision: number } | null;
};

function saved<T>(key: string, fallback: T): T {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    if (key === 'livebox-density' && !['comfortable', 'compact'].includes(value)) return fallback;
    if (key === 'livebox-widgets' && (!Array.isArray(value) || value.some(w => !['connection', 'equipment', 'history'].includes(w)))) return fallback;
    return value ?? fallback;
  } catch { return fallback; }
}

function save(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}

export default function ControlCenter(props: Props) {
  const [page, setPage] = useState('dashboard');
  const [query, search] = useState('');
  const [menu, showMenu] = useState(false);
  const navigationSearch = useRef<HTMLInputElement>(null);
  const mobileMenu = useRef<HTMLButtonElement>(null);
  const contentArea = useRef<HTMLDivElement>(null);
  const resources = useRemote<Resource[]>('/control/resources', 30000);
  const [density, setDensity] = useState<'comfortable' | 'compact'>(() => saved('livebox-density', 'comfortable'));
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    const id = props.requestedApp?.id;
    if (id) setPage(id === 'archer' ? 'routers' : id === 'ports' ? 'advanced-nat' : id === 'monitor' ? 'stats' : id === 'topology' ? 'dashboard' : id);
  }, [props.requestedApp]);
  useEffect(() => { setStorageError(!save('livebox-density', density)); }, [density]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { if (menu) mobileMenu.current?.focus(); showMenu(false); search(''); } };
    const resize = () => { if (innerWidth > 700) showMenu(false); };
    window.addEventListener('keydown', escape);
    window.addEventListener('resize', resize);
    return () => { window.removeEventListener('keydown', escape); window.removeEventListener('resize', resize); };
  }, [menu]);
  useEffect(() => { if (menu) navigationSearch.current?.focus(); }, [menu]);
  useEffect(() => { contentArea.current?.scrollTo({ top: 0 }); }, [page]);
  function navigate(value: string) { setPage(value); showMenu(false); search(''); }
  const pages = groups.flatMap(g => g.pages).filter(([, label]) => label.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const native = ['status', 'settings', 'advanced-nat', 'profiles', 'personalization', 'backup', 'storage', 'phone'];
  let content: ReactNode;
  if (page === 'dashboard') content = <Dashboard {...props} resources={resources.data || []} navigate={navigate} />;
  else if (page === 'routers') content = <><ResourcesPanel onChange={() => void resources.load()} /><details className="cc-section"><summary>Connexion TP-Link existante et NAT compatible</summary>{props.panel('archer')}</details></>;
  else if (page === 'servers') content = <ResourcesPanel kind="server" onChange={() => void resources.load()} />;
  else if (page === 'devices') content = <Devices resources={resources.data || []} />;
  else if (page === 'vpn') content = <VPN resources={resources.data || []} />;
  else if (page === 'automations') content = <Automations resources={resources.data || []} />;
  else if (page === 'notifications') content = <Notifications />;
  else if (page === 'stats') content = <>{props.panel('stats')}<History resources={resources.data || []} /></>;
  else if (page === 'diagnostics') content = <><Diagnostics resources={resources.data || []} /><details className="cc-section"><summary>Diagnostics Livebox et connexion Internet de la V3</summary>{props.panel('diagnostics')}</details></>;
  else if (page === 'journal') content = <Audit />;
  else if (page === 'security') content = <Security session={props.session} navigate={navigate} />;
  else if (page === 'firewall') content = props.session.connected ? <><DataView title="Niveau IPv4" path="/livebox/features/firewall" /><DataView title="Niveau IPv6" path="/livebox/features/firewall6" /><DataView title="Réponse au ping WAN" path="/livebox/features/ping" /><p className="cc-notice">Les modifications du pare-feu se préparent depuis la page du routeur enregistré, avec confirmation renforcée.</p></> : <Connect connect={props.connect} />;
  else if (page === 'dns' || page === 'lan') content = props.session.connected ? <><DataView title="Adresse et réseau LAN" path="/read/lan" /><DataView title="Pool DHCP retourné par la Livebox" path="/read/dhcp" /><p className="cc-notice">La configuration DHCP existante est disponible dans Wi-Fi, section Réseau local. Intégrations Pi-hole, AdGuard Home et Unbound : non disponibles.</p><button onClick={() => navigate('settings')}>Ouvrir les réglages Livebox</button></> : <Connect connect={props.connect} />;
  else if (page === 'internet') content = props.session.connected ? <><DataView title="Connexion WAN" path="/livebox/features/wan" /><DataView title="DynDNS déclaré" path="/livebox/features/dyndns" /><DataView title="Historique des redémarrages fourni par le firmware" path="/livebox/features/reboots" /></> : <Connect connect={props.connect} />;
  else if (page === 'preferences') content = <Preferences density={density} setDensity={setDensity} theme={props.theme} toggleTheme={props.toggleTheme} navigate={navigate} />;
  else if (native.includes(page)) content = props.panel(page as AppId);
  else content = <p className="cc-empty">Cette application est disponible dans le bureau classique.</p>;
  return <div className={`control-center density-${density}`}>
    <a className="cc-skip" href="#control-content">Aller au contenu</a>
    <header className="cc-header"><a href="#" onClick={e => { e.preventDefault(); navigate('dashboard'); }} className="cc-brand"><img src="/livebox-logo.svg" alt="" /><span>Livebox <b>OS</b><small>Centre réseau · développement V4</small></span></a>
      <div className="cc-header-actions"><button onClick={props.toggleTheme} aria-label={props.theme === 'light' ? 'Activer le thème sombre' : 'Activer le thème clair'}>{props.theme === 'light' ? <Moon size={19} /> : <Sun size={19} />}</button><button onClick={props.desktop}>Bureau classique</button><button onClick={props.logout} aria-label="Verrouiller Livebox OS"><LogOut size={17} /><span>Verrouiller</span></button></div>
    </header>
    <div className="cc-workspace"><aside className={`cc-navigation ${menu ? 'is-open' : ''}`} aria-label="Navigation principale"><label className="cc-search"><Search size={17} /><span className="sr-only">Rechercher une rubrique</span><input ref={navigationSearch} type="search" placeholder="Rechercher un réglage" value={query} onChange={e => search(e.target.value)} /></label>
      {query ? <div className="cc-search-results"><p>{pages.length} rubrique(s)</p>{pages.map(([id, label]) => <button key={id} onClick={() => navigate(id)}>{label}</button>)}</div> : groups.map(group => <section key={group.name}><h2><group.icon size={16} />{group.name}</h2>{group.pages.map(([id, label]) => <button key={id} aria-current={page === id ? 'page' : undefined} onClick={() => navigate(id)}>{label}</button>)}</section>)}
      <p className="cc-nav-note">Aucune donnée simulée.<br />Les sessions routeur restent côté backend.</p>
    </aside><div ref={contentArea} id="control-content" className="cc-content" tabIndex={-1} inert={menu}><div className="cc-page-title"><div><p>{groups.find(g => g.pages.some(([id]) => id === page))?.name || 'Réseau'}</p><h1>{labels[page] || page}</h1></div><span>{props.session.connected ? props.session.name : 'Livebox non connectée'}</span></div>
      <Feedback {...resources} />{storageError && <p role="status">Le navigateur ne permet pas d’enregistrer les préférences locales.</p>}{content}
      <footer className="cc-footer">V4 en développement · données disponibles selon le connecteur et le firmware · <a href="https://github.com/Trimisdumb/livebox-os/tree/develop/v4" target="_blank" rel="noreferrer">Code source et compatibilité</a></footer>
    </div></div>
    <nav className="cc-mobile-nav" aria-label="Navigation mobile"><button aria-current={page === 'dashboard' ? 'page' : undefined} onClick={() => navigate('dashboard')}>Vue réseau</button><button aria-current={page === 'routers' ? 'page' : undefined} onClick={() => navigate('routers')}>Routeurs</button><button aria-current={page === 'notifications' ? 'page' : undefined} onClick={() => navigate('notifications')}>Alertes</button><button ref={mobileMenu} aria-expanded={menu} onClick={() => showMenu(!menu)}><Menu size={18} />Menu</button></nav>
  </div>;
}

function Connect({ connect }: { connect: () => void }) {
  return <section className="cc-empty"><h2>Connecter votre Livebox</h2><p>Les informations apparaîtront après authentification auprès de votre équipement.</p><button className="cc-primary" onClick={connect}>Connecter la Livebox</button></section>;
}

function Dashboard(props: Props & { resources: Resource[]; navigate: (page: string) => void }) {
  const [view, setView] = useState('simple');
  const [widgets, setWidgets] = useState<string[]>(() => saved('livebox-widgets', ['connection', 'equipment', 'history']));
  const [storageError, setStorageError] = useState(false);
  const info = rec(props.snapshot.info?.data);
  const wan = rec(props.snapshot.wan?.data);
  const connected = internetConnected(props.snapshot);
  const metrics = [
    ['Adresse WAN', wan.IPAddress], ['Routeur local', props.session.url], ['Type de connexion', wan.LinkType],
    ['Débit descendant', props.snapshot.rate?.down == null ? null : rate(props.snapshot.rate.down) + ' Mbit/s'], ['Débit montant', props.snapshot.rate?.up == null ? null : rate(props.snapshot.rate.up) + ' Mbit/s'],
    ['Uptime déclaré', info.UpTime == null ? null : duration(info.UpTime)], ['Latence', null], ['Perte de paquets', null], ['VPN', null], ['Pare-feu', null],
  ];
  useEffect(() => { setStorageError(!save('livebox-widgets', widgets)); }, [widgets]);
  return <><div className="cc-toolbar"><label>Vue<select value={view} onChange={e => setView(e.target.value)}><option value="simple">Simplifiée</option><option value="advanced">Avancée</option><option value="admin">Administrateur</option></select></label><details><summary>Choisir les sections</summary>{[['connection', 'Connexion'], ['equipment', 'Équipements'], ['history', 'Historique Livebox']].map(([key, name]) => <label className="cc-check" key={key}><input type="checkbox" checked={widgets.includes(key)} onChange={e => setWidgets(e.target.checked ? [...widgets, key] : widgets.filter(w => w !== key))} />{name}</label>)}</details></div>
    {storageError && <p role="status">Le choix des widgets ne peut pas être enregistré dans ce navigateur.</p>}
    {widgets.includes('connection') && <section className="cc-connection"><div><p>Connexion Internet de la Livebox</p><h2>{!props.session.connected ? 'Votre réseau commence ici.' : !props.snapshot.wan ? 'Lecture de la connexion…' : !props.snapshot.wan.available ? 'État Internet non disponible' : connected ? 'Connexion Internet établie' : 'Connexion Internet non établie'}</h2><p>{props.session.connected ? `${props.session.name} · ${props.session.url}` : 'Connectez votre Livebox ou ajoutez un routeur compatible. Les mesures restent vides tant qu’elles ne sont pas disponibles.'}</p></div><button className="cc-primary" onClick={props.session.connected ? () => props.navigate('status') : props.connect}>{props.session.connected ? 'Consulter la Livebox' : 'Connecter ma Livebox'}</button>
      <dl className="cc-facts">{metrics.slice(0, view === 'simple' ? 4 : metrics.length).map(([label, value]) => <div key={label as string}><dt>{label as string}</dt><dd>{text(value)}</dd></div>)}</dl>
      <p className="cc-source">{props.snapshot.updated ? `Dernière observation : ${new Date(props.snapshot.updated * 1000).toLocaleString()}` : 'Aucune observation Livebox disponible.'} Les débits sont calculés à partir des compteurs du routeur. Les diagnostics se lancent séparément.</p>
    </section>}
    {widgets.includes('equipment') && <section className="cc-section"><div className="cc-heading"><h2>Équipements du registre</h2><button onClick={() => props.navigate('routers')}>Gérer les routeurs</button></div>{!props.resources.length ? <p className="cc-empty">Aucun équipement dans le nouveau registre. Les connexions existantes restent disponibles dans Livebox et Routeurs.</p> : props.resources.map(r => <article key={r.id} className="cc-row"><div><h3>{r.name}</h3><p>{r.host} · {r.connector}</p></div><p>{!r.connected ? 'À reconnecter' : r.observation?.summary.reachable ? 'Lecture réussie' : 'Lecture indisponible'}</p><button onClick={() => props.navigate(r.kind === 'server' ? 'servers' : 'routers')}>Consulter</button></article>)}</section>}
    {view === 'admin' && <section className="cc-section"><h2>Administration de l’application</h2><p>Cette vue présente les outils d’administration. Elle ne constitue pas un rôle d’accès distinct ; l’authentification actuelle reste celle de l’administrateur local.</p><div className="cc-actions"><button onClick={() => props.navigate('security')}>Examiner les contrôles de sécurité</button><button onClick={() => props.navigate('backup')}>Sauvegarder l’application</button><button onClick={() => props.navigate('journal')}>Lire l’audit</button></div></section>}
    {widgets.includes('history') && props.session.connected && <section className="cc-section">{props.panel('stats')}</section>}
  </>;
}

function Security({ session, navigate }: { session: Session; navigate: (value: string) => void }) {
  return <section className="cc-section"><h2>Contrôles de configuration</h2><p>Ces lectures décrivent la configuration retournée par le routeur. Elles ne garantissent pas la sécurité du réseau.</p><div className="cc-actions"><button onClick={() => navigate('firewall')}>Lire le pare-feu</button><button onClick={() => navigate('advanced-nat')}>Examiner les redirections</button><button onClick={() => navigate('devices')}>Examiner les appareils</button></div>{session.connected && <><DataView title="Exposition DMZ déclarée" path="/livebox/features/dmz" /><DataView title="Wi-Fi invité déclaré" path="/livebox/features/guest" /></>}<p className="cc-notice">Vérifiez chaque redirection et supprimez celles dont vous n’avez plus besoin. L’accès public à l’administration reste déconseillé. L’analyse automatisée UPnP, les recommandations DNS et le contrôle de la sécurité radio restent à développer.</p></section>;
}

function Audit() {
  const state = useRemote<{ time: number; message: string; source: string }[]>('/incidents', 30000);
  return <section className="cc-section"><h2>Observations et actions du backend</h2><Feedback {...state} />{!state.data?.length && !state.busy && <p className="cc-empty">Aucun événement enregistré pour le moment. Les observations et actions confirmées apparaîtront ici.</p>}{state.data?.map((entry, index) => <article className="cc-row" key={index}><time>{new Date(entry.time * 1000).toLocaleString()}</time><div><p>{entry.message}</p><small>{entry.source}</small></div></article>)}</section>;
}

function Preferences({ density, setDensity, theme, toggleTheme, navigate }: { density: string; setDensity: (value: 'comfortable' | 'compact') => void; theme: string; toggleTheme: () => void; navigate: (value: string) => void }) {
  const [message, setMessage] = useState('');
  const health = useRemote<{ version: string }>('/health');
  function exportSettings() {
    const blob = new Blob([JSON.stringify({ schema: 1, density, widgets: saved('livebox-widgets', ['connection', 'equipment', 'history']) }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'livebox-os-preferences.json'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="cc-section"><h2>Affichage et préférences</h2><div className="cc-fields"><label>Densité<select value={density} onChange={e => setDensity(e.target.value as 'comfortable' | 'compact')}><option value="comfortable">Confortable</option><option value="compact">Compacte</option></select></label><div><p>Thème : {theme === 'dark' ? 'sombre' : 'clair'}</p><button onClick={toggleTheme}>Changer le thème</button></div></div><p>La fréquence de collecte se choisit par équipement (30 secondes à une heure). Les widgets et la densité sont enregistrés sur ce navigateur ; le thème et les fonds utilisent les préférences existantes.</p><div className="cc-actions"><button onClick={exportSettings}>Exporter les préférences non sensibles</button><button onClick={() => navigate('personalization')}>Fond d’écran et apparence du bureau</button></div><label className="cc-file">Importer les préférences<input type="file" accept="application/json,.json" onChange={async e => {
      const file = e.target.files?.[0]; if (!file) return;
      try {
        if (file.size > 4096) throw new Error('Fichier trop volumineux.');
        const data = JSON.parse(await file.text());
        if (data.schema !== 1 || !['comfortable', 'compact'].includes(data.density) || !Array.isArray(data.widgets) || data.widgets.some((w: unknown) => !['connection', 'equipment', 'history'].includes(String(w)))) throw new Error('Format de préférences invalide.');
        setDensity(data.density); localStorage.setItem('livebox-widgets', JSON.stringify(data.widgets)); setMessage('Préférences importées.');
      } catch (e) { setMessage((e as Error).message); }
    }} /></label>{message && <p role="status">{message}</p>}<h3>Version et accès</h3><p>Base API : {health.data?.version || 'Non disponible'}. Branche V4 en développement ; aucune release V4 officielle.</p><p>Interface française. Traduction complète, rôles utilisateurs, permissions par équipement et changement de couleur d’accent : non disponibles.</p><a href="https://github.com/Trimisdumb/livebox-os/releases" target="_blank" rel="noreferrer">Consulter les versions publiées sur GitHub</a></section>;
}
