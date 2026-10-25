# API Livebox OS 3.0

Le schéma complet est servi par `GET /api/openapi.json`, après connexion administrateur. Les routes existantes de la Livebox, des profils, préférences, sauvegardes, USB et diagnostics sont conservées.

Toutes les nouvelles routes exigent le cookie administrateur HttpOnly `orange_admin`. Les mutations exigent une origine identique et `X-CSRF-Token`, obtenu par `/api/auth/state` après connexion. Aucun appel direct aux routeurs depuis le frontend. Les réponses sont `Cache-Control: no-store`. Les secrets de routeurs et SMB ne sont pas persistés dans les sauvegardes.

| Route | Usage |
|---|---|
| POST `/api/network/tplink/login` | `{url,password,force:false,reconnect:false}` ; `force:true` confirme explicitement le remplacement d’une autre session TP-Link |
| POST `/api/network/tplink/logout` | Ferme la session locale et efface les secrets de reconnexion |
| GET `/api/network/tplink` | Identité, compatibilité, résultats de lecture, historique et date de mesure |
| GET `/api/network/topology` | LAN/WAN observés, masques, appareils avec leur source, lien de sous-réseau vérifié |
| GET `/api/network/checks` | WAN Livebox, niveau de pare-feu si lisible, limites opérateur et contrôles non disponibles |
| GET `/api/network/nat` | Règles normalisées des deux routeurs, opérations coordonnées et état réellement relu |
| POST `/api/network/nat/prepare` | Plan coordonné sans écriture : `{action:"create",rule:{name,target:"tplink",destination,external,internal,protocol:"TCP"}}` |
| POST `/api/network/nat/confirm` | `{token}` reçu à la préparation, valable 120 s et une seule fois |
| POST `/api/network/tplink/nat/prepare` | NAT TP-Link seul : même règle, action create/update/delete et `id` pour update/delete |
| POST `/api/network/tplink/nat/confirm` | Confirmation à usage unique du plan natif TP-Link |
| POST `/api/shares/login` | `{host,share,username,password,encryption:true}` ; IPv4 privée, port 445 fixe, session isolée |
| GET `/api/shares` | État du partage et dialecte réellement négocié |
| GET `/api/shares/browse?path=` | Chemin relatif dans le partage ; maximum 2 000 entrées, indicateur de troncature |
| GET `/api/shares/download?path=...` | Fichier en pièce jointe, maximum 32 Mio |
| POST `/api/shares/logout` | Déconnecte le partage et libère sa session |

Pour un plan coordonné, `target:"livebox"` produit un NAT simple ; `target:"tplink"` produit deux règles. Mise à jour : `action:"update"`, `operation` contenant l’identifiant de l’opération et nouvelle `rule`. Suppression : `action:"delete"`, `operation`, sans règle. Les règles étrangères ne sont jamais associées automatiquement à une opération coordonnée.

Avant confirmation, le backend relit les règles et compare leur empreinte, la session et la topologie. Les écritures sont sérialisées dans le processus. Un autre outil d’administration peut néanmoins intervenir directement sur le routeur : les deux API ne permettent pas de transaction distribuée atomique. Chaque résultat est relu. Les états persistants sont `applying`, `verified`, `deleted`, `partial`, `rolled_back`, `unknown`. Après une interruption du serveur, une opération restée `applying` exige une relecture et une intervention confirmée. Une règle modifiée hors de l’application bloque la suppression automatique.

Un échec de création déclenche uniquement le retrait des nouvelles règles dont le marqueur et les champs correspondent exactement au plan. En cas de lecture impossible, l’état reste incertain ; aucune règle étrangère n’est retirée. Une modification partielle de règles existantes n’est jamais annulée silencieusement.

La reconnexion TP-Link est optionnelle, limitée à la lecture et à une tentative par minute, pendant 8 h maximum. Un échec supprime le mot de passe de reconnexion. Aucune écriture n’est rejouée automatiquement. La déconnexion administrateur ferme également TP-Link et SMB. Les partages sont en lecture seule, sans DFS ni liens et sans accès au disque local du serveur.
