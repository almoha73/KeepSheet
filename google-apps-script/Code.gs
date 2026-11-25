/**
 * KeepSheet — Backend Google Apps Script pour Google Sheets + Telegram
 *
 * Installation rapide :
 * 1. Ouvrez un nouveau Google Sheet.
 * 2. Menu Extensions > Apps Script.
 * 3. Remplacez le contenu par ce fichier et enregistrez.
 * 4. Rechargez le Google Sheet : un menu "📌 KeepSheet" apparaît.
 * 5. Cliquez sur "📌 KeepSheet > 1. Initialiser les onglets", remplissez l'onglet Config,
 *    puis cliquez sur "📌 KeepSheet > 2. Activer les rappels automatiques".
 * 6. Déployer > Nouveau déploiement > Application Web (Accès : Tout le monde).
 *
 * Mise à jour du code : Déployer > Gérer les déploiements > ✏️ > Version : « Nouvelle version »
 * (l'URL /exec reste la même).
 */

const SHEET_NOTES = 'Notes';
const SHEET_TODOS = 'Todos';
const SHEET_CONFIG = 'Config';
// Trace des suppressions définitives : empêche un appareil resté hors ligne
// de recréer un élément supprimé ailleurs.
const SHEET_DELETED = 'Supprimés';
const DELETED_HEADERS = ['id', 'deletedAt'];
const DELETED_RETENTION_DAYS = 180;

const NOTES_HEADERS = [
  'id',
  'title',
  'content',
  'color',
  'pinned',
  'archived',
  'reminderAt',
  'notified',
  'updatedAt',
  'tags',
  'recurrence',
  'position',
  'deletedAt',
];

const TODOS_HEADERS = [
  'id',
  'title',
  'notes',
  'done',
  'priority',
  'reminderAt',
  'notified',
  'updatedAt',
  'tags',
  'recurrence',
  'deletedAt',
];

/**
 * Ajoute un menu personnalisé dans Google Sheets à l'ouverture.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📌 KeepSheet')
    .addItem('1. Initialiser les onglets', 'setupProject')
    .addItem('2. Activer les rappels automatiques', 'setupTriggers')
    .addSeparator()
    .addItem('✈️ Tester la notification Telegram', 'testTelegramFromMenu')
    .addItem('📅 Envoyer le résumé du jour maintenant', 'sendDailySummary')
    .addItem('🔔 Vérifier les rappels maintenant', 'checkReminders')
    .addToUi();
}

/**
 * Crée les onglets Notes, Todos et Config avec leurs en-têtes.
 */
function setupProject() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  ensureSheet_(ss, SHEET_NOTES, NOTES_HEADERS);
  ensureSheet_(ss, SHEET_TODOS, TODOS_HEADERS);

  let configSheet = ss.getSheetByName(SHEET_CONFIG);
  if (!configSheet) {
    configSheet = ss.insertSheet(SHEET_CONFIG);
    configSheet.getRange(1, 1, 1, 3).setValues([['Clé', 'Valeur', 'Description']]);
    configSheet.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#fef3c7');
    configSheet.setFrozenRows(1);
    configSheet.getRange(2, 1, 4, 3).setValues([
      ['TELEGRAM_BOT_TOKEN', '', 'Token donné par @BotFather sur Telegram'],
      ['TELEGRAM_CHAT_ID', '', 'Votre Chat ID Telegram (ex: via @userinfobot)'],
      ['API_TOKEN', '', 'Mot de passe OBLIGATOIRE partagé avec la PWA (généré automatiquement)'],
      ['DAILY_SUMMARY_HOUR', '8', 'Heure du résumé quotidien (0 à 23, ex: 8 pour 8h)'],
    ]);
    configSheet.autoResizeColumns(1, 3);
  }

  let apiToken = getConfig_().API_TOKEN;
  if (!apiToken) {
    apiToken = Utilities.getUuid().replace(/-/g, '').slice(0, 20);
    setConfigValue_('API_TOKEN', apiToken, 'Mot de passe OBLIGATOIRE partagé avec la PWA');
  }

  SpreadsheetApp.getUi().alert(
    'Onglets KeepSheet prêts !\n\n' +
      'Votre API_TOKEN (à coller dans ⚙️ de l’application) :\n' +
      apiToken +
      '\n\nRemplissez TELEGRAM_BOT_TOKEN et TELEGRAM_CHAT_ID dans l’onglet "Config", puis activez les rappels via le menu 📌 KeepSheet.'
  );
}

