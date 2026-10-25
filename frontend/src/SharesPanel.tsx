import { useEffect, useState } from 'react';
import { Download, FolderOpen, RefreshCw } from 'lucide-react';
import { api } from './api';

type ShareState = { connected: boolean; host?: string; share?: string; dialect?: string };
type Entry = { name: string; directory: boolean; link: boolean; size: number };

export default function SharesPanel() {
  const [session, setSession] = useState<ShareState>({ connected: false });
  const [host, setHost] = useState('');
  const [share, setShare] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [encryption, setEncryption] = useState(true);
  const [path, setPath] = useState('');
  const [items, setItems] = useState<Entry[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { api<ShareState>('/shares').then(setSession).catch(e => setError(e.message)); }, []);
  async function browse(next: string) {
    setBusy(true); setError('');
    try { const result = await api<{items: Entry[]; truncated: boolean}>(`/shares/browse?path=${encodeURIComponent(next)}`); setPath(next); setItems(result.items); setTruncated(result.truncated); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  useEffect(() => { if (session.connected) void browse(''); }, [session.connected]);
  return <div className="panel network-panel"><div className="panel-heading"><div><h2>Partages réseau</h2><p>SMB2/3 en lecture seule · serveur privé et partage explicitement choisis.</p></div><FolderOpen size={24} /></div>
    {error && <p className="network-error" role="alert">{error}</p>}
    {!session.connected ? <form className="inset-form" onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); try { await api('/shares/login', { host, share, username, password, encryption }); setPassword(''); setSession(await api<ShareState>('/shares')); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}><div className="form-grid">
      <label>Adresse IPv4 privée du serveur<input required value={host} placeholder="192.168.0.20" onChange={e => setHost(e.target.value)} /></label>
      <label>Nom du partage<input required value={share} placeholder="Documents" onChange={e => setShare(e.target.value)} /></label>
      <label>Compte du partage<input required value={username} autoComplete="username" onChange={e => setUsername(e.target.value)} /></label>
      <label>Mot de passe<input type="password" required value={password} autoComplete="current-password" onChange={e => setPassword(e.target.value)} /></label>
    </div><label className="check-line"><input type="checkbox" checked={encryption} onChange={e => setEncryption(e.target.checked)} />Exiger le chiffrement SMB3 (désactiver seulement pour un partage SMB2 signé sur votre LAN)</label><button className="primary" disabled={busy}>{busy ? 'Vérification…' : 'Connecter ce partage'}</button><p className="footnote">Identifiants conservés uniquement dans la session backend, une heure maximum. Aucun partage n’est créé ni activé sur les routeurs. SMBv1, DFS et liens sont refusés.</p></form> : <>
      <div className="setting-card"><div><h3>{session.host} / {session.share}</h3><p>Dialecte négocié : {session.dialect} · lecture seule</p></div><button className="secondary small" onClick={async () => { await api('/shares/logout', {}); setSession({ connected: false }); setItems([]); }}>Déconnecter</button></div>
      <div className="flex-heading spaced"><strong>/{path}</strong><div className="button-row"><button className="secondary small" disabled={busy || !path} onClick={() => void browse(path.split('/').slice(0, -1).join('/'))}>Dossier parent</button><button aria-label="Actualiser le partage" className="icon-button" disabled={busy} onClick={() => void browse(path)}><RefreshCw size={16} /></button></div></div>
      <div className="table-wrap"><table><thead><tr><th>Nom</th><th>Taille</th><th>Action</th></tr></thead><tbody>{items.map(item => { const next = [path, item.name].filter(Boolean).join('/'); return <tr key={item.name}><td>{item.directory ? <FolderOpen size={15} /> : null} {item.name}</td><td>{item.directory ? 'Dossier' : `${item.size.toLocaleString('fr-FR')} octets`}</td><td>{item.link ? 'Lien non suivi' : item.directory ? <button className="secondary small" disabled={busy} onClick={() => void browse(next)}>Ouvrir</button> : item.size <= 32 * 1024 * 1024 ? <a className="source-link" download href={`/api/shares/download?path=${encodeURIComponent(next)}`}><Download size={14} />Télécharger</a> : 'Plus de 32 Mio'}</td></tr>; })}</tbody></table></div>
      {!items.length && !busy && !error && <p className="footnote">Ce dossier est vide.</p>}{truncated && <p className="info-note">Affichage limité aux 2 000 premières entrées retournées.</p>}
    </>}
  </div>;
}
