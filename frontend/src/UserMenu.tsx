import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { api } from './api';

type Profile = { username: string; display_name: string; avatar_revision: string | null };

export default function UserMenu({ active, profiles, logout }: { active: boolean; profiles: () => void; logout: () => void }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [menu, setMenu] = useState(false), [editor, setEditor] = useState(false);
  const [name, setName] = useState(''), [source, setSource] = useState('');
  const [crop, setCrop] = useState({ x: 50, y: 50, zoom: 1 });
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const [loadingImage, setLoadingImage] = useState(false);
  const avatar = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null), dialog = useRef<HTMLElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const selection = useRef(0);
  useEffect(() => setAvatarFailed(false), [profile?.avatar_revision]);
  useEffect(() => { if (!active || !editor) { selection.current++; setSource(''); setLoadingImage(false); } }, [active, editor]);
  useEffect(() => {
    if (editor) dialog.current?.querySelector<HTMLElement>('input')?.focus();
    else if (menu) popup.current?.querySelector<HTMLElement>('button')?.focus();
  }, [editor, menu]);
  useEffect(() => {
    if (!active) { setProfile(null); setMenu(false); setEditor(false); return; }
    const controller = new AbortController();
    api<Profile>('/user/profile', undefined, undefined, controller.signal).then(setProfile).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [active]);
  useEffect(() => () => { if (source) URL.revokeObjectURL(source); }, [source]);
  useEffect(() => {
    if (!menu && !editor) return;
    const outside = (event: PointerEvent) => { if (!editor && !avatar.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) setMenu(false); };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) { setMenu(false); setEditor(false); setSource(''); avatar.current?.focus({ preventScroll: true }); }
      if (menu && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        const fields = [...(popup.current?.querySelectorAll<HTMLElement>('[role=menuitem]') || [])];
        const current = fields.indexOf(document.activeElement as HTMLElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? fields.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + fields.length) % fields.length;
        event.preventDefault(); fields[next]?.focus();
      }
      if (event.key === 'Tab' && editor) {
        const fields = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])') || [])];
        const first = fields[0], last = fields.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', keyboard); };
  }, [menu, editor, busy]);
  async function save() {
    if (loadingImage) return;
    setBusy(true); setError(''); setMessage('');
    try {
      let result = await api<Profile>('/user/profile', { display_name: name }, 'PUT');
      setProfile(result);
      if (source && image.current) {
        const img = image.current;
        if (!img.complete || !img.naturalWidth) throw new Error('Attendez le chargement de la photo.');
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
        const context = canvas.getContext('2d'); if (!context) throw new Error('Recadrage non disponible sur ce navigateur.');
        const scale = Math.max(256 / img.naturalWidth, 256 / img.naturalHeight) * crop.zoom;
        const size = 256 / scale;
        context.drawImage(img, (img.naturalWidth - size) * crop.x / 100, (img.naturalHeight - size) * crop.y / 100, size, size, 0, 0, 256, 256);
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', .9));
        if (!blob) throw new Error('Impossible de préparer cette photo.');
        result = await api<Profile>('/user/avatar', blob, 'PUT');
      }
      setProfile(result); setSource(''); setMessage('Profil enregistré pour votre compte.');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const url = profile?.avatar_revision ? `/api/user/avatar?v=${profile.avatar_revision}` : '';
  const initial = Array.from(profile?.display_name || profile?.username || 'M')[0].toLocaleUpperCase();
  const root = document.querySelector('main.os');
  return <>
    <button ref={avatar} className="avatar" title={profile?.display_name || 'Menu utilisateur'} aria-label="Menu utilisateur" aria-haspopup="menu" aria-expanded={menu} onClick={() => { if (active) setMenu(!menu); }}>
      {url && !avatarFailed ? <img src={url} alt="" onError={() => setAvatarFailed(true)} /> : initial}
    </button>
    {root && menu && createPortal(<div ref={popup} className="user-menu" role="menu" aria-label="Compte utilisateur"><strong>{profile?.display_name || 'Mon compte'}</strong><button role="menuitem" onClick={() => { setName(profile?.display_name || ''); setMenu(false); setEditor(true); setMessage(''); setError(''); setSource(''); }}>Modifier mon profil</button><button role="menuitem" onClick={() => { setMenu(false); profiles(); }}>Profils Livebox</button><button role="menuitem" onClick={() => { setMenu(false); logout(); }}>Se déconnecter</button>{error && <p role="alert">{error}</p>}</div>, root)}
    {root && editor && createPortal(<div className="modal-backdrop"><section ref={dialog} className="login-modal profile-dialog" role="dialog" aria-modal="true" aria-labelledby="user-profile-title">
      <button className="modal-close" aria-label="Fermer mon profil" disabled={busy} onClick={() => { setEditor(false); setSource(''); avatar.current?.focus({ preventScroll: true }); }}><X size={18} /></button>
      <h2 id="user-profile-title">Mon profil</h2><p>Le nom affiché et la photo sont propres à votre compte. Votre identifiant de connexion reste inchangé.</p>
      <form onSubmit={e => { e.preventDefault(); void save(); }}>
        <label>Nom affiché<input required maxLength={80} value={name} onChange={e => setName(e.target.value)} /></label>
        {source ? <div className="avatar-crop" style={{ '--crop-x': `${crop.x}%`, '--crop-y': `${crop.y}%`, '--crop-zoom': crop.zoom } as CSSProperties}><img ref={image} src={source} alt="Prévisualisation de la photo recadrée" /></div> : <div className="avatar-preview">{url ? <img src={url} alt="Photo actuelle" /> : initial}</div>}
        <label>Importer ou remplacer la photo<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={async e => {
          const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
          const currentSelection = ++selection.current;
          setLoadingImage(false);
          setError(''); setMessage('');
          if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) { setError('Choisissez une image JPG, PNG ou WebP de 5 Mo maximum.'); return; }
          setLoadingImage(true);
          const url = URL.createObjectURL(file), test = new Image(); test.src = url;
          try { await test.decode(); if (currentSelection !== selection.current) { URL.revokeObjectURL(url); return; } if (test.naturalWidth * test.naturalHeight > 20_000_000) throw new Error(); setCrop({ x: 50, y: 50, zoom: 1 }); setSource(url); }
          catch { URL.revokeObjectURL(url); if (currentSelection === selection.current) setError('Image invalide ou supérieure à 20 mégapixels.'); }
          finally { if (currentSelection === selection.current) setLoadingImage(false); }
        }} /></label>
        {loadingImage && <p role="status">Lecture de l’image…</p>}
        {source && <div className="avatar-controls"><label>Zoom<input type="range" min="1" max="3" step=".1" value={crop.zoom} onChange={e => setCrop({ ...crop, zoom: Number(e.target.value) })} /></label><label>Position horizontale<input type="range" min="0" max="100" value={crop.x} onChange={e => setCrop({ ...crop, x: Number(e.target.value) })} /></label><label>Position verticale<input type="range" min="0" max="100" value={crop.y} onChange={e => setCrop({ ...crop, y: Number(e.target.value) })} /></label></div>}
        <div className="profile-actions"><button className="primary" disabled={busy || loadingImage}>{busy ? 'Enregistrement…' : 'Enregistrer mon profil'}</button>{(url || source) && <button type="button" className="secondary" disabled={busy || loadingImage} onClick={async () => {
          setBusy(true); setError(''); try { const result = await api<Profile>('/user/avatar', undefined, 'DELETE'); setProfile(result); setSource(''); setMessage('Photo supprimée. Votre initiale est utilisée.'); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
        }}>Supprimer la photo</button>}</div>
      </form>{error && <p className="error-message" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    </section></div>, root)}
  </>;
}