/**
 * Installe les déclencheurs automatiques :
 * - checkReminders toutes les minutes
 * - sendDailySummary tous les jours à l'heure choisie dans Config
 */
function setupTriggers() {
  // Supprime les anciens déclencheurs KeepSheet pour éviter les doublons
  ScriptApp.getProjectTriggers().forEach((trigger) => {
    const fn = trigger.getHandlerFunction();
    if (fn === 'checkReminders' || fn === 'sendDailySummary') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  const config = getConfig_();
  const hour = Math.min(23, Math.max(0, parseInt(config.DAILY_SUMMARY_HOUR || '8', 10) || 8));

  ScriptApp.newTrigger('checkReminders').timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger('sendDailySummary').timeBased().everyDays(1).atHour(hour).create();

  SpreadsheetApp.getUi().alert(
    `Déclencheurs activés ✅\n\n• Vérification des rappels : toutes les minutes\n• Résumé quotidien : tous les jours vers ${hour}h`
  );
}

function testTelegramFromMenu() {
  try {
    sendTelegramMessage_(
      '✅ <b>KeepSheet est bien connecté !</b>\n\nVos rappels de notes et de tâches arriveront ici.'
    );
    SpreadsheetApp.getUi().alert('Message de test envoyé sur Telegram ✅');
  } catch (err) {
    SpreadsheetApp.getUi().alert('Erreur Telegram : ' + err.message);
  }
}

// ============================================================================
// API WEB (appelée par la PWA)
// ============================================================================

function doGet() {
  // Les données ne sont plus servies en GET (le token apparaîtrait dans l'URL).
  return jsonResponse_({
    ok: false,
    error:
      'Version de l’application obsolète : ouvrez ⚙️ puis « Forcer la mise à jour ».',
  });
}

function doPost(e) {
  try {
    const params = (e && e.parameter) || {};
    const raw = (e && e.postData && e.postData.contents) || '{}';
    const body = JSON.parse(raw);

    // 1. Requête entrante depuis le Webhook Telegram (message envoyé au bot)
    if (body && body.update_id !== undefined) {
      // Le secret dans l'URL du webhook prouve que l'appel vient bien de Telegram
      if (!body.message || !body.message.chat || params.tg !== webhookSecret_()) {
        return jsonResponse_({ ok: true });
      }
      withLock_(() => handleTelegramWebhook_(body.message));
      return jsonResponse_({ ok: true });
    }

    // 2. Requête API depuis la PWA KeepSheet
    verifyToken_(body.token);

    const action = body.action;
    const payload = body.payload || {};

    return withLock_(() => {
      switch (action) {
        case 'getAll':
          return jsonResponse_({
            ok: true,
            notes: readRecords_(SHEET_NOTES, NOTES_HEADERS),
            todos: readRecords_(SHEET_TODOS, TODOS_HEADERS),
          });

        case 'saveNote':
          upsertRecord_(SHEET_NOTES, NOTES_HEADERS, payload);
          return jsonResponse_({ ok: true });

        case 'deleteNote':
          deleteRecord_(SHEET_NOTES, payload.id);
          return jsonResponse_({ ok: true });

        case 'reorderNotes':
          reorderNotes_(payload.order || []);
          return jsonResponse_({ ok: true });

        case 'saveTodo':
          upsertRecord_(SHEET_TODOS, TODOS_HEADERS, payload);
          return jsonResponse_({ ok: true });

        case 'deleteTodo':
          deleteRecord_(SHEET_TODOS, payload.id);
          return jsonResponse_({ ok: true });

        case 'emptyTrash':
          emptyTrash_();
          return jsonResponse_({ ok: true });

        case 'setupTelegramWebhook':
          setupTelegramWebhook_(payload.webAppUrl);
          return jsonResponse_({ ok: true });

        case 'syncAll':
          if (Array.isArray(payload.notes)) {
            payload.notes.forEach((n) => upsertRecord_(SHEET_NOTES, NOTES_HEADERS, n));
          }
          if (Array.isArray(payload.todos)) {
            payload.todos.forEach((t) => upsertRecord_(SHEET_TODOS, TODOS_HEADERS, t));
          }
          return jsonResponse_({ ok: true });

        case 'sendTelegramTest':
          sendTelegramMessage_(
            '✅ <b>Test KeepSheet réussi !</b>\nVotre application PWA communique bien avec Google Sheets et Telegram.'
          );
          return jsonResponse_({ ok: true });

        case 'sendTelegramItem':
          sendManualItem_(payload.type, payload.item || {});
          return jsonResponse_({ ok: true });

        case 'sendDailySummary':
          sendDailySummary();
          return jsonResponse_({ ok: true });

        default:
          return jsonResponse_({ ok: false, error: 'Action POST inconnue : ' + action });
      }
    });
  } catch (err) {
    return jsonResponse_({ ok: false, error: err.message });
  }
}

/**
 * Exécute fn en exclusivité : empêche l'API et les rappels automatiques
 * de modifier le Sheet en même temps (lignes décalées, doublons…).
 */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ============================================================================
// NOTIFICATIONS TELEGRAM AUTOMATIQUES
// ============================================================================

/**
 * Vérifie toutes les minutes les notes et tâches dont reminderAt <= maintenant.
 *
 * - Note récurrente : le rappel est reprogrammé à l'occurrence suivante.
 * - Tâche récurrente : elle est marquée « notifiée » et reste en retard jusqu'à
 *   ce que vous la cochiez dans l'application, qui la reprogramme alors
 *   (sinon l'occurrence serait avancée deux fois).
 */
function checkReminders() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return; // une autre exécution est en cours : on réessaiera
  try {
    const config = getConfig_();
    if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) return;

    const now = new Date();
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    processReminders_(ss, SHEET_NOTES, NOTES_HEADERS, now, (note) => {
      if (note.deletedAt || note.archived) return null;
      const recLabel = recurrenceLabel_(note.recurrence);
      return {
        message:
          `🔔 <b>Rappel Note${recLabel ? ' (' + recLabel + ')' : ''}</b>\n` +
          `📌 <b>${escapeHtml_(note.title || 'Note sans titre')}</b>` +
          (note.content ? `\n\n${escapeHtml_(note.content)}` : ''),
        advance: true,
      };
    });

    processReminders_(ss, SHEET_TODOS, TODOS_HEADERS, now, (todo) => {
      if (todo.deletedAt || todo.done) return null;
      const prio = todo.priority === 'high' ? ' 🔥 (Haute priorité)' : '';
      const recLabel = recurrenceLabel_(todo.recurrence);
      return {
        message:
          `⏰ <b>Rappel Tâche${prio}${recLabel ? ' (' + recLabel + ')' : ''}</b>\n` +
          `☑️ <b>${escapeHtml_(todo.title || 'Tâche')}</b>` +
          (todo.notes ? `\n\n${escapeHtml_(todo.notes)}` : ''),
        advance: false,
      };
    });
  } finally {
    lock.releaseLock();
  }
}

