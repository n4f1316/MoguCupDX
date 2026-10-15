// デモ用：Cloudflare D1 の代わりに、ブラウザの中だけで動く小さなデータベース
// worker.js が使う SQL 文だけを受け付ける（それ以外はエラーにする）
const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const lc = (s) => String(s ?? '').toLowerCase();
const uniqueErr = () => new Error('D1_ERROR: UNIQUE constraint failed');
const norm = (sql) => sql.replace(/\s+/g, ' ').trim();

export function emptyData() {
  return { seq: { entries: 0, users: 0 }, entries: [], users: [], sessions: [], login_fails: [], picks: [], kv: [] };
}

export function makeDB(data, onWrite) {
  const T = data;
  const one = (rows) => rows[0] ?? null;
  const byUser = (id) => T.users.find((u) => u.id === id);

  // [SQL 文, 処理] の組。処理は (引数) => { rows?, meta? }
  const H = {
    'SELECT * FROM users WHERE username=?': ([u]) => ({ rows: T.users.filter((x) => x.username === u) }),
    'SELECT 1 FROM users WHERE username=?': ([u]) => ({ rows: T.users.filter((x) => x.username === u).map(() => ({ 1: 1 })) }),
    "INSERT INTO users (username, source) VALUES (?, '2frate') ON CONFLICT(username) DO NOTHING": ([u]) => {
      if (!T.users.some((x) => x.username === u)) T.users.push({ id: ++T.seq.users, username: u, source: '2frate', pin_hash: null, pin_salt: null, created_at: now() });
      return { write: true };
    },
    "INSERT INTO users (username, source, pin_hash, pin_salt) VALUES (?, 'local', ?, ?)": ([u, h, s]) => {
      if (T.users.some((x) => x.username === u)) throw uniqueErr();
      T.users.push({ id: ++T.seq.users, username: u, source: 'local', pin_hash: h, pin_salt: s, created_at: now() });
      return { write: true, meta: { last_row_id: T.seq.users } };
    },
    'UPDATE users SET profile=? WHERE username=?': ([p, u]) => { const x = T.users.find((y) => y.username === u); if (x) x.profile = p; return { write: true }; },
    'UPDATE users SET pin_hash=?, pin_salt=? WHERE id=?': ([h, s, id]) => { const u = byUser(id); if (u) Object.assign(u, { pin_hash: h, pin_salt: s }); return { write: true }; },

    'SELECT fails, locked_until FROM login_fails WHERE username=?': ([u]) => ({ rows: T.login_fails.filter((x) => x.username === u) }),
    'SELECT fails FROM login_fails WHERE username=?': ([u]) => ({ rows: T.login_fails.filter((x) => x.username === u) }),
    'INSERT INTO login_fails (username, fails, locked_until) VALUES (?, ?, ?) ON CONFLICT(username) DO UPDATE SET fails=excluded.fails, locked_until=excluded.locked_until': ([u, f, l]) => {
      const r = T.login_fails.find((x) => x.username === u);
      if (r) Object.assign(r, { fails: f, locked_until: l }); else T.login_fails.push({ username: u, fails: f, locked_until: l });
      return { write: true };
    },
    'DELETE FROM login_fails WHERE username=?': ([u]) => { T.login_fails = T.login_fails.filter((x) => x.username !== u); return { write: true }; },

    'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)': ([t, id, e]) => { T.sessions.push({ token_hash: t, user_id: id, expires_at: e }); return { write: true }; },
    'DELETE FROM sessions WHERE expires_at < ?': ([n]) => { T.sessions = T.sessions.filter((x) => x.expires_at >= n); return { write: true }; },
    'DELETE FROM sessions WHERE token_hash=?': ([t]) => { T.sessions = T.sessions.filter((x) => x.token_hash !== t); return { write: true }; },
    'DELETE FROM sessions WHERE user_id=?': ([id]) => { T.sessions = T.sessions.filter((x) => x.user_id !== id); return { write: true }; },
    'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash=? AND s.expires_at > ?': ([t, n]) => ({
      rows: T.sessions.filter((s) => s.token_hash === t && s.expires_at > n).map((s) => byUser(s.user_id)).filter(Boolean),
    }),

    'SELECT COUNT(*) AS n FROM entries': () => ({ rows: [{ n: T.entries.length }] }),
    'SELECT 1 FROM entries WHERE user_id=?': ([id]) => ({ rows: T.entries.filter((e) => e.user_id === id).map(() => ({ 1: 1 })) }),
    'SELECT * FROM entries WHERE user_id=?': ([id]) => ({ rows: T.entries.filter((e) => e.user_id === id) }),
    'SELECT id, entry_name, x_id FROM entries WHERE id=?': ([id]) => ({ rows: T.entries.filter((e) => e.id === id).map(({ id: i, entry_name, x_id }) => ({ id: i, entry_name, x_id })) }),
    'SELECT answers FROM entries WHERE id=?': ([id]) => ({ rows: T.entries.filter((e) => e.id === id).map((e) => ({ answers: e.answers })) }),
    'SELECT e.*, u.username, u.source FROM entries e LEFT JOIN users u ON u.id = e.user_id ORDER BY e.id': () => ({
      rows: [...T.entries].sort((a, b) => a.id - b.id).map((e) => ({ ...e, username: byUser(e.user_id)?.username ?? null, source: byUser(e.user_id)?.source ?? null })),
    }),
    'INSERT INTO entries (entry_name, x_id, rating, frate, user_id, answers) VALUES (?, ?, ?, ?, ?, ?)': ([n, x, r, f, uid, a]) => {
      if (T.entries.some((e) => lc(e.entry_name) === lc(n) || lc(e.x_id) === lc(x) || (uid != null && e.user_id === uid))) throw uniqueErr();
      T.entries.push({ id: ++T.seq.entries, entry_name: n, x_id: x, rating: r, frate: f, memo: '', created_at: now(), user_id: uid, answers: a });
      return { write: true, meta: { last_row_id: T.seq.entries } };
    },
    'UPDATE entries SET entry_name=?, x_id=?, rating=?, frate=?, memo=?, answers=? WHERE id=?': ([n, x, r, f, m, a, id]) => {
      if (T.entries.some((e) => e.id !== id && (lc(e.entry_name) === lc(n) || lc(e.x_id) === lc(x)))) throw uniqueErr();
      const e = T.entries.find((y) => y.id === id);
      if (e) Object.assign(e, { entry_name: n, x_id: x, rating: r, frate: f, memo: m, answers: a });
      return { write: true };
    },
    'DELETE FROM entries WHERE id=?': ([id]) => { T.entries = T.entries.filter((e) => e.id !== id); return { write: true }; },

    'SELECT * FROM picks': () => ({ rows: T.picks.map((p) => ({ ...p })) }),
    'SELECT songs, ban, pick FROM picks WHERE match_id=? AND entry_id=?': ([m, e]) => ({ rows: T.picks.filter((p) => p.match_id === m && p.entry_id === e) }),
    'INSERT INTO picks (match_id, entry_id) VALUES (?, ?) ON CONFLICT DO NOTHING': ([m, e]) => {
      if (!T.picks.some((p) => p.match_id === m && p.entry_id === e)) T.picks.push({ match_id: m, entry_id: e, songs: '[]', ban: -1, pick: -1, updated_at: now() });
      return { write: true };
    },
    'DELETE FROM picks WHERE entry_id=?': ([e]) => { T.picks = T.picks.filter((p) => p.entry_id !== e); return { write: true }; },

    'SELECT value FROM kv WHERE key=?': ([k]) => ({ rows: T.kv.filter((x) => x.key === k).map((x) => ({ value: x.value })) }),
    "INSERT INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at": ([k, v]) => {
      const r = T.kv.find((x) => x.key === k);
      if (r) Object.assign(r, { value: v, updated_at: now() }); else T.kv.push({ key: k, value: v, updated_at: now() });
      return { write: true };
    },
  };

  function exec(sql, args) {
    const s = norm(sql);
    let h = H[s];
    // UPDATE picks SET 列=?, ... は列の組み合わせが変わるので個別に扱う
    const m = !h && s.match(/^UPDATE picks SET (.+), updated_at=datetime\('now'\) WHERE match_id=\? AND entry_id=\?$/);
    if (m) {
      const cols = m[1].split(',').map((c) => c.trim().replace(/=\?$/, ''));
      h = (a) => {
        const [mid, eid] = a.slice(cols.length);
        const p = T.picks.find((x) => x.match_id === mid && x.entry_id === eid);
        if (p) { cols.forEach((c, i) => (p[c] = a[i])); p.updated_at = now(); }
        return { write: true };
      };
    }
    if (!h) throw new Error('デモのデータベースが対応していない SQL です: ' + s);
    const r = h(args);
    if (r.write) onWrite?.();
    return r;
  }

  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    async run() { const r = exec(sql, args); return { meta: r.meta || {} }; },
    async first() { return one(exec(sql, args).rows || []); },
    async all() { return { results: exec(sql, args).rows || [] }; },
  });
  return {
    prepare: (sql) => stmt(sql),
    async batch(list) { for (const s of list) await s.run(); return []; },
  };
}
