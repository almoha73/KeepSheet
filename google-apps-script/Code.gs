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
 */

const SHEET_NOTES = 'Notes';
const SHEET_TODOS = 'Todos';
const SHEET_CONFIG = 'Config';

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
      ['API_TOKEN', '', 'Mot de passe optionnel partagé avec la PWA'],
      ['DAILY_SUMMARY_HOUR', '8', 'Heure du résumé quotidien (0 à 23, ex: 8 pour 8h)'],
    ]);
    configSheet.autoResizeColumns(1, 3);
  }

  SpreadsheetApp.getUi().alert(
    'Onglets KeepSheet prêts !\n\nRemplissez TELEGRAM_BOT_TOKEN et TELEGRAM_CHAT_ID dans l’onglet "Config", puis activez les rappels via le menu 📌 KeepSheet.'
  );
}

/**
 * Installe les déclencheurs automatiques :
 * - checkReminders toutes les 5 minutes
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

function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    verifyToken_(params.token);

    const action = params.action || 'getAll';
    if (action === 'getAll') {
      return jsonResponse_({
        ok: true,
        notes: readRecords_(SHEET_NOTES, NOTES_HEADERS),
        todos: readRecords_(SHEET_TODOS, TODOS_HEADERS),
      });
    }

    return jsonResponse_({ ok: false, error: 'Action GET inconnue : ' + action });
  } catch (err) {
    return jsonResponse_({ ok: false, error: err.message });
  }
}

function doPost(e) {
  try {
    const raw = (e && e.postData && e.postData.contents) || '{}';
    const body = JSON.parse(raw);

    // 1. Requête entrante depuis le Webhook Telegram (message envoyé au bot)
    if (body && body.message && body.message.chat) {
      handleTelegramWebhook_(body.message);
      return jsonResponse_({ ok: true });
    }

    // 2. Requête API depuis la PWA KeepSheet
    verifyToken_(body.token);

    const action = body.action;
    const payload = body.payload || {};

    switch (action) {
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
  } catch (err) {
    return jsonResponse_({ ok: false, error: err.message });
  }
}

// ============================================================================
// NOTIFICATIONS TELEGRAM AUTOMATIQUES
// ============================================================================

/**
 * Vérifie toutes les 5 minutes les notes et tâches dont reminderAt <= maintenant.
 */
function checkReminders() {
  const now = new Date();
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. Notes
  const notesSheet = ensureSheet_(ss, SHEET_NOTES, NOTES_HEADERS);
  if (notesSheet && notesSheet.getLastRow() > 1) {
    const rows = notesSheet.getRange(2, 1, notesSheet.getLastRow() - 1, NOTES_HEADERS.length).getValues();
    rows.forEach((row, index) => {
      const note = rowToObject_(NOTES_HEADERS, row);
      if (note.deletedAt || note.archived || note.notified || !note.reminderAt) return;
      const reminderDate = parseDate_(note.reminderAt);
      if (reminderDate && reminderDate <= now) {
        const recLabel = recurrenceLabel_(note.recurrence);
        const msg =
          `🔔 <b>Rappel Note${recLabel ? ' (' + recLabel + ')' : ''}</b>\n` +
          `📌 <b>${escapeHtml_(note.title || 'Note sans titre')}</b>` +
          (note.content ? `\n\n${escapeHtml_(note.content)}` : '');
        sendTelegramMessage_(msg);

        const nextDate = advanceRecurrenceDate_(reminderDate, note.recurrence, now);
        if (nextDate) {
          notesSheet.getRange(index + 2, NOTES_HEADERS.indexOf('reminderAt') + 1).setValue(nextDate.toISOString());
          notesSheet.getRange(index + 2, NOTES_HEADERS.indexOf('notified') + 1).setValue(false);
        } else {
          notesSheet.getRange(index + 2, NOTES_HEADERS.indexOf('notified') + 1).setValue(true);
        }
      }
    });
  }

  // 2. Todos
  const todosSheet = ensureSheet_(ss, SHEET_TODOS, TODOS_HEADERS);
  if (todosSheet && todosSheet.getLastRow() > 1) {
    const rows = todosSheet.getRange(2, 1, todosSheet.getLastRow() - 1, TODOS_HEADERS.length).getValues();
    rows.forEach((row, index) => {
      const todo = rowToObject_(TODOS_HEADERS, row);
      if (todo.deletedAt || todo.done || todo.notified || !todo.reminderAt) return;
      const reminderDate = parseDate_(todo.reminderAt);
      if (reminderDate && reminderDate <= now) {
        const prio = todo.priority === 'high' ? ' 🔥 (Haute priorité)' : '';
        const recLabel = recurrenceLabel_(todo.recurrence);
        const msg =
          `⏰ <b>Rappel Tâche${prio}${recLabel ? ' (' + recLabel + ')' : ''}</b>\n` +
          `☑️ <b>${escapeHtml_(todo.title || 'Tâche')}</b>` +
          (todo.notes ? `\n\n${escapeHtml_(todo.notes)}` : '');
        sendTelegramMessage_(msg);

        const nextDate = advanceRecurrenceDate_(reminderDate, todo.recurrence, now);
        if (nextDate) {
          todosSheet.getRange(index + 2, TODOS_HEADERS.indexOf('reminderAt') + 1).setValue(nextDate.toISOString());
          todosSheet.getRange(index + 2, TODOS_HEADERS.indexOf('notified') + 1).setValue(false);
        } else {
          todosSheet.getRange(index + 2, TODOS_HEADERS.indexOf('notified') + 1).setValue(true);
        }
      }
    });
  }
}