function processReminders_(ss, sheetName, headers, now, buildFn) {
  const sheet = ensureSheet_(ss, sheetName, headers);
  if (!sheet || sheet.getLastRow() < 2) return;

  const reminderCol = headers.indexOf('reminderAt') + 1;
  const notifiedCol = headers.indexOf('notified') + 1;
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();

  rows.forEach((row, index) => {
    const item = rowToObject_(headers, row);
    if (!item.id || item.notified || !item.reminderAt) return;
    const reminderDate = parseDate_(item.reminderAt);
    if (!reminderDate || reminderDate > now) return;

    const built = buildFn(item);
    if (!built) return;

    try {
      sendTelegramMessage_(built.message);
    } catch (err) {
      console.error(err);
      return; // non marqué : nouvel essai à la prochaine exécution
    }

    const nextDate = built.advance ? advanceRecurrenceDate_(reminderDate, item.recurrence, now) : null;
    if (nextDate) {
      sheet.getRange(index + 2, reminderCol).setValue(nextDate.toISOString());
      sheet.getRange(index + 2, notifiedCol).setValue(false);
    } else {
      sheet.getRange(index + 2, notifiedCol).setValue(true);
    }
  });
}

function advanceRecurrenceDate_(date, recurrence, now) {
  if (!recurrence || !date) return null;
  const origDay = date.getDate();
  const next = new Date(date.getTime());
  let guard = 0;
  let monthsAdded = 0;
  while (next <= now && guard < 400) {
    if (recurrence === 'daily') {
      next.setDate(next.getDate() + 1);
    } else if (recurrence === 'weekly') {
      next.setDate(next.getDate() + 7);
    } else if (recurrence === 'monthly') {
      monthsAdded++;
      const targetYear = date.getFullYear();
      const targetMonth = date.getMonth() + monthsAdded;
      const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
      next.setFullYear(targetYear, targetMonth, Math.min(origDay, lastDay));
    } else {
      return null;
    }
    guard++;
  }
  return next;
}

