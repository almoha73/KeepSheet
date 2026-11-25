const test = require('node:test');
const assert = require('node:assert');
const { enqueue, applyPending } = require('../queue.js');

test('seule la dernière version d’un élément est gardée', () => {
  let q = [];
  q = enqueue(q, 'saveNote', { id: 'n1', title: 'v1' });
  q = enqueue(q, 'saveNote', { id: 'n1', title: 'v2' });
  q = enqueue(q, 'saveTodo', { id: 'n1', title: 'autre type' });
  assert.strictEqual(q.length, 2);
  assert.deepStrictEqual(
    q.map((x) => [x.action, x.payload.title]),
    [['saveNote', 'v2'], ['saveTodo', 'autre type']]
  );
});

test('une suppression remplace une sauvegarde en attente', () => {
  let q = enqueue([], 'saveNote', { id: 'n1' });
  q = enqueue(q, 'deleteNote', { id: 'n1' });
  assert.deepStrictEqual(q.map((x) => x.action), ['deleteNote']);
});

test('la file garde une copie figée du contenu', () => {
  const note = { id: 'n1', title: 'avant' };
  const q = enqueue([], 'saveNote', note);
  note.title = 'après';
  assert.strictEqual(q[0].payload.title, 'avant');
});

test('les réordonnancements sont fusionnés', () => {
  let q = enqueue([], 'reorderNotes', { order: [{ id: 'a', position: 0 }, { id: 'b', position: 1 }] });
  q = enqueue(q, 'reorderNotes', { order: [{ id: 'b', position: 0 }] });
  assert.strictEqual(q.length, 1);
  assert.deepStrictEqual(q[0].payload.order, [{ id: 'a', position: 0 }, { id: 'b', position: 0 }]);
});

test('les entrées non concernées gardent leur identité', () => {
  const q1 = enqueue([], 'saveNote', { id: 'n1' });
  const q2 = enqueue(q1, 'saveTodo', { id: 't1' });
  assert.strictEqual(q2[0], q1[0]);
});

test('les actions en attente sont ré-appliquées sur les données du Sheet', () => {
  const server = {
    notes: [{ id: 'n1', title: 'serveur', position: 5 }, { id: 'n2', title: 'à supprimer' }, { id: 'n3', deletedAt: 'x' }],
    todos: [{ id: 't1', title: 'serveur' }],
  };
  let q = enqueue([], 'saveNote', { id: 'n1', title: 'local' });
  q = enqueue(q, 'saveTodo', { id: 't2', title: 'nouvelle' });
  q = enqueue(q, 'deleteNote', { id: 'n2' });
  q = enqueue(q, 'emptyTrash', {});
  q = enqueue(q, 'reorderNotes', { order: [{ id: 'n1', position: 0 }] });
  const out = applyPending(server, q);
  assert.deepStrictEqual(out.notes, [{ id: 'n1', title: 'local', position: 0 }]);
  assert.deepStrictEqual(out.todos.map((t) => t.id), ['t2', 't1']);
  assert.strictEqual(server.notes[0].title, 'serveur'); // pas de mutation
});
