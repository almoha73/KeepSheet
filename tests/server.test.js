const test = require('node:test');
const assert = require('node:assert');
const { loadBackend } = require('./gas-mock');

const PAST = '2026-01-01T08:00:00.000Z';
const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();

test('le token API est obligatoire', () => {
  const { post, api } = loadBackend();
  assert.strictEqual(post({ action: 'getAll' }).ok, false);
  assert.strictEqual(post({ action: 'getAll', token: 'faux' }).ok, false);
  assert.strictEqual(api('getAll').ok, true);
});

test('doGet ne renvoie aucune donnée', () => {
  const { ctx } = loadBackend();
  const res = ctx.doGet();
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.notes, undefined);
});

test('la version la plus récente gagne', () => {
  const { api } = loadBackend();
  api('saveTodo', { id: 't1', title: 'récente', updatedAt: iso(0) });
  api('saveTodo', { id: 't1', title: 'ancienne', updatedAt: iso(-3600e3) });
  assert.strictEqual(api('getAll').todos[0].title, 'récente');
});

test('un élément supprimé définitivement ne peut pas être recréé', () => {
  const { api } = loadBackend();
  api('saveNote', { id: 'n1', title: 'a', updatedAt: iso(-1000) });
  api('deleteNote', { id: 'n1' });
  api('saveNote', { id: 'n1', title: 'revenant', updatedAt: iso(0) });
  assert.strictEqual(api('getAll').notes.length, 0);
});

test('vider la corbeille empêche aussi la recréation', () => {
  const { api } = loadBackend();
  api('saveTodo', { id: 't1', title: 'x', deletedAt: iso(-1000), updatedAt: iso(-1000) });
  api('saveTodo', { id: 't2', title: 'garder', updatedAt: iso(-1000) });
  api('emptyTrash');
  api('saveTodo', { id: 't1', title: 'x', deletedAt: '', updatedAt: iso(0) });
  const todos = api('getAll').todos;
  assert.deepStrictEqual(todos.map((t) => t.id), ['t2']);
});

test('tâche récurrente : notifiée une fois, pas avancée par le serveur', () => {
  const { api, ctx, telegram } = loadBackend();
  api('saveTodo', { id: 't1', title: 'quotidienne', reminderAt: PAST, recurrence: 'daily', updatedAt: iso(-1000) });
  ctx.checkReminders();
  ctx.checkReminders();
  const t = api('getAll').todos[0];
  assert.strictEqual(t.reminderAt, PAST);
  assert.strictEqual(t.notified, true);
  assert.strictEqual(telegram.length, 1);
});

test('note récurrente : reprogrammée, sans doublon si un appareil renvoie l’ancienne date', () => {
  const { api, ctx, telegram } = loadBackend();
  const stale = { id: 'n1', title: 'note', reminderAt: PAST, recurrence: 'daily', notified: false };
  api('saveNote', { ...stale, updatedAt: iso(-1000) });
  ctx.checkReminders();
  const advanced = api('getAll').notes[0].reminderAt;
  assert.ok(new Date(advanced) > new Date());

  // Un appareil modifie le texte avec l'ancienne date de rappel
  api('saveNote', { ...stale, title: 'note modifiée', updatedAt: iso(0) });
  ctx.checkReminders();
  const note = api('getAll').notes[0];
  assert.strictEqual(note.title, 'note modifiée');
  assert.strictEqual(note.reminderAt, advanced);
  assert.strictEqual(telegram.length, 1);
});

test('un rappel déjà envoyé n’est pas renvoyé après une modification', () => {
  const { api, ctx, telegram } = loadBackend();
  api('saveTodo', { id: 't1', title: 'x', reminderAt: PAST, updatedAt: iso(-1000) });
  ctx.checkReminders();
  api('saveTodo', { id: 't1', title: 'y', reminderAt: PAST, notified: false, updatedAt: iso(0) });
  ctx.checkReminders();
  assert.strictEqual(telegram.length, 1);
});

