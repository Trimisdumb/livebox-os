import { useCallback, useEffect, useState } from 'react';
import { Activity, ArrowDown, Check, Network, RefreshCw, Router, ShieldCheck } from 'lucide-react';
import { api, rec, rows, text, duration, type RecordData, type Result, type LogEntry } from './api';

type Device = { ip: string; name: string; mac?: string; router: string; connection?: string; active?: boolean };
type Topology = { devices: Device[]; livebox: RecordData | null; tplink: RecordData | null; link_verified: boolean; updated: number };
type TPState = { connected: boolean; compatible?: boolean; identity?: RecordData; reads?: Record<string, Result>; history?: { time: number; available: boolean; data: RecordData | null }[]; updated?: number; url?: string };
type NATRule = { id: string; description: string; externalPort: string; internalPort: string; destinationIPAddress: string; protocol: string; enabled: boolean | null; router: string };
type Operation = { id: string; name: string; status: string; observed_status?: string; action: string; rules: NATRule[]; old_rules: NATRule[]; error?: string; updated: number };
type NATState = { rules: Record<string, Result>; operations: Operation[]; public_reachability: string };
type Form = { name: string; target: string; destination: string; external: number; internal: number; protocol: string };
type Prepared = { token: string; plan: Operation; warning: string };

function useNetwork<T>(path: string, poll = true) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try { setData(await api<T>(path)); setError(''); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [path]);
  useEffect(() => { void load(); if (!poll) return; const timer = setInterval(() => void load(), 30000); return () => clearInterval(timer); }, [load, poll]);
  return { data, error, busy, load };
}

function Details({ data, title = 'Réponse réelle de l’API' }: { data: unknown; title?: string }) {
  return <details className="network-details"><summary>{title}</summary><pre>{JSON.stringify(data, null, 2)}</pre></details>;
}
function Heading({ title, subtitle, load, busy }: { title: string; subtitle: string; load: () => void; busy: boolean }) {
  return <div className="panel-heading"><div><h2>{title}</h2><p>{subtitle}</p></div><button className="secondary small" disabled={busy} onClick={load}><RefreshCw size={14} />Actualiser</button></div>;
}

function RouterData({ data, section }: { data: unknown; section: string }) {
  const value = rec(data);
  const statusLabels: Record<string, string> = { wan_ipv4_ipaddr: 'Adresse WAN', wan_ipv4_gateway: 'Passerelle WAN', wan_ipv4_netmask: 'Masque WAN', lan_ipv4_ipaddr: 'Adresse LAN', lan_ipv4_netmask: 'Masque LAN', lan_ipv4_dhcp_enable: 'Serveur DHCP', cpu_usage: 'Processeur', mem_usage: 'Mémoire', wan_ipv4_uptime: 'Connexion WAN', wireless_2g_ssid: 'Wi-Fi 2,4 GHz', wireless_2g_current_channel: 'Canal 2,4 GHz', wireless_5g_ssid: 'Wi-Fi 5 GHz', wireless_5g_current_channel: 'Canal 5 GHz' };
  const visible = section === 'status' ? Object.keys(statusLabels).filter(key => key in value) : Object.keys(value).filter(key => value[key] !== null && value[key] !== '' && typeof value[key] !== 'object' && !/password|passwd|(?:psk|wep|wpa)_key/i.test(key));
  function format(key: string) { const item = value[key]; return ['cpu_usage', 'mem_usage'].includes(key) && typeof item === 'number' ? `${(item * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %` : key === 'wan_ipv4_uptime' ? duration(item) : text(item); }
  const clients = ['access_devices_wired', 'access_devices_wireless_host', 'access_devices_wireless_guest'].flatMap(key => rows(value[key]).map<RecordData & { connection: string }>(item => ({ ...item, connection: key === 'access_devices_wired' ? 'Ethernet' : 'Wi-Fi' })));
  return <><div className="table-wrap"><table><tbody>{visible.map(key => <tr key={key}><th>{statusLabels[key] || key}</th><td>{format(key)}</td></tr>)}</tbody></table></div>{section === 'status' && <><h3 className="section-title">Appareils déclarés par l’AX58 ({clients.length})</h3><div className="table-wrap"><table><thead><tr><th>Appareil</th><th>IPv4</th><th>Connexion</th></tr></thead><tbody>{clients.map((item, i) => <tr key={i}><td>{text(item.hostname || item.name)}</td><td>{text(item.ipaddr)}</td><td>{item.connection}</td></tr>)}</tbody></table></div></>}<Details data={data} title="Données reçues du TP-Link (clés sensibles masquées)" /></>;
}

