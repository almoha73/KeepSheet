# 📌 KeepSheet — Notes façon Google Keep + Todo List + Google Sheets + Telegram

**KeepSheet** est une **PWA installable sur Android** (et utilisable sur PC) qui combine :
- **Notes façon Google Keep** : 8 couleurs, épinglage, recherche instantanée, archivage.
- **Todo List** : priorités (Haute / Normale / Basse), filtres, barre de progression.
- **Mode clair / sombre** automatique ou manuel.
- **Synchronisation Google Sheets** (100 % gratuit, vos données restent chez vous).
- **Notifications Telegram automatiques** : rappels à date/heure précise, résumé quotidien le matin, et envoi manuel en 1 clic — même quand l'application est fermée.

---

## Étape 1 : Créer le Bot Telegram (2 minutes)

1. Ouvrez **Telegram** et cherchez **`@BotFather`**.
2. Envoyez `/newbot`, choisissez un nom (ex. `Mon KeepSheet`) puis un nom d'utilisateur finissant par `bot` (ex. `mon_keepsheet_bot`).
3. `@BotFather` vous donne un **Token** (ex. `123456789:ABCdef...`). Gardez-le de côté.
4. **Important** : ouvrez une conversation avec votre nouveau bot et cliquez sur **Démarrer** (`/start`).
5. Pour connaître votre **Chat ID**, envoyez un message à **`@userinfobot`** sur Telegram : il vous répond immédiatement votre numéro `Id` (ex. `987654321`).

---

## Étape 2 : Configurer Google Sheets & Apps Script (3 minutes)

1. Créez un nouveau tableur sur [sheets.google.com](https://sheets.google.com) (ex. nommez-le `KeepSheet`).
2. Dans le menu en haut, cliquez sur **Extensions → Apps Script**.
3. Effacez le code par défaut et collez tout le contenu du fichier `google-apps-script/Code.gs`.
4. Cliquez sur **Enregistrer** (💾), puis rechargez l'onglet de votre Google Sheet.
5. Un nouveau menu **`📌 KeepSheet`** apparaît dans Google Sheets :
   - Cliquez sur **`📌 KeepSheet → 1. Initialiser les onglets`** (acceptez les autorisations Google la première fois).
   - Ouvrez l'onglet **`Config`** créé automatiquement et renseignez :
     - `TELEGRAM_BOT_TOKEN` : le token de `@BotFather`
     - `TELEGRAM_CHAT_ID` : votre identifiant Telegram
     - `API_TOKEN` : **généré automatiquement** à l'initialisation (affiché dans la fenêtre). Il est **obligatoire** : sans lui, n'importe qui connaissant l'URL pourrait lire vos notes.
     - `DAILY_SUMMARY_HOUR` : l'heure du résumé quotidien (ex. `8` pour 8h du matin)
   - Cliquez sur **`📌 KeepSheet → ✈️ Tester la notification Telegram`** pour vérifier que vous recevez bien le message !
   - Cliquez sur **`📌 KeepSheet → 2. Activer les rappels automatiques`**.

### Déployer l'API Web
1. Retournez dans **Extensions → Apps Script**.
2. Cliquez en haut à droite sur **Déployer → Nouveau déploiement**.
3. Type : **Application Web**.
   - **Exécuter en tant que** : `Moi`
   - **Qui a accès** : `Tout le monde`
4. Cliquez sur **Déployer** et copiez l'**URL de l'application Web** (qui se termine par `/exec`).

### Mettre à jour le code Apps Script
Après avoir collé une nouvelle version de `Code.gs` : **Déployer → Gérer les déploiements → ✏️ → Version : « Nouvelle version » → Déployer**. L'URL `/exec` ne change pas. Si vous utilisez les commandes `/note` et `/todo`, cliquez ensuite à nouveau sur « 🤖 Activer commandes /note & /todo » dans ⚙️.

### Bon à savoir
- **Hors ligne** : vos modifications sont mises en file d'attente et envoyées automatiquement au retour du réseau.
- **Plusieurs appareils** : en cas de modification concurrente d'un même élément, la version la plus récente l'emporte.
- **Suppressions définitives** : l'onglet `Supprimés` garde 180 jours la trace des éléments supprimés, pour qu'un appareil resté hors ligne ne puisse pas les recréer. Ne le supprimez pas.
- **Erreurs de synchro** : elles s'affichent en rouge dans le bandeau en haut de l'application jusqu'à la prochaine synchro réussie.
- **Tâches récurrentes** : le rappel Telegram est envoyé une fois ; la tâche est reprogrammée quand vous la cochez.
- Les rappels sont vérifiés **toutes les minutes** (quota Google gratuit : 90 min d'exécution de déclencheurs par jour, largement suffisant pour un usage personnel).

---

## Étape 3 : Héberger gratuitement et installer sur Android (PWA)

Pour qu'Android Chrome propose l'installation en tant qu'application (**PWA**), les fichiers doivent être servis en **HTTPS**. Deux méthodes gratuites en 1 minute :

- **Option A — Netlify Drop (le plus rapide)** : allez sur [app.netlify.com/drop](https://app.netlify.com/drop) et glissez-déposez le dossier `keepsheet`. Vous obtenez immédiatement un lien `https://....netlify.app`.
- **Option B — GitHub Pages** : poussez le dossier `keepsheet` dans un dépôt GitHub et activez *Settings → Pages*.

### Installer sur Android
1. Ouvrez votre lien HTTPS dans **Google Chrome** sur votre téléphone Android.
2. Appuyez sur le menu **`⋮`** en haut à droite → **Installer l'application** (ou **Ajouter à l'écran d'accueil**).
3. Ouvrez **KeepSheet** depuis votre écran d'accueil, cliquez sur **`⚙️`**, collez l'URL Google Apps Script (`/exec`) et votre `API_TOKEN`, puis cliquez sur **Enregistrer & Synchroniser**.

> **Astuce** : vous pouvez aussi tester l'application immédiatement en local (mode hors-ligne) simplement en ouvrant `index.html` dans votre navigateur !

---

## Tests (développeurs)

Nécessite Node.js 18 ou plus, sans aucune dépendance :

```bash
npm test
```

Les tests vérifient le backend `Code.gs` (dans un faux Google Sheets en mémoire) et la file d'attente hors ligne (`queue.js`).

