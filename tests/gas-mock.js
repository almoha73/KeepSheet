// Faux environnement Google Apps Script (Sheets en mémoire) pour tester Code.gs avec Node.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

function makeSheet(rows) {
  return {
    rows,
    getLastRow() { return this.rows.length; },
    getLastColumn() { return this.rows[0] ? this.rows[0].length : 0; },
    getRange(r, c, nr = 1, nc = 1) {
      const sh = this;
      return {
        getValues() {
          const out = [];
          for (let i = 0; i < nr; i++) {
            const row = [];
            for (let j = 0; j < nc; j++) row.push(((sh.rows[r - 1 + i] || [])[c - 1 + j]) ?? '');
            out.push(row);
          }
          return out;
        },
        setValues(v) {
          v.forEach((row, i) => row.forEach((x, j) => {
            sh.rows[r - 1 + i] = sh.rows[r - 1 + i] || [];
            // Émule Google Sheets : un préfixe ' force le texte et est retiré à la lecture
            sh.rows[r - 1 + i][c - 1 + j] = typeof x === 'string' && x.startsWith("'") ? x.slice(1) : x;
          }));
          return this;
        },
        setValue(x) {
          sh.rows[r - 1] = sh.rows[r - 1] || [];
          sh.rows[r - 1][c - 1] = typeof x === 'string' && x.startsWith("'") ? x.slice(1) : x;
          return this;
        },
        setFontWeight() { return this; },
        setBackground() { return this; },
        setNumberFormat() { return this; },
      };
    },
    appendRow(v) { this.rows.push(v); },
    deleteRow(i) { this.rows.splice(i - 1, 1); },
    setFrozenRows() {},
    autoResizeColumns() {},
  };
}

function loadBackend() {
  const sheets = {
    Config: makeSheet([
      ['Clé', 'Valeur', 'Description'],
      ['API_TOKEN', 'secret', ''],
      ['TELEGRAM_BOT_TOKEN', 'bot', ''],
      ['TELEGRAM_CHAT_ID', '42', ''],
    ]),
  };
  const telegram = [];
  const ctx = {
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (n) => sheets[n],
        insertSheet: (n) => (sheets[n] = makeSheet([])),
      }),
      getUi: () => ({ alert() {} }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) },
    UrlFetchApp: {
      fetch: (url, opts) => {
        telegram.push({ url, payload: JSON.parse(opts.payload) });
        return { getResponseCode: () => 200, getContentText: () => '' };
      },
    },
    ContentService: {
      createTextOutput: (t) => ({ setMimeType: () => JSON.parse(t) }),
      MimeType: { JSON: 'json' },
    },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      computeDigest: (_alg, str) =>
        Array.from(crypto.createHash('sha256').update(str).digest()).map((b) => (b > 127 ? b - 256 : b)),
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
    },
  };
  vm.createContext(ctx);
  const code = fs.readFileSync(path.join(__dirname, '..', 'google-apps-script', 'Code.gs'), 'utf8');
  vm.runInContext(code, ctx);

  const post = (body, params = {}) =>
    ctx.doPost({ parameter: params, postData: { contents: JSON.stringify(body) } });
  const api = (action, payload = {}) => post({ action, token: 'secret', payload });
  return { ctx, sheets, telegram, post, api };
}

module.exports = { loadBackend };