function recurrenceLabel_(recurrence) {
  if (recurrence === 'daily') return '🔁 Tous les jours';
  if (recurrence === 'weekly') return '🔁 Toutes les semaines';
  if (recurrence === 'monthly') return '🔁 Tous les mois';
  return '';
}

/**
 * Envoie un résumé quotidien sur Telegram avec les tâches actives et urgentes.
 */
function sendDailySummary() {
  const todos = readRecords_(SHEET_TODOS, TODOS_HEADERS).filter((t) => !t.done && !t.deletedAt);
  const notes = readRecords_(SHEET_NOTES, NOTES_HEADERS).filter(
    (n) => !n.archived && !n.deletedAt && n.pinned
  );

  const high = todos.filter((t) => t.priority === 'high');
  const others = todos.filter((t) => t.priority !== 'high');

  const lines = ['☀️ <b>Résumé quotidien KeepSheet</b>', ''];

  if (todos.length === 0) {
    lines.push('🎉 Aucune tâche en attente aujourd’hui !');
  } else {
    lines.push(`📋 <b>${todos.length} tâche(s) à faire :</b>`);
    high.forEach((t) => lines.push(`• 🔥 <b>${escapeHtml_(t.title)}</b>`));
    others.slice(0, 12).forEach((t) => lines.push(`• ▫️ ${escapeHtml_(t.title)}`));
    if (others.length > 12) {
      lines.push(`<i>…et ${others.length - 12} autre(s) tâche(s).</i>`);
    }
  }

  if (notes.length > 0) {
    lines.push('', `📌 <b>Notes épinglées (${notes.length}) :</b>`);
    notes.slice(0, 5).forEach((n) => {
      lines.push(`• ${escapeHtml_(n.title || '(Sans titre)')}`);
    });
  }

  sendTelegramMessage_(lines.join('\n'));
}

function sendManualItem_(type, item) {
  if (type === 'todo') {
    const prio = item.priority === 'high' ? ' 🔥' : '';
    const msg =
      `☑️ <b>Tâche${prio} : ${escapeHtml_(item.title || 'Tâche')}</b>` +
      (item.notes ? `\n${escapeHtml_(item.notes)}` : '') +
      (item.reminderAt ? `\n🔔 Rappel : ${escapeHtml_(item.reminderAt.replace('T', ' '))}` : '');
    sendTelegramMessage_(msg);
  } else {
    const msg =
      `📌 <b>${escapeHtml_(item.title || 'Note')}</b>` +
      (item.content ? `\n\n${escapeHtml_(item.content)}` : '') +
      (item.reminderAt ? `\n\n🔔 Rappel : ${escapeHtml_(item.reminderAt.replace('T', ' '))}` : '');
    sendTelegramMessage_(msg);
  }
}

