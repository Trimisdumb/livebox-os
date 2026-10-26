# API Livebox OS

La branche `develop/v4` annonce `4.0.1` dans `/api/health`. Cette version de développement conserve les routes V3 et ajoute le registre décrit dans [CONNECTORS.md](CONNECTORS.md).

`GET/PUT /api/preferences` conserve `theme`, `wallpaper`, `fit` et `blur`. Le champ facultatif `desktop` contient `icon_size` (small/medium/large), `icon_order` (identifiants uniques), `dock_pinned` (liste ou null pour toutes), `remember_windows`, `wallpaper_x/y` (0 à 100), `animations` et `accent` (orange/amber). Un ancien client qui omet `desktop` préserve sa valeur existante. Les positions et dimensions des fenêtres restent dans le navigateur, sans contenu de fenêtre ni identifiant réseau.

Les sauvegardes applicatives contenant ces options portent le schéma `4.0` ; il ne désigne pas une release stable. L’import accepte aussi les schémas Orange OS 1.1 et Livebox OS 3.0, avec confirmation existante. Le fichier image reste inchangé lors d’une mise à jour des préférences.

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


## V4.0.1 : profil utilisateur et configuration SSH

Les routes suivantes conservent le cookie administrateur et la protection CSRF existants. Aucun identifiant de compte arbitraire n’est accepté pour lire une photo.

| Route | Usage |
|---|---|
| GET/PUT `/api/user/profile` | Nom affiché du compte connecté ; PUT accepte seulement `display_name` (1 à 80 caractères) |
| GET/PUT/DELETE `/api/user/avatar` | Photo du compte ; PUT reçoit des octets JPG/PNG/WebP, 5 Mo et 20 mégapixels maximum ; validation et réencodage WebP 256 × 256 sans métadonnées |
| GET `/api/control/ssh/config` | Mode intégré/externe et clés publiques disponibles ; jamais une clé privée |
| POST `/api/control/ssh/keys` | Génération Ed25519 dédiée : `{name}` ; noms réservés et remplacements refusés |
| GET `/api/control/resources/{id}/host-key` | Lecture non approuvée de la clé publique d’hôte Ed25519 |
| POST `/api/control/ssh/fingerprint` | Vérification syntaxique et calcul de l’empreinte d’une clé publique saisie manuellement ; aucune confiance enregistrée |
| PUT `/api/control/resources/{id}/host-key` | `{public_key,fingerprint,verified:true}` ; empreinte identique obligatoire et acceptation explicite après comparaison depuis une console fiable |

Les clés privées intégrées restent dans `data/ssh`, hors des exports applicatifs. Le dossier externe LIVEBOX_OS_SSH_DIR n’est jamais modifié par ces routes. Un test SSH qui échoue retourne une erreur explicative et ne crée pas de session connectée. La lecture `system` fournit désormais des mesures structurées ; les anciennes routes et permissions restent inchangées.

Les noms et avatars vivent dans `data/users/<identifiant dérivé du compte>` et persistent avec le volume privé. Les sauvegardes complètes du volume les incluent ; l’export des préférences applicatives ne les inclut pas.
