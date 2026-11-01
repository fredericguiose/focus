# Focus

Un système de focus personnel : **une API calcule, les appareils appliquent.**

L'API décide, minute par minute, de ce qui est bloqué (sites, apps, session du PC) selon des
règles écrites en YAML : horaires de nuit, planning du jour fait ou non, tâches prioritaires
du jour (Todoist), exceptions déclarées. Chaque appareil reçoit un planning, le garde en cache
et l'applique, même hors ligne.

> **État : en développement.** Rien n'est encore utilisable.

## Pièces

| Dossier | Rôle | Techno |
|---|---|---|
| `core/` | Moteur de règles : calcule la journée et le mode actif. Pur, sans dépendance à l'hébergeur, testé. | TypeScript |
| `api/` | Couche HTTP mince autour du moteur, base de données, tâches planifiées. | Cloudflare Workers, D1 |
| `clients/pc/` | Client Linux et Windows : fichier hosts, verrouillage de la session la nuit, comptes. | Go |
| `clients/iphone/` | Client iPhone : raccourcis (interruption à l'ouverture d'une app). | Raccourcis |
| `extension/` | Extension de navigateur : affiche pourquoi un site est bloqué. Ne bloque rien. | — |
| `web/` | Interface commune à tous les appareils : statut, exceptions, sessions. | React, Vite |
| `config/` | `exemple.yaml` : une configuration d'exemple, aux horaires fictifs. | YAML |

## Lancer en local

Node ≥ 22, depuis la racine :

```sh
npm run local                  # dépendances, web app, base locale, jetons, config, API sur :8799
npm run local:heure -- 18:00   # régler l'horloge locale (ou +3h, reel)
npm run local:reset            # repartir de zéro
```

La web app s'ouvre sans jeton (utilisateur de la config chargée). Détails et
essai du client PC : [docs/essai-local.md](docs/essai-local.md). Mise en ligne (deux hôtes,
Cloudflare Access) : [docs/mise-en-ligne.md](docs/mise-en-ligne.md).

## Principes

- **Les clients ne décident rien.** Ils appliquent un planning dont chaque verrou porte son
  heure de fin : il se lève seul, même si l'API est injoignable.
- **Les frictions sont imposées par l'API**, quel que soit le client.
- **La configuration personnelle n'est pas dans ce dépôt.** Elle vit dans un dépôt privé et
  arrive dans la base à chaque modification, après vérification par un schéma.
- **Aucun secret dans le code.** Les jetons sont stockés chez Cloudflare.

## Licence

[MIT](LICENSE)

### Identifiant iPhone d'une app

`node scripts/app-store.mjs "Nom de l'app"` cherche dans l'App Store (identifiant + éditeur) ;
`node scripts/app-store.mjs --verifier <config.yaml>` vérifie chaque `iphone:` d'une config.
