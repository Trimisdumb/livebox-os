import { useEffect, useState } from 'react';
import { Router } from 'lucide-react';
import type { RecordData } from './api';
import { liveboxPhoto } from './hardware';

export default function LiveboxPhoto({ info }: { info: RecordData }) {
  const photo = liveboxPhoto(info), [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [photo?.path]);
  return <>{photo && !failed ? <><img className="livebox-photo" src={photo.path} alt={`Photo authentique de la Livebox ${photo.model}`} onError={() => setFailed(true)} /><a className="hardware-credit" href="/hardware/credits.html" target="_blank" rel="noreferrer" title={photo.credit}>Crédits photo</a></> : <div className="livebox-neutral" aria-label="Visuel neutre : aucune photo vérifiée pour ce modèle"><Router size={76} strokeWidth={1.2} /></div>}</>;
}
