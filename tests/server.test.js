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
