# Références étudiées avant développement

## Capture Freebox OS 4.4 fournie

La référence utilise un bureau blanc, une grande identité en haut, des traits diagonaux rouges/noirs et un relief translucide. Les icônes carrées colorées, centrées, sont accompagnées d’un libellé sous l’icône et réparties sur deux rangées. L’image contient dix applications : état, téléchargements, explorateur, paramètres, profils, périphériques, appels, enregistrements, programmes et contacts. La barre des tâches translucide occupe toute la largeur du bas : lanceur à gauche, réseau et horloge à droite. Une sélection grisée apparaît sous « Périphériques réseau ».

La capture ne montre aucune fenêtre ouverte ni menu contextuel : leur comportement ne peut pas en être déduit précisément. Livebox OS ajoute des fenêtres à barre de titre fine, contrôles réduire/agrandir/fermer, déplacement par pointeur, redimensionnement natif et menu contextuel. Le bureau reprend les icônes colorées, les libellés, la barre inférieure et le fond clair à diagonale ; son illustration, ses dégradés orange, sa grille de neuf applications et son panneau d’accueil sont originaux, réalisés en CSS/SVG. Aucun logo Free ni élément graphique de la capture n’est redistribué.

## LiveboxMonitor

Source consultée : https://github.com/p-dor/LiveboxMonitor

Révision analysée : `d3a5d546b44b7a35bf63c6d1c89c539908ff9f80`.

L’étude a porté sur `api/LmSession.py`, `LmApi.py`, `LmLiveboxInfoApi.py`, `LmDeviceApi.py`, `LmWifiApi.py`, `LmDhcpApi.py`, `LmFirewallApi.py`, `LmStatsApi.py`, `LmIntfApi.py`, `LmVoipApi.py` et les traitements associés dans les onglets DHCP, NAT/PAT et informations. Le code Livebox OS est une implémentation indépendante du protocole observé ; les dépendances PyQt et la persistance pickle de LiveboxMonitor ne sont pas intégrées.

### Authentification

`POST /ws` avec `Authorization: X-Sah-Login`, type `application/x-sah-ws-4-call+json`, service `sah.Device.Information`, méthode `createContext` et paramètres `applicationName: so_sdkut`, `username`, `password`. L’identifiant est dans `data.contextID`, accompagné de cookies HTTP. Les appels suivants utilisent `Authorization: X-Sah <contexte>`, `X-Context` et un service préfixé `sysbus.`. `Time.getTime` valide la session ; `releaseContext` est essayé à la fermeture. Comme le note la source, la libération peut être refusée par le firmware ; le client local est toujours fermé.

Les réponses peuvent être enveloppées dans `result`. `status` peut contenir directement des données, ou être booléen avec les données dans `data` : le choix est explicite par service. Les erreurs, réponses invalides et services refusés sont propagés sans inventer de résultat.

### Appels implémentés

| Usage | Service et méthode |
|---|---|
| Modèle, uptime, firmware | `DeviceInfo.get` → `status` |
| WAN | `NMC.getWANStatus` → `data` |
| Appareils | `Devices.get`, expression `physical and !self and !voice` |
| État Wi-Fi | `NMC.Wifi.get` |
| Marche/arrêt Wi-Fi | `PowerManagement.setProfiles`, puis `NMC.Wifi.set` |
| Nom et clé du réseau principal | `NeMo.Intf.lan.getMIBs` (`wlanvap`), `NMC.Wifi.set` (`ConfigurationMode`), `NeMo.Intf.lan.setWLANConfig` |
| IPv4 et DHCP | `NMC.getLANIP`, `DHCPv4.Server.getDHCPServerPool` |
| Modification IPv4 et DHCP | `NetMaster.LAN.default.Bridge.lan.setIPv4` |
| NAT/PAT | `Firewall.getPortForwarding`, `setPortForwarding`, `deletePortForwarding`, `commit` |
| Découverte WAN | `HomeLan.Interface.get`, noms `WAN_GPON`, `WAN_XGSPON`, `WAN_Ethernet` |
| Compteurs | `NeMo.Intf.<interface WAN découverte>.getNetDevStats`, `RxBytes` / `TxBytes` |
| Appels | `VoiceService.VoiceApplication.getCallList`, paramètres `[ { "line": "1" } ]` |
| Journal DHCP | `DHCPv4.Server.Stats.getDoraCyclesDetails` |

La correspondance `Livebox Fibre` → `Livebox 5` vient de `LmLiveboxInfoApi`. La source signale que certains compteurs rebouclent à 4 Go ; Livebox OS interrompt donc la mesure quand ils baissent. Aucun appel `HomeLan.getWANCounters` n’est effectué, car la source signale ses effets indésirables sur les statistiques.

Les événements du journal Livebox OS sont des transitions de présence et d’état WAN observées par échantillonnage. Le protocole d’abonnement SAH aux événements n’est pas utilisé ; un événement survenant entièrement entre deux mesures peut être manqué. Le journal DHCP reste une lecture directe. Les signatures sont issues d’une API non officiellement documentée et peuvent varier avec les firmwares : l’interface signale alors l’indisponibilité.

### Validation initiale V1

Compilation TypeScript et production React exécutées sous Windows. Tests backend sur transport HTTP isolé. Vérifications dans le navigateur : rendu bureau, fenêtres, thèmes, fonds d’écran et persistance. Une connexion initiée par l’utilisateur a également fourni les données réelles d’une Livebox 5 (modèle, version logicielle, uptime et WAN) pendant le développement ; ce firmware utilise `Bound` pour l’état de connexion. Les changements réseau ne sont pas exécutés automatiquement sur le matériel de l’utilisateur. Docker et Debian nécessitent une vérification d’exécution sur la machine cible.

La mise à jour 1.1 ajoute l’authentification applicative, les diagnostics, le stockage USB, les radios Wi-Fi et la sauvegarde. Les signatures USB proviennent de `docs/API Documentation/Livebox 5/StorageService.txt` et `USBHosts.txt` de la même révision LiveboxMonitor. Le retrait du partage SMBv1 est documenté par [Orange](https://assistance.orange.fr/nid/435465). La validation réalisée sur Debian pour cette mise à jour est décrite dans `VALIDATION.md`.
