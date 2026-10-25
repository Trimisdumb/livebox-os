# Protocole étudié sur l’Archer AX58 — modèle testé

Étude du 25 octobre 2026, sur un réseau de test autorisé. La page publique de `192.168.0.1` charge `index-C1bolLLl.js` et `update-store-CbLw-wXW.js`. Sa métadonnée `AX53v1_1.11.0_2025-08-12...` désigne une interface partagée et n’est pas une preuve du modèle matériel. L’identité est donc relue après authentification avec `admin/firmware?form=upgrade` ; les écritures exigent AX58, V1, 1.5.2, 20250812 et rel.38324.

Les endpoints publics `device_config?form=config` et `login?form=keys` ont répondu. Certifications observées : EU CE, EU CE RED, SG CLS L1 STAGE2. Clé de mot de passe RSA 2048 bits. Aucun mot de passe ni jeton de session n’a été extrait de l’interface officielle.

Le JavaScript servi par cet équipement indique :

- Échange public `login?form=auth` pour la séquence et la clé de signature ; `login?form=keys` pour la clé de mot de passe.
- Mot de passe chiffré RSA PKCS#1 v1.5 ; empreinte SHA256 de `admin` suivi du mot de passe.
- Paramètres encodés comme un formulaire, puis AES-128-CBC avec PKCS7 et encodage base64. Clé et IV : 16 caractères ASCII chacun, générés avec `secrets` dans notre connecteur.
- Connexion : signature des blocs de 53 caractères par RSA-OAEP SHA1. Message `k=...&i=...&h=...&s=...` ; séquence augmentée de la longueur du texte chiffré base64, sans incrément persistant inventé.
- Requêtes suivantes : empreinte SHA256 du texte chiffré, puis HMAC-SHA256 des blocs de 53 caractères avec la clé formatée `k=...&i=...`.
- Réponses chiffrées déchiffrées dans le backend. Cookies, hash et `stok` ne sortent pas du connecteur. Les logs HTTP bruts sont désactivés afin de ne pas enregistrer le jeton présent dans l’URL.

Les routes de lecture WAN/LAN, état, firmware, Wi-Fi et clients proviennent de ces fichiers. Les bundles NAT `index-mCpHCL9x.js`, `model-UGj6cw9N.js`, `nat-E5mOp8Jv.js` et `index-D_a99vwI.js` indiquent `admin/nat?form=vs` : `load`, `insert` avec `new` JSON et `index`, `update` avec `key`, `new`, `old`, `remove` avec `key` et `index`. Champs : `name`, `external_port`, `internal_port`, `ipaddr`, `protocol` (TCP/UDP/ALL), `enable` (on/off). Les entrées enveloppées dans `{key,value}` sont prises en charge.

La bibliothèque [TP-Link-Archer-C6U](https://github.com/AlexandrErohin/TP-Link-Archer-C6U) a également été consultée : ses variantes de protocole ne suffisent pas à établir la compatibilité de ce firmware. Aucun code GPL n’a été incorporé. Le connecteur asynchrone est indépendant. Pour la Livebox, l’analyse initiale de [LiveboxMonitor](https://github.com/p-dor/LiveboxMonitor) reste dans `PROTOCOL-LIVEBOX.md`.

Les études de protocole et les tests isolés sont distingués des vérifications matérielles. Les résultats effectifs sont séparés dans `VALIDATION.md`. Les écritures Wi-Fi TP-Link restent désactivées : leur signature n’a pas été validée. Aucun endpoint de reboot, reset, DMZ, UPnP ou modification de topologie n’est appelé.