function truncateTelegramHtml_(htmlText, maxLen) {
  const str = String(htmlText || '');
  if (str.length <= maxLen) return str;
  let cut = str
    .slice(0, maxLen)
    .replace(/<[^>]*$/, '')
    .replace(/&[a-zA-Z0-9#]*$/, '');
  ['code', 'i', 'b'].forEach((tag) => {
    const opens = (cut.match(new RegExp('<' + tag + '>', 'g')) || []).length;
    const closes = (cut.match(new RegExp('</' + tag + '>', 'g')) || []).length;
    for (let i = 0; i < opens - closes; i++) cut += '</' + tag + '>';
  });
  return cut + '\n… (message tronqué)';
}

function sendTelegramMessage_(htmlText) {
  const config = getConfig_();
  const botToken = config.TELEGRAM_BOT_TOKEN;
  const chatId = config.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    throw new Error('TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID manquant dans l’onglet Config.');
  }

  const safeText = truncateTelegramHtml_(htmlText, 3900);
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      chat_id: chatId,
      text: safeText,
      parse_mode: 'HTML',
    }),
    muteHttpExceptions: true,
  });

  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error(`Erreur API Telegram (${code}) : ${response.getContentText()}`);
  }
}

/**
 * Configure le Webhook Telegram pour recevoir /note, /todo, /liste, /aide.
 */
function setupTelegramWebhook_(webAppUrl) {
  const config = getConfig_();
  const botToken = config.TELEGRAM_BOT_TOKEN;
  if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN manquant dans Config.');
  if (!webAppUrl || !String(webAppUrl).startsWith('https://script.google.com/macros/s/')) {
    throw new Error('URL Web App Apps Script invalide.');
  }

  const url = `https://api.telegram.org/bot${botToken}/setWebhook`;
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      url: String(webAppUrl).trim() + '?tg=' + webhookSecret_(),
      allowed_updates: ['message'],
    }),
    muteHttpExceptions: true,
  });

  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error(`Erreur setWebhook (${code}) : ${response.getContentText()}`);
  }
}

/**
 * Secret dérivé de API_TOKEN, ajouté à l'URL du webhook Telegram.
 * (Apps Script ne donne pas accès aux en-têtes HTTP, d'où le paramètre d'URL.)
 */
