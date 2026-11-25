/**
 * KeepSheet — logique pure de la file d'attente hors ligne.
 * Chargé dans le navigateur (window.KeepSheetQueue) et dans les tests Node (require).
 */
(function (root) {
  'use strict';

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  /**
   * Ajoute une action à la file et renvoie la nouvelle file.
   * Les entrées non concernées gardent leur identité (utile pour l'envoi en cours).
   */
  function enqueue(queue, action, payload) {
    const snapshot = clone(payload || {});
    let next = queue.slice();

    const isNoteItem = action === 'saveNote' || action === 'deleteNote';
    const isTodoItem = action === 'saveTodo' || action === 'deleteTodo';

    if (isNoteItem || isTodoItem) {
      // Seule la dernière version d'un élément compte : on remplace l'ancienne
      const related = isNoteItem ? ['saveNote', 'deleteNote'] : ['saveTodo', 'deleteTodo'];
      next = next.filter(
        (q) => !(related.includes(q.action) && q.payload && q.payload.id === snapshot.id)
      );
    } else if (action === 'reorderNotes') {
      const previous = next.find((q) => q.action === 'reorderNotes');
      if (previous) {
        const merged = new Map();
        ((previous.payload && previous.payload.order) || []).forEach((o) =>
          merged.set(o.id, o.position)
        );
        (snapshot.order || []).forEach((o) => merged.set(o.id, o.position));
        snapshot.order = Array.from(merged, ([id, position]) => ({ id, position }));
        next = next.filter((q) => q !== previous);
      }
    }

    next.push({ action, payload: snapshot });
    return next;
  }

  /**
   * Ré-applique les actions non encore envoyées sur les données reçues du Sheet.
   * Renvoie de nouvelles listes { notes, todos }.
   */
  function applyPending(data, queue) {
    let notes = (data.notes || []).slice();
    let todos = (data.todos || []).slice();

    queue.forEach(({ action, payload }) => {
      if (action === 'saveNote' || action === 'saveTodo') {
        const copy = clone(payload);
        const list = action === 'saveNote' ? notes : todos;
        const idx = list.findIndex((x) => x.id === copy.id);
        if (idx === -1) list.unshift(copy);
        else list[idx] = copy;
      } else if (action === 'deleteNote') {
        notes = notes.filter((n) => n.id !== payload.id);
      } else if (action === 'deleteTodo') {
        todos = todos.filter((t) => t.id !== payload.id);
      } else if (action === 'emptyTrash') {
        notes = notes.filter((n) => !n.deletedAt);
        todos = todos.filter((t) => !t.deletedAt);
      } else if (action === 'reorderNotes') {
        ((payload && payload.order) || []).forEach(({ id, position }) => {
          const idx = notes.findIndex((n) => n.id === id);
          if (idx !== -1) notes[idx] = Object.assign({}, notes[idx], { position });
        });
      }
    });

    return { notes, todos };
  }

  const api = { enqueue, applyPending };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.KeepSheetQueue = api;
  }
})(typeof self !== 'undefined' ? self : this);
