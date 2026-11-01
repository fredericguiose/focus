# Extension Focus (Chrome, Manifest V3)

Interface seulement : **elle ne bloque rien**. Le blocage est fait par le client PC (fichier
hosts). Quand un onglet échoue (`ERR_CONNECTION_REFUSED`, `ERR_NAME_NOT_RESOLVED`,
`ERR_ADDRESS_INVALID`, `ERR_CONNECTION_RESET`), l'extension demande à l'API
`GET /v1/blocage?appareil=…&domaine=…` ; si le domaine est bloqué, elle affiche une page avec le
mode, la raison et, si le mode autorise les sessions, l'ouverture d'une session (tâche du jour,
10 s d'attente, `POST /v1/sessions`).

## Construire

```sh
npm ci
npm run typecheck
npm run build        # tsc vers dist/, puis copie de statique/ (manifest, pages, icônes)
```

## Charger en mode développeur

1. `chrome://extensions` → activer **Mode développeur**.
2. **Charger l'extension non empaquetée** → choisir le dossier `extension/dist/`.
3. La page d'options s'ouvre : adresse de l'API (HTTPS ; HTTP seulement pour `localhost`),
   jeton `interface`, nom de l'appareil tel qu'écrit dans la config (ex. `pc_linux`).
   « Enregistrer et vérifier » demande l'accès à l'hôte de l'API puis teste le jeton et l'appareil.

Après une modification : `npm run build`, puis le bouton ↻ de l'extension.

Permissions : `webNavigation`, `storage`, et l'hôte de l'API seul, demandé à l'enregistrement
des options (`optional_host_permissions`). Les réglages restent dans `chrome.storage.local`.