function webhookSecret_() {
  const token = getConfig_().API_TOKEN;
  if (!token) throw new Error('API_TOKEN manquant dans l’onglet Config.');
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    'keepsheet-telegram:' + token,
    Utilities.Charset.UTF_8
  );
  return bytes
    .map((b) => ((b + 256) % 256).toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

/**
 * Traite les messages envoyés directement au Bot Telegram.
 */
function handleTelegramWebhook_(message) {
  const config = getConfig_();
  const allowedChatId = String(config.TELEGRAM_CHAT_ID || '').trim();
  const incomingChatId = String(message.chat.id);
  if (!allowedChatId || incomingChatId !== allowedChatId) return;

  const text = String(message.text || '').trim();
  if (!text) return;

  const now = new Date().toISOString();

  if (text === '/start' || text === '/help' || text === '/aide') {
    sendTelegramMessage_(
      '🤖 <b>Commandes KeepSheet :</b>\n\n' +
        '• <code>/note Acheter du pain</code> → Ajoute une note\n' +
        '• <code>/note Titre | Contenu</code> → Note avec titre et texte\n' +
        '• <code>/todo Appeler le dentiste</code> → Ajoute une tâche\n' +
        '• <code>/todo ! Payer facture</code> → Tâche urgente 🔥\n' +
        '• <code>/liste</code> → Voir vos tâches à faire\n\n' +
        '<i>Astuce : un message simple sans commande crée directement une note !</i>'
    );
    return;
  }

  if (text === '/liste' || text === '/todos') {
    sendDailySummary();
    return;
  }

  if (text.toLowerCase().startsWith('/todo')) {
    let rawTodo = text.replace(/^\/todo\s*/i, '').trim();
    if (!rawTodo) {
      sendTelegramMessage_('Utilisation : <code>/todo Votre tâche</code>');
      return;
    }
    let priority = 'normal';
    if (rawTodo.startsWith('!')) {
      priority = 'high';
      rawTodo = rawTodo.replace(/^!\s*/, '').trim();
    }
    const todo = {
      id: 'todo_' + Utilities.getUuid().slice(0, 8),
      title: rawTodo,
      notes: 'Ajouté via Telegram',
      done: false,
      priority: priority,
      reminderAt: '',
      notified: false,
      updatedAt: now,
      tags: 'Telegram',
      recurrence: '',
      deletedAt: '',
    };
    upsertRecord_(SHEET_TODOS, TODOS_HEADERS, todo);
    sendTelegramMessage_(
      `☑️ <b>Tâche ajoutée${priority === 'high' ? ' 🔥' : ''} :</b> ${escapeHtml_(rawTodo)}`
    );
    return;
  }

  // Par défaut : /note ou texte libre -> crée une note
  let rawNote = text.replace(/^\/note\s*/i, '').trim();
  if (!rawNote) {
    sendTelegramMessage_('Utilisation : <code>/note Votre note</code>');
    return;
  }

  let title = rawNote;
  let content = '';
  if (rawNote.indexOf('|') !== -1) {
    const parts = rawNote.split('|');
    title = parts[0].trim();
    content = parts.slice(1).join('|').trim();
  } else if (rawNote.indexOf('\n') !== -1) {
    const lines = rawNote.split('\n');
    title = lines[0].trim();
    content = lines.slice(1).join('\n').trim();
  }

  const existingNotes = readRecords_(SHEET_NOTES, NOTES_HEADERS);
  const positions = existingNotes
    .map((n) => n.position)
    .filter((p) => typeof p === 'number' && !isNaN(p));
  const topPosition = positions.length ? Math.min.apply(null, positions) - 1 : 0;

  const note = {
    id: 'note_' + Utilities.getUuid().slice(0, 8),
    title: title,
    content: content,
    color: 'default',
    pinned: false,
    archived: false,
    reminderAt: '',
    notified: false,
    updatedAt: now,
    tags: 'Telegram',
    recurrence: '',
    position: topPosition,
    deletedAt: '',
  };
  upsertRecord_(SHEET_NOTES, NOTES_HEADERS, note);
  sendTelegramMessage_(`📌 <b>Note ajoutée :</b> ${escapeHtml_(title)}`);
}

function emptyTrash_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  [
    [SHEET_NOTES, NOTES_HEADERS],
    [SHEET_TODOS, TODOS_HEADERS],
  ].forEach(([sheetName, headers]) => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet || sheet.getLastRow() < 2) return;
    const delCol = headers.indexOf('deletedAt');
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
    const removedIds = [];
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i][delCol]) {
        removedIds.push(rows[i][0]);
        sheet.deleteRow(i + 2);
      }
    }
    addTombstones_(removedIds);
  });
  pruneTombstones_();
}

function tombstoneSheet_() {
  return ensureSheet_(SpreadsheetApp.getActiveSpreadsheet(), SHEET_DELETED, DELETED_HEADERS);
}

function addTombstones_(ids) {
  const clean = (ids || []).filter(Boolean);
  if (clean.length === 0) return;
  const sheet = tombstoneSheet_();
  const existing =
    sheet.getLastRow() >= 2
      ? new Set(sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().flat())
      : new Set();
  const toAdd = clean.filter((id) => !existing.has(id));
  if (toAdd.length === 0) return;
  const now = new Date().toISOString();
  const rows = toAdd.map((id) => [id, now]);
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 2).setValues(rows);
}