export function ArcherPanel() {
  const { data, error, busy, load } = useNetwork<TPState>('/network/tplink');
  const [url, setURL] = useState('http://192.168.0.1');
  const [password, setPassword] = useState('');
  const [force, setForce] = useState(false);
  const [reconnect, setReconnect] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const [tab, setTab] = useState('status');
  return <div className="panel network-panel"><Heading title="Archer AX58" subtitle="V1.0 · firmware 1.5.2 · 20250812 rel.38324(4555)" load={load} busy={busy} />
    {(error || message) && <p className="info-note" role="status">{error || message}</p>}
    {!data?.connected ? <form className="inset-form" onSubmit={async e => { e.preventDefault(); setWorking(true); setMessage(''); try { await api('/network/tplink/login', { url, password, force, reconnect }); setPassword(''); await load(); } catch (e) { setMessage((e as Error).message); } finally { setWorking(false); } }}>
      <div className="form-grid"><label>Adresse privée du routeur<input required value={url} onChange={e => setURL(e.target.value)} autoComplete="url" /></label><label>Mot de passe administrateur<input type="password" required value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /></label></div>
      <label className="check-line"><input type="checkbox" checked={reconnect} onChange={e => setReconnect(e.target.checked)} />Autoriser une reconnexion de lecture (mot de passe en mémoire backend, 8 h maximum)</label>
      <label className="check-line"><input type="checkbox" checked={force} onChange={e => setForce(e.target.checked)} />Confirmer le remplacement d’une autre session administrateur TP-Link</label>
      <button className="primary" disabled={working}>{working ? 'Connexion…' : 'Connecter mon AX58'}</button>
    </form> : <>
      <div className="setting-card"><Router size={28} /><div><h3>Session chiffrée établie</h3><p>{data.url} · {data.compatible ? 'Identité et firmware compatibles confirmés' : 'Identité non confirmée : écritures bloquées'}</p></div><button className="secondary small" onClick={async () => { await api('/network/tplink/logout', {}); await load(); }}>Déconnecter</button></div>
      <Details data={data.identity} title="Identité matérielle déclarée par le routeur" />
      <div className="tabs">{[['status', 'État'], ['network', 'WAN / LAN'], ['wan', 'WAN'], ['wifi2', 'Wi-Fi 2,4 GHz'], ['wifi5', 'Wi-Fi 5 GHz'], ['leases', 'DHCP'], ['ports', 'NAT']].map(([id, label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}</div>
      {data.reads?.[tab]?.available ? tab === 'ports' ? <NativeNATPanel rules={data.reads[tab].data as NATRule[]} refresh={load} /> : <RouterData data={data.reads[tab].data} section={tab} /> : <p className="info-note">{data.reads?.[tab]?.message || 'Lecture en cours…'}</p>}
      <p className="footnote">Les redirections se gèrent dans « NAT avancé ». Les paramètres Wi-Fi sont consultables ; leur modification n’est pas activée sans signature d’écriture vérifiée sur ce firmware.</p>
    </>}
  </div>;
}

export function TopologyPanel() {
  const { data, error, busy, load } = useNetwork<Topology>('/network/topology');
  const [selected, setSelected] = useState<unknown>();
  return <div className="panel network-panel"><Heading title="Topologie réseau" subtitle="Rattachements déclarés par chaque routeur, actualisés toutes les 30 secondes." load={load} busy={busy} />
    {error && <p role="alert">{error}</p>}
    <div className="topology-tree"><div className="topology-root"><Network size={24} /><strong>Internet</strong><small>Accessibilité des services non testée</small></div><ArrowDown className="tree-arrow" />
      <button className="topology-root" onClick={() => setSelected(data?.livebox)}><Router size={25} /><strong>Livebox 5</strong><small>{data?.livebox ? `LAN ${text(data.livebox.lan)}` : 'Connexion Livebox nécessaire'}</small></button>
      <div className="topology-devices">{data?.devices.filter(d => d.router === 'livebox').map((d, i) => <button key={i} className="topology-device" onClick={() => setSelected(d)}><Network size={17} /><strong>{d.name}</strong><small>{d.ip} · {d.active === false ? 'Absent' : 'Observé sur Livebox'}</small></button>)}</div>
      <ArrowDown className="tree-arrow" /><p className="footnote">{data?.link_verified ? 'WAN TP-Link vérifié dans le sous-réseau LAN Livebox' : 'Lien WAN / LAN non vérifié : connectez les routeurs pour le mesurer'}</p>
      <button className="topology-root" onClick={() => setSelected(data?.tplink)}><Router size={25} /><strong>Archer AX58</strong><small>WAN {text(data?.tplink?.wan)} → LAN {text(data?.tplink?.lan)}</small></button>
      <div className="topology-devices">{data?.devices.filter(d => d.router === 'tplink').map((d, i) => <button key={i} className="topology-device" onClick={() => setSelected(d)}><Network size={17} /><strong>{d.name}</strong><small>{d.ip} · {d.connection}</small></button>)}</div>
    </div>
    {selected != null && <Details data={selected} title="Détails de l’élément sélectionné" />}
    <p className="footnote">Un appareil observé par les deux routeurs reste indiqué avec ses deux sources. Aucune attribution au TP-Link n’est déduite de la seule liste Livebox.</p>
  </div>;
}

function RulesTable({ rules }: { rules: NATRule[] }) {
  return <div className="table-wrap"><table><thead><tr><th>Routeur / nom</th><th>Externe → interne</th><th>Destination</th><th>Protocole / état</th></tr></thead><tbody>{rules.map((r, i) => <tr key={i}><td><strong>{r.router === 'tplink' ? 'Archer AX58' : 'Livebox'}</strong><small>{r.description || r.id}</small></td><td>{r.externalPort} → {r.internalPort}</td><td>{r.destinationIPAddress}</td><td>{r.protocol} · {r.enabled === true ? 'Activée' : r.enabled === false ? 'Désactivée' : 'État non fourni'}</td></tr>)}</tbody></table></div>;
}

function NativeNATPanel({ rules, refresh }: { rules: NATRule[]; refresh: () => Promise<void> }) {
  const [selected, setSelected] = useState<NATRule>();
  const [form, setForm] = useState<Form>({ name: '', target: 'tplink', destination: '', external: 25565, internal: 25565, protocol: 'TCP' });
  const [prepared, setPrepared] = useState<{ token: string; action: string; old: NATRule | null; rule: NATRule | null; warning: string }>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function prepare(action: string, old?: NATRule) {
    setBusy(true); setMessage('');
    try { setPrepared(await api('/network/tplink/nat/prepare', { action, id: old?.id || null, rule: action === 'delete' ? null : form })); }
    catch (e) { setMessage((e as Error).message); }
    finally { setBusy(false); }
  }
  return <><RulesTable rules={rules} />{rules.filter(r => !r.description?.startsWith('LBO3_')).map(r => <div className="flex-heading spaced" key={r.id}><span>{r.description || r.id}</span><div className="button-row"><button className="secondary small" onClick={() => { setSelected(r); setForm({ name: r.description, target: 'tplink', destination: r.destinationIPAddress, external: Number(r.externalPort), internal: Number(r.internalPort), protocol: r.protocol }); }}>Modifier</button><button className="secondary small" disabled={busy} onClick={() => void prepare('delete', r)}>Supprimer…</button></div></div>)}
    <form className="inset-form" onSubmit={e => { e.preventDefault(); void prepare(selected ? 'update' : 'create', selected); }}><h3>{selected ? 'Modifier la règle TP-Link' : 'Créer une règle TP-Link seule'}</h3><div className="form-grid">
      <label>Nom<input required maxLength={24} pattern="[A-Za-z0-9 _.-]+" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label><label>IPv4 de destination sur le LAN TP-Link<input required value={form.destination} onChange={e => setForm({ ...form, destination: e.target.value })} /></label>
      <label>Port externe<input type="number" min={1} max={65535} required value={form.external} onChange={e => setForm({ ...form, external: Number(e.target.value) })} /></label><label>Port interne<input type="number" min={1} max={65535} required value={form.internal} onChange={e => setForm({ ...form, internal: Number(e.target.value) })} /></label><label>Protocole<select value={form.protocol} onChange={e => setForm({ ...form, protocol: e.target.value })}><option>TCP</option><option>UDP</option><option value="ALL">TCP + UDP</option></select></label>
    </div><div className="button-row">{selected && <button className="secondary" type="button" onClick={() => setSelected(undefined)}>Nouvelle règle</button>}<button className="primary" disabled={busy}>Préparer</button></div></form>
    {message && <p className="info-note" role="status">{message}</p>}
    {prepared && <section className="network-confirm"><h3>Confirmer : {prepared.action}</h3><p>{prepared.warning}</p>{prepared.old && <><h4>Avant</h4><RulesTable rules={[prepared.old]} /></>}{prepared.rule && <><h4>Après</h4><RulesTable rules={[prepared.rule]} /></>}<div className="button-row"><button className="secondary" onClick={() => setPrepared(undefined)}>Annuler</button><button className="primary" disabled={busy} onClick={async () => { setBusy(true); try { const result = await api<{ status: string; message?: string }>('/network/tplink/nat/confirm', { token: prepared.token }); setMessage(result.message || 'Résultat vérifié par relecture ; accessibilité publique non testée.'); setPrepared(undefined); await refresh(); } catch (e) { setMessage((e as Error).message); } finally { setBusy(false); } }}>Confirmer cette modification TP-Link</button></div></section>}
  </>;
}

export function AdvancedNATPanel() {
  const state = useNetwork<NATState>('/network/nat', false);
  const checks = useNetwork<RecordData>('/network/checks', false);
  const topology = useNetwork<Topology>('/network/topology');
  const [form, setForm] = useState<Form>({ name: '', target: 'tplink', destination: '', external: 25565, internal: 25565, protocol: 'TCP' });
  const [editing, setEditing] = useState<string>();
  const [prepared, setPrepared] = useState<Prepared>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState<Operation>();
  async function prepare(action: string, operation?: string) {
    setBusy(true); setError(''); setOutcome(undefined);
    try { setPrepared(await api<Prepared>('/network/nat/prepare', { action, operation: operation || null, rule: action === 'delete' ? null : form })); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const devices = topology.data?.devices.filter(d => d.router === form.target && d.active !== false) || [];
  return <div className="panel network-panel"><Heading title="Gestionnaire NAT avancé" subtitle="Une opération, deux redirections vérifiées pour les appareils derrière l’AX58." load={state.load} busy={state.busy} />
    <p className="info-note"><ShieldCheck size={19} />{state.data?.public_reachability || 'La présence des règles ne prouve pas l’accessibilité publique du service.'}</p>
    {(error || state.error) && <p className="network-error" role="alert">{error || state.error}</p>}
    <form className="inset-form" onSubmit={e => { e.preventDefault(); void prepare(editing ? 'update' : 'create', editing); }}><h3>{editing ? 'Modifier le chemin NAT géré' : 'Ouvrir un port'}</h3><div className="form-grid">
      <label>Nom du service<input required maxLength={24} pattern="[A-Za-z0-9 _.-]+" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
      <label>Routeur de l’appareil<select value={form.target} disabled={!!editing} onChange={e => setForm({ ...form, target: e.target.value, destination: '' })}><option value="tplink">Archer AX58 (double NAT)</option><option value="livebox">Livebox (NAT simple)</option></select></label>
      <label>Appareil observé<select required value={form.destination} onChange={e => setForm({ ...form, destination: e.target.value })}><option value="">Choisir un appareil</option>{devices.map((d, i) => <option key={i} value={d.ip}>{d.name} · {d.ip}</option>)}</select></label>
      <label>Protocole<select value={form.protocol} onChange={e => setForm({ ...form, protocol: e.target.value })}><option>TCP</option><option>UDP</option><option value="ALL">TCP + UDP</option></select></label>
      <label>Port externe<input required type="number" min={1} max={65535} value={form.external} onChange={e => setForm({ ...form, external: Number(e.target.value) })} /></label>
      <label>Port interne<input required type="number" min={1} max={65535} value={form.internal} onChange={e => setForm({ ...form, internal: Number(e.target.value) })} /></label>
    </div><div className="button-row">{editing && <button type="button" className="secondary" onClick={() => setEditing(undefined)}>Annuler la modification</button>}<button className="primary" disabled={busy}>Vérifier et préparer</button></div></form>
    {prepared && <section className="network-confirm"><h3>Confirmer {prepared.plan.action === 'delete' ? 'la suppression' : prepared.plan.action === 'update' ? 'la modification' : 'la création'} sur les routeurs</h3><p>{prepared.warning}</p>
      {prepared.plan.old_rules.length > 0 && <><h4>Règles actuelles</h4><RulesTable rules={prepared.plan.old_rules} /></>}
      {prepared.plan.rules.length > 0 && <><h4>Règles après confirmation</h4><RulesTable rules={prepared.plan.rules} /></>}
      <div className="button-row"><button className="secondary" onClick={() => setPrepared(undefined)}>Annuler</button><button className="primary" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { const result = await api<Operation>('/network/nat/confirm', { token: prepared.token }); setOutcome(result); setPrepared(undefined); setEditing(undefined); await state.load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}><Check size={16} />Confirmer ces modifications</button></div>
    </section>}
    {outcome && <div className="diagnostic-result" role="status"><h3>Résultat : {outcome.status}</h3><p>{outcome.error || 'Les règles ont été relues sur les routeurs.'}</p><p>Accessibilité publique : non testée.</p></div>}
    <h3 className="section-title">Opérations coordonnées</h3>
    {state.data?.operations.map(op => <section className="diagnostic-result" key={op.id}><div className="flex-heading"><h3>{op.name}</h3><span>{op.status} · {new Date(op.updated * 1000).toLocaleString('fr-FR')}</span></div><p>Dernière relecture : {op.observed_status === 'present' ? 'règles présentes et conformes' : op.observed_status === 'not_readable' ? 'routeur non lisible' : op.observed_status === 'absent' ? 'aucune règle de cette opération présente' : 'règle modifiée hors du plan'}</p><RulesTable rules={op.rules} />{op.error && <p>{op.error}</p>}
      {['verified', 'partial', 'unknown', 'applying'].includes(op.status) && <div className="button-row"><button disabled={op.status !== 'verified'} className="secondary small" onClick={() => { const last = op.rules.find(r => r.router === 'tplink') || op.rules[0]; const first = op.rules.find(r => r.router === 'livebox') || last; setForm({ name: op.name, target: last.router, destination: last.destinationIPAddress, external: Number(first.externalPort), internal: Number(last.internalPort), protocol: last.protocol }); setEditing(op.id); }}>Modifier</button><button className="secondary small" disabled={busy} onClick={() => void prepare('delete', op.id)}>Préparer la suppression coordonnée</button></div>}
    </section>)}
    <h3 className="section-title">Toutes les règles réellement lues</h3>{Object.entries(state.data?.rules || {}).map(([name, result]) => <section key={name}><h4>{name === 'tplink' ? 'Archer AX58' : 'Livebox'}</h4>{result.available ? <RulesTable rules={result.data as NATRule[]} /> : <p className="info-note">{result.message}</p>}</section>)}
    <p className="footnote">Les règles déjà présentes restent conservées. Seules les opérations créées ici sont liées pour une modification coordonnée. Après un échec partiel ou une réponse incertaine, vérifiez les deux tables avant d’intervenir.</p>
    <Details data={checks.data || checks.error} title="Pare-feu et limitations de connectivité constatées" />
  </div>;
}

export function MonitorPanel() {
  const router = useNetwork<TPState>('/network/tplink');
  const incidents = useNetwork<LogEntry[]>('/incidents');
  const topology = useNetwork<Topology>('/network/topology');
  const status = rec(router.data?.reads?.status?.data);
  const samples = router.data?.history || [];
  const cpu = samples.map(s => ({ ...s, value: Number(rec(s.data).cpu_usage) })).filter(s => Number.isFinite(s.value));
  return <div className="panel network-panel"><Heading title="Surveillance réseau" subtitle="Mesures du backend, observations des appareils et historique des incidents." load={() => { void router.load(); void incidents.load(); void topology.load(); }} busy={router.busy} />
    <div className="wifi-bands"><div className="band-card"><h3><Activity size={18} />Archer AX58</h3><p>{router.data?.connected ? 'Session active' : 'Connexion nécessaire'}</p><div className="band-info"><span>CPU déclaré<strong>{text(status.cpu_usage)}</strong></span><span>Mémoire déclarée<strong>{text(status.mem_usage)}</strong></span><span>Uptime WAN<strong>{text(status.wan_ipv4_uptime)}</strong></span></div></div><div className="band-card"><h3><Network size={18} />Appareils observés</h3><p>{topology.data?.devices.length ?? '—'} observation(s) avec leur source</p><p className="footnote">Archer : toutes les 30 s. Les débits Livebox sont disponibles dans Statistiques.</p></div></div>
    {cpu.length > 1 && <div className="network-chart"><h3>Historique CPU AX58 (valeurs déclarées)</h3><svg viewBox="0 0 600 130" role="img" aria-label="Historique CPU TP-Link"><polyline fill="none" stroke="#ff7900" strokeWidth="2" points={cpu.map((s, i) => `${i * 600 / (cpu.length - 1)},${120 - Math.max(0, Math.min(1, s.value > 1 ? s.value / 100 : s.value)) * 110}`).join(' ')} /></svg></div>}
    {(router.error || incidents.error) && <p role="alert">{router.error || incidents.error}</p>}
    <h3 className="section-title">Alertes et audit persistants</h3><div className="event-list">{incidents.data?.map((event, i) => <div key={i}><time>{new Date(event.time * 1000).toLocaleString('fr-FR')}</time><span>{event.message}<small>{event.source}</small></span></div>)}</div>
    <Details data={rows(router.data?.reads?.leases?.data)} title="Baux DHCP réellement déclarés" />
  </div>;
}
