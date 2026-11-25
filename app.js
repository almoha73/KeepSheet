(() => {
  'use strict';

  const STORAGE_KEY = 'keepsheet_data_v1';
  const SETTINGS_KEY = 'keepsheet_settings_v1';
  const THEME_KEY = 'keepsheet_theme_v1';

  const state = {
    notes: [],
    todos: [],
    currentView: 'notes',
    todoFilter: 'all',
    searchQuery: '',
    settings: {
      apiUrl: '',
      apiToken: '',
    },
    editingNote: {
      color: 'default',
      pinned: false,
      archived: false,
    },
    deferredInstallPrompt: null,
    isSyncing: false,
  };

  // DOM helpers
  const $ = (id) => document.getElementById(id);

  // ---------- INIT ----------
  function init() {
    loadSettings();
    loadLocalData();
    initTheme();
    bindEvents();
    registerServiceWorker();
    renderAll();

    if (state.settings.apiUrl) {
      syncFromSheet({ silent: true });
    } else {
      updateConnectionBanner();
    }
  }

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      state.settings.apiUrl = (saved.apiUrl || '').trim();
      state.settings.apiToken = (saved.apiToken || '').trim();
    } catch {
      state.settings = { apiUrl: '', apiToken: '' };
    }
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  }

  function loadLocalData() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved && Array.isArray(saved.notes) && Array.isArray(saved.todos)) {
        state.notes = saved.notes;
        state.todos = saved.todos;
        return;
      }
    } catch {
      // ignore corrupted storage
    }

    // Starter demo items so the user can test immediately
    const now = new Date().toISOString();
    state.notes = [
      {
        id: createId('note'),
        title: 'Bienvenue dans KeepSheet 📌',
        content:
          'Vos notes colorées et votre Todo List peuvent se synchroniser avec Google Sheets.\n\nOuvrez ⚙️ Paramètres pour coller l’URL de votre Google Apps Script et activer les notifications Telegram !',
        color: 'sand',
        pinned: true,
        archived: false,
        reminderAt: '',
        notified: false,
        updatedAt: now,
      },
    ];
    state.todos = [
      {
        id: createId('todo'),
        title: 'Configurer Google Sheets & le Bot Telegram',
        notes: 'Suivre le guide étape par étape dans README.md',
        done: false,
        priority: 'high',
        reminderAt: '',
        notified: false,
        updatedAt: now,
      },
    ];
    saveLocalData();
  }

  function saveLocalData() {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ notes: state.notes, todos: state.todos })
    );
  }

  function createId(prefix) {
    if (window.crypto && crypto.randomUUID) {
      return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
    }
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  }

  // ---------- THEME ----------
  function initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    const prefersDark =
      window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(saved || (prefersDark ? 'dark' : 'light'));
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
    $('theme-icon').textContent = theme === 'dark' ? '☀️' : '🌙';
    const meta = $('theme-color-meta');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#232529' : '#f59e0b');
  }

  // ---------- EVENTS ----------
  function bindEvents() {
    // Navigation tabs
    document.querySelectorAll('.nav-tab').forEach((tab) => {
      tab.addEventListener('click', () => switchView(tab.dataset.view));
    });

    // Search
    const searchInput = $('search-input');
    const searchClear = $('search-clear');
    searchInput.addEventListener('input', () => {
      state.searchQuery = searchInput.value.trim().toLowerCase();
      searchClear.classList.toggle('hidden', !state.searchQuery);
      renderAll();
    });
    searchClear.addEventListener('click', () => {
      searchInput.value = '';
      state.searchQuery = '';
      searchClear.classList.add('hidden');
      renderAll();
      searchInput.focus();
    });

    // Header actions
    $('btn-theme').addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      applyTheme(current === 'dark' ? 'light' : 'dark');
    });
    $('btn-sync').addEventListener('click', () => syncFromSheet({ silent: false }));
    $('btn-settings').addEventListener('click', openSettingsDialog);

    // Quick create & FAB
    const quickTrigger = $('quick-note-trigger');
    quickTrigger.addEventListener('click', () => openNoteDialog(null));
    quickTrigger.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openNoteDialog(null);
      }
    });

    $('fab-add').addEventListener('click', () => {
      if (state.currentView === 'todos') {
        openTodoDialog(null);
      } else {
        openNoteDialog(null);
      }
    });

    // Quick Todo form
    $('quick-todo-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const titleInput = $('quick-todo-title');
      const title = titleInput.value.trim();
      if (!title) return;

      const todo = {
        id: createId('todo'),
        title,
        notes: '',
        done: false,
        priority: $('quick-todo-priority').value,
        reminderAt: $('quick-todo-reminder').value || '',
        notified: false,
        updatedAt: new Date().toISOString(),
      };

      state.todos.unshift(todo);
      saveLocalData();
      renderTodos();
      updateBadges();

      titleInput.value = '';
      $('quick-todo-priority').value = 'normal';
      $('quick-todo-reminder').value = '';
      showToast('Tâche ajoutée');
      pushAction('saveTodo', todo);
    });

    // Todo filters
    document.querySelectorAll('.pill[data-filter]').forEach((pill) => {
      pill.addEventListener('click', () => {
        state.todoFilter = pill.dataset.filter;
        document.querySelectorAll('.pill[data-filter]').forEach((p) => {
          p.classList.toggle('active', p === pill);
        });
        renderTodos();
      });
    });

    // Close modal buttons & backdrop click
    document.querySelectorAll('.close-dialog').forEach((btn) => {
      btn.addEventListener('click', () => {
        const dlg = $(btn.dataset.close);
        if (dlg && dlg.open) dlg.close();
      });
    });

    ['note-dialog', 'todo-dialog', 'settings-dialog'].forEach((id) => {
      const dlg = $(id);
      dlg.addEventListener('click', (e) => {
        if (e.target === dlg) dlg.close();
      });
    });

    // Note dialog controls
    $('note-pin-btn').addEventListener('click', () => {
      state.editingNote.pinned = !state.editingNote.pinned;
      $('note-pin-btn').setAttribute('aria-pressed', String(state.editingNote.pinned));
    });

    $('note-archive-btn').addEventListener('click', () => {
      state.editingNote.archived = !state.editingNote.archived;
      $('note-archive-btn').setAttribute('aria-pressed', String(state.editingNote.archived));
    });

    $('note-color-picker').addEventListener('click', (e) => {
      const swatch = e.target.closest('.color-swatch');
      if (!swatch) return;
      selectNoteColor(swatch.dataset.color);
    });

    $('note-clear-reminder').addEventListener('click', () => {
      $('note-reminder').value = '';
    });

    $('note-form').addEventListener('submit', (e) => {
      e.preventDefault();
      saveNoteFromDialog();
    });

    $('note-delete-btn').addEventListener('click', () => {
      const id = $('note-id').value;
      if (!id) return;
      if (!confirm('Supprimer définitivement cette note ?')) return;
      state.notes = state.notes.filter((n) => n.id !== id);
      saveLocalData();
      $('note-dialog').close();
      renderAll();
      showToast('Note supprimée');
      pushAction('deleteNote', { id });
    });

    $('note-telegram-btn').addEventListener('click', () => {
      const title = $('note-title').value.trim() || 'Note sans titre';
      const content = $('note-content').value.trim();
      const reminderAt = $('note-reminder').value;
      sendTelegramItem('note', { title, content, reminderAt });
    });

    // Todo dialog controls
    $('todo-form').addEventListener('submit', (e) => {
      e.preventDefault();
      saveTodoFromDialog();
    });

    $('todo-delete-btn').addEventListener('click', () => {
      const id = $('todo-id').value;
      if (!id) return;
      if (!confirm('Supprimer cette tâche ?')) return;
      state.todos = state.todos.filter((t) => t.id !== id);
      saveLocalData();
      $('todo-dialog').close();
      renderAll();
      showToast('Tâche supprimée');
      pushAction('deleteTodo', { id });
    });

    $('todo-telegram-btn').addEventListener('click', () => {
      const title = $('todo-title').value.trim() || 'Tâche';
      const notes = $('todo-notes').value.trim();
      const priority = $('todo-priority').value;
      const reminderAt = $('todo-reminder').value;
      sendTelegramItem('todo', { title, notes, priority, reminderAt });
    });

    // Settings dialog controls
    $('settings-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const apiUrl = $('setting-api-url').value.trim();
      const apiToken = $('setting-api-token').value.trim();

      const urlError = validateApiUrl(apiUrl);
      if (urlError) {
        setSettingsFeedback(urlError, 'error');
        return;
      }

      state.settings.apiUrl = apiUrl;
      state.settings.apiToken = apiToken;
      saveSettings();
      updateConnectionBanner();

      if (state.settings.apiUrl) {
        setSettingsFeedback('Synchronisation en cours...', 'info');
        const ok = await syncFromSheet({ silent: false });
        if (ok) {
          setSettingsFeedback('Connexion Google Sheets réussie ✅', 'success');
          $('settings-dialog').close();
        }
      } else {
        $('settings-dialog').close();
        showToast('Mode local activé');
      }
    });

    $('btn-test-telegram').addEventListener('click', async () => {
      if (!syncSettingsInputsBeforeTest()) return;
      setSettingsFeedback('Envoi du message test Telegram...', 'info');
      const res = await callApi('sendTelegramTest', {});
      if (res && res.ok) {
        setSettingsFeedback('Message test envoyé sur Telegram ✅', 'success');
        showToast('Message test envoyé sur Telegram ✅');
      }
    });

    $('btn-daily-summary').addEventListener('click', async () => {
      if (!syncSettingsInputsBeforeTest()) return;
      setSettingsFeedback('Envoi du résumé du jour...', 'info');
      const res = await callApi('sendDailySummary', {});
      if (res && res.ok) {
        setSettingsFeedback('Résumé du jour envoyé sur Telegram 📅', 'success');
        showToast('Résumé du jour envoyé sur Telegram 📅');
      }
    });

    $('btn-push-local').addEventListener('click', async () => {
      if (!syncSettingsInputsBeforeTest()) return;
      setSettingsFeedback('Envoi des données locales vers Google Sheets...', 'info');
      const res = await callApi('syncAll', {
        notes: state.notes,
        todos: state.todos,
      });
      if (res && res.ok) {
        setSettingsFeedback('Données locales envoyées vers Google Sheets ⬆️', 'success');
        showToast('Données locales envoyées vers Google Sheets ⬆️');
      }
    });

    $('btn-export-json').addEventListener('click', exportBackupJson);

    // PWA Install Prompt (Android Chrome)
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      state.deferredInstallPrompt = e;
      $('pwa-install-box').classList.remove('hidden');
    });

    $('btn-install-pwa').addEventListener('click', async () => {
      if (!state.deferredInstallPrompt) return;
      state.deferredInstallPrompt.prompt();
      await state.deferredInstallPrompt.userChoice;
      state.deferredInstallPrompt = null;
      $('pwa-install-box').classList.add('hidden');
    });

    window.addEventListener('online', () => {
      updateConnectionBanner();
      if (state.settings.apiUrl) syncFromSheet({ silent: true });
    });
    window.addEventListener('offline', updateConnectionBanner);
  }

  // ---------- NAVIGATION ----------
  function switchView(view) {
    state.currentView = view;
    document.querySelectorAll('.nav-tab').forEach((tab) => {
      const active = tab.dataset.view === view;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-current', active ? 'page' : 'false');
    });
    document.querySelectorAll('.view').forEach((sec) => {
      sec.classList.toggle('hidden', sec.id !== `view-${view}`);
      sec.classList.toggle('active', sec.id === `view-${view}`);
    });
  }

  // ---------- RENDERING ----------
  function renderAll() {
    renderNotes();
    renderTodos();
    renderArchives();
    updateBadges();
  }

  function updateBadges() {
    const activeNotes = state.notes.filter((n) => !n.archived).length;
    const archivedNotes = state.notes.filter((n) => n.archived).length;
    const pendingTodos = state.todos.filter((t) => !t.done).length;

    $('badge-notes').textContent = String(activeNotes);
    $('badge-todos').textContent = String(pendingTodos);
    $('badge-archives').textContent = String(archivedNotes);
  }

  function matchesSearch(text) {
    if (!state.searchQuery) return true;
    return (text || '').toLowerCase().includes(state.searchQuery);
  }

  function renderNotes() {
    const activeNotes = state.notes
      .filter((n) => !n.archived && matchesSearch(`${n.title} ${n.content}`))
      .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));

    const pinned = activeNotes.filter((n) => n.pinned);
    const others = activeNotes.filter((n) => !n.pinned);

    const pinnedSection = $('pinned-section');
    const pinnedGrid = $('pinned-notes-grid');
    const othersLabel = $('others-label');
    const notesGrid = $('notes-grid');

    pinnedGrid.innerHTML = '';
    notesGrid.innerHTML = '';

    pinned.forEach((n) => pinnedGrid.appendChild(createNoteCard(n)));
    others.forEach((n) => notesGrid.appendChild(createNoteCard(n)));

    pinnedSection.classList.toggle('hidden', pinned.length === 0);
    othersLabel.classList.toggle('hidden', pinned.length === 0 || others.length === 0);
    $('notes-empty').classList.toggle('hidden', activeNotes.length > 0);
  }

  function renderArchives() {
    const archived = state.notes
      .filter((n) => n.archived && matchesSearch(`${n.title} ${n.content}`))
      .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));

    const grid = $('archives-grid');
    grid.innerHTML = '';
    archived.forEach((n) => grid.appendChild(createNoteCard(n)));
    $('archives-empty').classList.toggle('hidden', archived.length > 0);
  }

  function createNoteCard(note) {
    const card = document.createElement('article');
    card.className = 'note-card';
    card.dataset.color = note.color || 'default';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', note.title || 'Note sans titre');

    const header = document.createElement('div');
    header.className = 'note-card-header';

    if (note.title) {
      const h3 = document.createElement('h3');
      h3.className = 'note-card-title';
      h3.textContent = note.title;
      header.appendChild(h3);
    }

    const pinBtn = document.createElement('button');
    pinBtn.type = 'button';
    pinBtn.className = 'icon-btn small';
    pinBtn.title = note.pinned ? 'Désépingler' : 'Épingler';
    pinBtn.textContent = note.pinned ? '📌' : '📍';
    pinBtn.style.opacity = note.pinned ? '1' : '0.45';
    pinBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      note.pinned = !note.pinned;
      note.updatedAt = new Date().toISOString();
      saveLocalData();
      renderAll();
      pushAction('saveNote', note);
    });
    header.appendChild(pinBtn);
    card.appendChild(header);

    if (note.content) {
      const p = document.createElement('p');
      p.className = 'note-card-body';
      p.textContent = note.content;
      card.appendChild(p);
    }

    const footer = document.createElement('div');
    footer.className = 'note-card-footer';

    if (note.reminderAt) {
      footer.appendChild(createReminderChip(note.reminderAt, note.notified));
    }

    const actions = document.createElement('div');
    actions.className = 'note-quick-actions';

    const archBtn = document.createElement('button');
    archBtn.type = 'button';
    archBtn.className = 'icon-btn small';
    archBtn.title = note.archived ? 'Désarchiver' : 'Archiver';
    archBtn.textContent = note.archived ? '📤' : '📦';
    archBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      note.archived = !note.archived;
      if (note.archived) note.pinned = false;
      note.updatedAt = new Date().toISOString();
      saveLocalData();
      renderAll();
      showToast(note.archived ? 'Note archivée' : 'Note restaurée');
      pushAction('saveNote', note);
    });
    actions.appendChild(archBtn);

    footer.appendChild(actions);
    card.appendChild(footer);

    card.addEventListener('click', () => openNoteDialog(note));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openNoteDialog(note);
      }
    });
    return card;
  }

  function renderTodos() {
    const priorityRank = { high: 0, normal: 1, low: 2 };

    const total = state.todos.length;
    const doneCount = state.todos.filter((t) => t.done).length;
    const pct = total ? Math.round((doneCount / total) * 100) : 0;
    $('todo-progress-text').textContent = `${doneCount} / ${total} terminées`;
    $('todo-progress-fill').style.width = `${pct}%`;

    const filtered = state.todos
      .filter((t) => {
        if (!matchesSearch(`${t.title} ${t.notes}`)) return false;
        if (state.todoFilter === 'active') return !t.done;
        if (state.todoFilter === 'done') return t.done;
        if (state.todoFilter === 'high') return !t.done && t.priority === 'high';
        return true;
      })
      .sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        const pa = priorityRank[a.priority] ?? 1;
        const pb = priorityRank[b.priority] ?? 1;
        if (pa !== pb) return pa - pb;
        if (a.reminderAt && b.reminderAt) {
          return new Date(a.reminderAt) - new Date(b.reminderAt);
        }
        if (a.reminderAt) return -1;
        if (b.reminderAt) return 1;
        return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
      });

    const list = $('todos-list');
    list.innerHTML = '';

    filtered.forEach((todo) => {
      const row = document.createElement('div');
      row.className = `todo-item${todo.done ? ' done' : ''}`;

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'todo-checkbox';
      checkbox.checked = Boolean(todo.done);
      checkbox.setAttribute('aria-label', `Marquer "${todo.title}" comme terminée`);
      checkbox.addEventListener('change', () => {
        todo.done = checkbox.checked;
        todo.updatedAt = new Date().toISOString();
        saveLocalData();
        renderTodos();
        updateBadges();
        pushAction('saveTodo', todo);
      });

      const content = document.createElement('div');
      content.className = 'todo-content';
      content.addEventListener('click', () => openTodoDialog(todo));

      const titleEl = document.createElement('p');
      titleEl.className = 'todo-title';
      titleEl.textContent = todo.title;
      content.appendChild(titleEl);

      if (todo.notes) {
        const notesEl = document.createElement('p');
        notesEl.className = 'todo-notes-preview';
        notesEl.textContent = todo.notes;
        content.appendChild(notesEl);
      }

      const meta = document.createElement('div');
      meta.className = 'todo-meta';

      if (todo.priority === 'high') {
        const chip = document.createElement('span');
        chip.className = 'chip priority-high';
        chip.textContent = '🔥 Haute';
        meta.appendChild(chip);
      } else if (todo.priority === 'low') {
        const chip = document.createElement('span');
        chip.className = 'chip priority-low';
        chip.textContent = 'Basse';
        meta.appendChild(chip);
      }

      if (todo.reminderAt) {
        meta.appendChild(createReminderChip(todo.reminderAt, todo.notified, todo.done));
      }

      if (meta.childElementCount > 0) content.appendChild(meta);

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'icon-btn small';
      editBtn.title = 'Modifier';
      editBtn.textContent = '✏️';
      editBtn.addEventListener('click', () => openTodoDialog(todo));

      row.appendChild(checkbox);
      row.appendChild(content);
      row.appendChild(editBtn);
      list.appendChild(row);
    });

    $('todos-empty').classList.toggle('hidden', filtered.length > 0);
  }

  function createReminderChip(reminderAt, notified, done = false) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    const d = new Date(reminderAt);
    const valid = !Number.isNaN(d.getTime());
    const isOverdue = valid && !done && !notified && d.getTime() < Date.now();
    if (isOverdue) chip.classList.add('overdue');
    if (notified) chip.classList.add('notified');

    const formatted = valid
      ? d.toLocaleString('fr-FR', {
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })
      : reminderAt;
    chip.textContent = `${notified ? '✈️' : '🔔'} ${formatted}`;
    return chip;
  }

  // ---------- DIALOGS ----------
  function openNoteDialog(note) {
    const isEdit = Boolean(note);
    $('note-dialog-title').textContent = isEdit ? 'Modifier la note' : 'Nouvelle note';
    $('note-id').value = isEdit ? note.id : '';
    $('note-title').value = isEdit ? note.title || '' : '';
    $('note-content').value = isEdit ? note.content || '' : '';
    $('note-reminder').value = isEdit ? toDatetimeLocal(note.reminderAt) : '';

    state.editingNote = {
      color: isEdit ? note.color || 'default' : 'default',
      pinned: isEdit ? Boolean(note.pinned) : false,
      archived: isEdit ? Boolean(note.archived) : false,
    };

    selectNoteColor(state.editingNote.color);
    $('note-pin-btn').setAttribute('aria-pressed', String(state.editingNote.pinned));
    $('note-archive-btn').setAttribute('aria-pressed', String(state.editingNote.archived));
    $('note-delete-btn').classList.toggle('hidden', !isEdit);

    $('note-dialog').showModal();
    $('note-title').focus();
  }

  function selectNoteColor(color) {
    state.editingNote.color = color || 'default';
    document.querySelectorAll('#note-color-picker .color-swatch').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.color === state.editingNote.color);
    });
  }

  function saveNoteFromDialog() {
    const id = $('note-id').value;
    const title = $('note-title').value.trim();
    const content = $('note-content').value.trim();
    const reminderAt = $('note-reminder').value || '';

    if (!title && !content) {
      $('note-dialog').close();
      return;
    }

    const now = new Date().toISOString();
    let note;

    if (id) {
      note = state.notes.find((n) => n.id === id);
      if (note) {
        const reminderChanged = toDatetimeLocal(note.reminderAt) !== reminderAt;
        note.title = title;
        note.content = content;
        note.color = state.editingNote.color;
        note.pinned = state.editingNote.archived ? false : state.editingNote.pinned;
        note.archived = state.editingNote.archived;
        note.reminderAt = reminderAt;
        if (reminderChanged) note.notified = false;
        note.updatedAt = now;
      }
    }

    if (!note) {
      note = {
        id: createId('note'),
        title,
        content,
        color: state.editingNote.color,
        pinned: state.editingNote.archived ? false : state.editingNote.pinned,
        archived: state.editingNote.archived,
        reminderAt,
        notified: false,
        updatedAt: now,
      };
      state.notes.unshift(note);
    }

    saveLocalData();
    $('note-dialog').close();
    renderAll();
    showToast(id ? 'Note mise à jour' : 'Note enregistrée');
    pushAction('saveNote', note);
  }

  function openTodoDialog(todo) {
    const isEdit = Boolean(todo);
    $('todo-dialog-title').textContent = isEdit ? 'Modifier la tâche' : 'Nouvelle tâche';
    $('todo-id').value = isEdit ? todo.id : '';
    $('todo-title').value = isEdit ? todo.title || '' : '';
    $('todo-notes').value = isEdit ? todo.notes || '' : '';
    $('todo-priority').value = isEdit ? todo.priority || 'normal' : 'normal';
    $('todo-reminder').value = isEdit ? toDatetimeLocal(todo.reminderAt) : '';
    $('todo-delete-btn').classList.toggle('hidden', !isEdit);

    $('todo-dialog').showModal();
    $('todo-title').focus();
  }

  function saveTodoFromDialog() {
    const id = $('todo-id').value;
    const title = $('todo-title').value.trim();
    if (!title) return;

    const notes = $('todo-notes').value.trim();
    const priority = $('todo-priority').value;
    const reminderAt = $('todo-reminder').value || '';
    const now = new Date().toISOString();

    let todo;
    if (id) {
      todo = state.todos.find((t) => t.id === id);
      if (todo) {
        const reminderChanged = toDatetimeLocal(todo.reminderAt) !== reminderAt;
        todo.title = title;
        todo.notes = notes;
        todo.priority = priority;
        todo.reminderAt = reminderAt;
        if (reminderChanged) todo.notified = false;
        todo.updatedAt = now;
      }
    }

    if (!todo) {
      todo = {
        id: createId('todo'),
        title,
        notes,
        done: false,
        priority,
        reminderAt,
        notified: false,
        updatedAt: now,
      };
      state.todos.unshift(todo);
    }

    saveLocalData();
    $('todo-dialog').close();
    renderAll();
    showToast(id ? 'Tâche mise à jour' : 'Tâche ajoutée');
    pushAction('saveTodo', todo);
  }

  function openSettingsDialog() {
    $('setting-api-url').value = state.settings.apiUrl;
    $('setting-api-token').value = state.settings.apiToken;
    setSettingsFeedback('', 'hidden');
    const status = $('settings-connection-status');
    if (state.settings.apiUrl) {
      status.textContent = '✅ Connecté à Google Sheets (Apps Script configuré)';
      status.classList.add('connected');
    } else {
      status.textContent = 'ℹ️ Mode local uniquement (collez l’URL Google Apps Script ci-dessous)';
      status.classList.remove('connected');
    }
    $('settings-dialog').showModal();
  }

  function setSettingsFeedback(message, type = 'info') {
    const box = $('settings-feedback');
    if (!box) return;
    if (!message || type === 'hidden') {
      box.textContent = '';
      box.className = 'settings-feedback hidden';
      return;
    }
    box.textContent = message;
    box.className = `settings-feedback ${type}`;
  }

  function validateApiUrl(url) {
    if (!url) return '';
    if (url.includes('docs.google.com/spreadsheets')) {
      return 'Mauvais lien : vous avez collé l’URL du tableur Google Sheets. Il faut coller l’URL de l’Application Web Apps Script (https://script.google.com/macros/s/.../exec).';
    }
    if (!url.startsWith('https://script.google.com/macros/s/') || !url.endsWith('/exec')) {
      return 'URL invalide : elle doit commencer par https://script.google.com/macros/s/ et se terminer par /exec.';
    }
    return '';
  }

  function syncSettingsInputsBeforeTest() {
    const apiUrl = $('setting-api-url').value.trim();
    const apiToken = $('setting-api-token').value.trim();
    const urlError = validateApiUrl(apiUrl);
    if (urlError) {
      setSettingsFeedback(urlError, 'error');
      return false;
    }
    state.settings.apiUrl = apiUrl;
    state.settings.apiToken = apiToken;
    saveSettings();
    return true;
  }

  function toDatetimeLocal(value) {
    if (!value) return '';
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return value.slice(0, 16);
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // ---------- GOOGLE SHEETS & TELEGRAM API ----------
  function updateConnectionBanner() {
    const banner = $('status-banner');
    if (!navigator.onLine) {
      banner.textContent = '📡 Hors ligne — vos modifications sont enregistrées localement.';
      banner.classList.remove('hidden');
      return;
    }
    if (!state.settings.apiUrl) {
      banner.textContent =
        'Mode local actif — cliquez sur ⚙️ pour relier votre Google Sheet et activer Telegram.';
      banner.classList.remove('hidden');
      return;
    }
    banner.classList.add('hidden');
  }

  function setSyncing(active) {
    state.isSyncing = active;
    const icon = document.querySelector('#btn-sync .sync-icon');
    if (icon) icon.classList.toggle('spinning', active);
  }

  async function parseJsonResponse(res) {
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      if (text.trim().startsWith('<')) {
        throw new Error(
          'Google a renvoyé une page HTML au lieu de JSON. Vérifiez dans Apps Script que « Qui a accès » est bien sur « Tout le monde » et que l’URL finit par /exec.'
        );
      }
      throw new Error(`Réponse invalide (${res.status}) : ${text.slice(0, 120)}`);
    }
  }

  async function syncFromSheet({ silent = false } = {}) {
    if (!state.settings.apiUrl) {
      if (!silent) showToast('Configurez d’abord l’URL Google Apps Script dans ⚙️', 'error');
      return false;
    }
    if (!navigator.onLine) {
      if (!silent) showToast('Impossible de synchroniser hors ligne', 'error');
      return false;
    }

    setSyncing(true);
    try {
      const url = new URL(state.settings.apiUrl);
      url.searchParams.set('action', 'getAll');
      if (state.settings.apiToken) {
        url.searchParams.set('token', state.settings.apiToken);
      }

      const res = await fetch(url.toString(), { method: 'GET', redirect: 'follow' });
      const data = await parseJsonResponse(res);
      if (!data.ok) throw new Error(data.error || 'Erreur API Google Sheets');

      state.notes = Array.isArray(data.notes) ? data.notes : [];
      state.todos = Array.isArray(data.todos) ? data.todos : [];
      saveLocalData();
      renderAll();
      updateConnectionBanner();
      if (!silent) showToast('Synchronisé avec Google Sheets ✅');
      return true;
    } catch (err) {
      console.error(err);
      const msg = `Erreur de synchro : ${err.message}`;
      setSettingsFeedback(msg, 'error');
      if (!silent) showToast(msg, 'error');
      return false;
    } finally {
      setSyncing(false);
    }
  }

  async function callApi(action, payload) {
    if (!state.settings.apiUrl) {
      const msg = 'Configurez l’URL Google Apps Script dans ⚙️ d’abord';
      setSettingsFeedback(msg, 'error');
      showToast(msg, 'error');
      return null;
    }
    if (!navigator.onLine) {
      showToast('Hors ligne — réessayez avec une connexion', 'error');
      return null;
    }

    setSyncing(true);
    try {
      // text/plain avoids CORS preflight with Google Apps Script Web Apps
      const res = await fetch(state.settings.apiUrl, {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action,
          token: state.settings.apiToken,
          payload,
        }),
      });
      const data = await parseJsonResponse(res);
      if (!data.ok) throw new Error(data.error || 'Erreur serveur');
      return data;
    } catch (err) {
      console.error(err);
      const msg = `Erreur : ${err.message}`;
      setSettingsFeedback(msg, 'error');
      showToast(msg, 'error');
      return null;
    } finally {
      setSyncing(false);
    }
  }

  function pushAction(action, payload) {
    if (!state.settings.apiUrl || !navigator.onLine) return;
    callApi(action, payload);
  }

  async function sendTelegramItem(type, item) {
    const res = await callApi('sendTelegramItem', { type, item });
    if (res && res.ok) showToast('Envoyé sur Telegram ✈️');
  }

  function exportBackupJson() {
    const blob = new Blob(
      [JSON.stringify({ exportedAt: new Date().toISOString(), notes: state.notes, todos: state.todos }, null, 2)],
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `keepsheet-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Sauvegarde JSON téléchargée');
  }

  // ---------- TOAST & SERVICE WORKER ----------
  function showToast(message, type = 'info') {
    const container = $('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast${type === 'error' ? ' error' : ''}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), type === 'error' ? 6000 : 2800);
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('./sw.js').catch((err) => {
        console.warn('Service worker registration failed:', err);
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