function advanceRecurrenceDate_(date, recurrence, now) {
  if (!recurrence || !date) return null;
  const next = new Date(date.getTime());
  let guard = 0;
  while (next <= now && guard < 400) {
    if (recurrence === 'daily') {
      next.setDate(next.getDate() + 1);
    } else if (recurrence === 'weekly') {
      next.setDate(next.getDate() + 7);
    } else if (recurrence === 'monthly') {
      next.setMonth(next.getMonth() + 1);
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

function sendTelegramMessage_(htmlText) {
  const config = getConfig_();
  const botToken = config.TELEGRAM_BOT_TOKEN;
  const chatId = config.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    throw new Error('TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID manquant dans l’onglet Config.');
  }

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      chat_id: chatId,
      text: htmlText,
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
    payload: JSON.stringify({ url: String(webAppUrl).trim() }),
    muteHttpExceptions: true,
  });

  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error(`Erreur setWebhook (${code}) : ${response.getContentText()}`);
  }
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
    position: -1,
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
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i][delCol]) {
        sheet.deleteRow(i + 2);
      }
    }
  });
}

// ============================================================================
// UTILITAIRES GOOGLE SHEETS
// ============================================================================

function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#e0f2fe');
    sheet.setFrozenRows(1);
  } else {
    const currentCols = Math.max(sheet.getLastColumn(), 0);
    const existing = currentCols > 0 ? sheet.getRange(1, 1, 1, currentCols).getValues()[0] : [];
    if (existing.length < headers.length) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#e0f2fe');
    }
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

function verifyToken_(providedToken) {
  const config = getConfig_();
  if (config.API_TOKEN && String(providedToken || '').trim() !== config.API_TOKEN) {
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

function upsertRecord_(sheetName, headers, record) {
  if (!record || !record.id) throw new Error('Champ id manquant.');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ensureSheet_(ss, sheetName, headers);

  const values = headers.map((h) => {
    const val = record[h];
    return val === undefined || val === null ? '' : val;
  });

  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
    const existingIndex = ids.indexOf(record.id);
    if (existingIndex !== -1) {
      sheet.getRange(existingIndex + 2, 1, 1, headers.length).setValues([values]);
      return;
    }
  }

  sheet.appendRow(values);
}

function deleteRecord_(sheetName, id) {
  if (!id) return;
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