function isTombstoned_(id) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_DELETED);
  if (!sheet || sheet.getLastRow() < 2) return false;
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().flat().indexOf(id) !== -1;
}

function pruneTombstones_() {
  const sheet = tombstoneSheet_();
  if (sheet.getLastRow() < 2) return;
  const limit = Date.now() - DELETED_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  for (let i = rows.length - 1; i >= 0; i--) {
    const d = parseDate_(rows[i][1]);
    if (d && d.getTime() < limit) sheet.deleteRow(i + 2);
  }
}

// ============================================================================
// UTILITAIRES GOOGLE SHEETS
// ============================================================================

const TEXT_COLUMNS = ['id', 'title', 'content', 'notes', 'color', 'tags', 'recurrence'];

function formatTextColumns_(sheet, headers, startRow, numRows) {
  if (numRows < 1) return;
  headers.forEach((h, i) => {
    if (TEXT_COLUMNS.indexOf(h) !== -1) {
      sheet.getRange(startRow, i + 1, numRows, 1).setNumberFormat('@');
    }
  });
}

function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#e0f2fe');
    sheet.setFrozenRows(1);
    formatTextColumns_(sheet, headers, 2, Math.max(sheet.getMaxRows() - 1, 1));
  } else {
    const currentCols = Math.max(sheet.getLastColumn(), 0);
    const existing = currentCols > 0 ? sheet.getRange(1, 1, 1, currentCols).getValues()[0] : [];
    if (existing.length < headers.length) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#e0f2fe');
    }
    formatTextColumns_(sheet, headers, 2, Math.max(sheet.getMaxRows() - 1, 1));
  }
  return sheet;
}

function getConfig_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_CONFIG);
  const config = {};
  if (!sheet || sheet.getLastRow() < 2) return config;

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  rows.forEach(([key, value]) => {
    if (key) config[String(key).trim()] = String(value || '').trim();
  });
  return config;
}

function setConfigValue_(key, value, description) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_CONFIG);
  if (!sheet) return;
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const keys = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
    const idx = keys.map((k) => String(k).trim()).indexOf(key);
    if (idx !== -1) {
      sheet.getRange(idx + 2, 2).setValue(value);
      return;
    }
  }
  sheet.appendRow([key, value, description || '']);
}

function verifyToken_(providedToken) {
  const config = getConfig_();
  if (!config.API_TOKEN) {
    throw new Error(
      'API_TOKEN non défini : dans Google Sheets, lancez « 📌 KeepSheet → 1. Initialiser les onglets » pour en générer un.'
    );
  }
  if (String(providedToken || '').trim() !== config.API_TOKEN) {
    throw new Error('Clé secrète API invalide.');
  }
}

function readRecords_(sheetName, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ensureSheet_(ss, sheetName, headers);
  if (sheet.getLastRow() < 2) return [];

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  return rows
    .filter((row) => row[0])
    .map((row) => rowToObject_(headers, row));
}