test('le webhook Telegram exige le secret', () => {
  const { post, api, ctx } = loadBackend();
  post({ update_id: 1, message: { chat: { id: 42 }, text: '/todo pirate' } });
  assert.strictEqual(api('getAll').todos.length, 0);
  post({ update_id: 2, message: { chat: { id: 42 }, text: '/todo ok' } }, { tg: ctx.webhookSecret_() });
  assert.strictEqual(api('getAll').todos.length, 1);
});

test('le webhook ignore un autre chat', () => {
  const { post, api, ctx } = loadBackend();
  post({ update_id: 1, message: { chat: { id: 7 }, text: '/todo intrus' } }, { tg: ctx.webhookSecret_() });
  assert.strictEqual(api('getAll').todos.length, 0);
});

test('les textes spéciaux (checklists, formules, téléphones, heures) restent intacts sans apostrophe parasite', () => {
  const { api, sheets } = loadBackend();
  api('saveNote', {
    id: 'n1',
    title: '=50€',
    content: '- [ ] Pain\n- [x] Lait',
    tags: '12:30, 50%, 0612345678',
    updatedAt: iso(0),
  });
  // Colonnes texte Notes : id(1), title(2), content(3), color(4), reminderAt(7), updatedAt(9), tags(10), recurrence(11), deletedAt(13)
  [1, 2, 3, 4, 7, 9, 10, 11, 13].forEach((col) => {
    assert.strictEqual(sheets.Notes.formats[col], '@');
  });
  // Colonnes non-texte restent en format General (pinned=5, archived=6, notified=8, position=12)
  [5, 6, 8, 12].forEach((col) => {
    assert.strictEqual(sheets.Notes.formats[col], 'General');
  });
  const saved = api('getAll').notes[0];
  assert.strictEqual(saved.title, '=50€');
  assert.strictEqual(saved.content, '- [ ] Pain\n- [x] Lait');
  assert.strictEqual(saved.tags, '12:30, 50%, 0612345678');
});

test('les messages Telegram > 4096 caractères sont tronqués sans casser le HTML ni les entités', () => {
  const { ctx, telegram } = loadBackend();
  const longMsg = '<b>Titre</b>\n' + 'a'.repeat(5000);
  ctx.sendTelegramMessage_(longMsg);
  assert.strictEqual(telegram.length, 1);
  assert.ok(telegram[0].payload.text.length <= 4096);
  assert.ok(telegram[0].payload.text.includes('tronqué'));

  // Entité &amp; coupée pile à la limite (3900)
  const edgeMsg = 'a'.repeat(3898) + '&amp;suite';
  const truncated = ctx.truncateTelegramHtml_(edgeMsg, 3900);
  assert.ok(!truncated.includes('&a\n'));
  assert.ok(truncated.startsWith('a'.repeat(3898) + '\n'));
});

test('la récurrence mensuelle le 31 janvier passe au 28 février', () => {
  const { ctx } = loadBackend();
  const jan31 = new Date('2026-01-31T08:00:00.000Z');
  const next = ctx.advanceRecurrenceDate_(jan31, 'monthly', new Date('2026-02-01T00:00:00.000Z'));
  assert.strictEqual(next.getFullYear(), 2026);
  assert.strictEqual(next.getMonth(), 1); // Février (0-indexed)
  assert.strictEqual(next.getDate(), 28);
});

test('une note ajoutée via Telegram passe au-dessus des notes existantes', () => {
  const { post, api, ctx } = loadBackend();
  api('saveNote', { id: 'n1', title: 'existante', position: -5, updatedAt: iso(-1000) });
  post({ update_id: 1, message: { chat: { id: 42 }, text: '/note depuis telegram' } }, { tg: ctx.webhookSecret_() });
  const tgNote = api('getAll').notes.find((n) => n.title === 'depuis telegram');
  assert.strictEqual(tgNote.position, -6);
});
