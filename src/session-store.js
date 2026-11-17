import session from 'express-session';

// A deliberately small development store: no extra business table, no disk sessions.
export class BoundedStore extends session.Store {
  constructor({ max = 500, ttl = 2 * 60 * 60 * 1000 } = {}) {
    super(); this.rows = new Map(); this.max = max; this.ttl = ttl;
    this.timer = setInterval(() => this.prune(), 60_000).unref();
  }
  prune() { for (const [sid, row] of this.rows) if (row.expires < Date.now()) this.rows.delete(sid); }
  get(sid, cb) {
    const row = this.rows.get(sid);
    if (!row || row.expires < Date.now()) { this.rows.delete(sid); return cb(null, null); }
    cb(null, JSON.parse(row.data));
  }
  set(sid, value, cb = () => {}) {
    this.prune();
    if (!this.rows.has(sid) && this.rows.size >= this.max) this.rows.delete(this.rows.keys().next().value);
    this.rows.set(sid, { data: JSON.stringify(value), expires: Date.now() + this.ttl }); cb();
  }
  destroy(sid, cb = () => {}) { this.rows.delete(sid); cb(); }
  touch(sid, value, cb = () => {}) { this.set(sid, value, cb); }
  close() { clearInterval(this.timer); this.rows.clear(); }
}