function sanitizeForSheet_(header, val) {
  if (val === undefined || val === null) return '';
  if (header === 'pinned' || header === 'archived' || header === 'done' || header === 'notified') {
    return Boolean(val);
  }
  if (header === 'position') {
    return typeof val === 'number' && !isNaN(val) ? val : '';
  }
  const str = String(val);
  // Préfixe ' : empêche Google Sheets d'interpréter =, +, -, @ en formule
  // ou de convertir des numéros/dates (ex: 0612345678, 10/11).
  if (str.length > 0 && (/^[=+\-@']/.test(str) || /^0\d+$/.test(str) || /^\d{1,2}[\/\-]\d{1,2}/.test(str))) {
    return "'" + str;
  }
  return str;
}

function upsertRecord_(sheetName, headers, record) {
  if (!record || !record.id) throw new Error('Champ id manquant.');
  if (isTombstoned_(record.id)) return false; // supprimé définitivement ailleurs
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ensureSheet_(ss, sheetName, headers);

  const values = headers.map((h) => sanitizeForSheet_(h, record[h]));

  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
    const existingIndex = ids.indexOf(record.id);
    if (existingIndex !== -1) {
      const rowNum = existingIndex + 2;
      const current = rowToObject_(
        headers,
        sheet.getRange(rowNum, 1, 1, headers.length).getValues()[0]
      );

      // La version la plus récente gagne : on ignore une écriture plus ancienne
      // (ex. modification hors ligne d'un autre appareil envoyée en retard).
      const currentTime = parseDate_(current.updatedAt);
      const incomingTime = parseDate_(record.updatedAt);
      if (currentTime && incomingTime && incomingTime < currentTime) return false;

      // Ne pas renvoyer un rappel déjà envoyé si la date n'a pas changé
      const notifiedIdx = headers.indexOf('notified');
      if (notifiedIdx !== -1 && current.notified && sameInstant_(current.reminderAt, record.reminderAt)) {
        values[notifiedIdx] = true;
      }

      // Rappel récurrent déjà envoyé puis reprogrammé par le serveur : un appareil
      // qui renvoie l'ancienne date (déjà passée) ne doit pas déclencher un doublon.
      const reminderIdx = headers.indexOf('reminderAt');
      if (reminderIdx !== -1 && record.recurrence && record.recurrence === current.recurrence) {
        const incoming = parseDate_(record.reminderAt);
        const stored = parseDate_(current.reminderAt);
        if (incoming && stored && incoming <= new Date() && stored > incoming) {
          values[reminderIdx] = sanitizeForSheet_('reminderAt', current.reminderAt);
          if (notifiedIdx !== -1) values[notifiedIdx] = current.notified;
        }
      }

      formatTextColumns_(sheet, headers, rowNum, 1);
      sheet.getRange(rowNum, 1, 1, headers.length).setValues([values]);
      return true;
    }
  }

  const targetRow = lastRow + 1;
  formatTextColumns_(sheet, headers, targetRow, 1);
  sheet.getRange(targetRow, 1, 1, headers.length).setValues([values]);
  return true;
}

function sameInstant_(a, b) {
  const da = parseDate_(a);
  const db = parseDate_(b);
  if (!da || !db) return !a && !b;
  return da.getTime() === db.getTime();
}

function deleteRecord_(sheetName, id) {
  if (!id) return;
  addTombstones_([id]);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return;

  const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().flat();
  const existingIndex = ids.indexOf(id);
  if (existingIndex !== -1) {
    sheet.deleteRow(existingIndex + 2);
  }
}

function reorderNotes_(orderList) {
  if (!Array.isArray(orderList) || orderList.length === 0) return;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ensureSheet_(ss, SHEET_NOTES, NOTES_HEADERS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const posMap = {};
  orderList.forEach((item) => {
    if (item && item.id !== undefined) posMap[item.id] = Number(item.position);
  });

  const posCol = NOTES_HEADERS.indexOf('position') + 1;
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  const currentPos = sheet.getRange(2, posCol, lastRow - 1, 1).getValues();
  const updated = currentPos.map((cell, i) => {
    const id = ids[i];
    return [posMap[id] !== undefined ? posMap[id] : cell[0]];
  });
  sheet.getRange(2, posCol, lastRow - 1, 1).setValues(updated);
}

function rowToObject_(headers, row) {
  const obj = {};
  headers.forEach((h, i) => {
    let val = row[i];
    if (val instanceof Date) {
      val = val.toISOString();
    }
    if (h === 'pinned' || h === 'archived' || h === 'done' || h === 'notified') {
      val = val === true || val === 'true' || val === 'TRUE';
    } else if (TEXT_COLUMNS.indexOf(h) !== -1) {
      val = val === '' || val === null || val === undefined ? '' : String(val);
    }
    obj[h] = val;
  });
  return obj;
}

function parseDate_(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const d = new Date(String(value));
  return isNaN(d.getTime()) ? null : d;
}

function escapeHtml_(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
