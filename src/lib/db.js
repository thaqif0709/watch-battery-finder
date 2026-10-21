// D1 queries. Everything the app "learns" lives here.

import { compact, normalizeCalibre, calibreVariants } from './normalize.js';

const CACHE_DAYS = 30;

export function repo(db) {
  return {
    async findWatch({ reference, casebackCodes }) {
      const refs = [reference].filter(Boolean).map(compact).filter((r) => r.length >= 4);
      const codes = (casebackCodes ?? []).map(compact).filter((c) => c.length >= 4);
      if (!refs.length && !codes.length) return null;
      const clauses = [];
      const args = [];
      if (refs.length) {
        clauses.push(`reference_norm IN (${refs.map(() => '?').join(',')})`);
        args.push(...refs);
      }
      if (codes.length) {
        clauses.push(`caseback_norm IN (${codes.map(() => '?').join(',')})`);
        args.push(...codes);
      }
      return db.prepare(`SELECT * FROM watches WHERE ${clauses.join(' OR ')} ORDER BY id DESC LIMIT 1`).bind(...args).first();
    },

    async findMovement(maker, calibre) {
      for (const norm of calibreVariants(calibre)) {
        const rows = (await db.prepare('SELECT * FROM movements WHERE calibre_norm = ? AND battery IS NOT NULL').bind(norm).all()).results;
        const hit = rows.find((r) => r.maker === maker) ?? rows.find((r) => r.maker === '') ?? (rows.length === 1 ? rows[0] : null);
        if (hit) return hit;
      }
      return null;
    },

    async cacheGet(key) {
      const row = await db.prepare(`SELECT value FROM web_cache WHERE key = ? AND created_at > datetime('now', '-${CACHE_DAYS} days')`).bind(key).first();
      return row ? JSON.parse(row.value) : null;
    },

    async cachePut(key, value) {
      await db.prepare('INSERT OR REPLACE INTO web_cache (key, value, created_at) VALUES (?, ?, datetime(\'now\'))').bind(key, JSON.stringify(value)).run();
    },

    async saveLookup({ owner, battery, summary, result, thumbnail }) {
      const row = await db
        .prepare('INSERT INTO lookups (owner, battery, summary, result, thumbnail) VALUES (?, ?, ?, ?, ?) RETURNING id')
        .bind(owner ?? null, battery ?? null, summary ?? null, JSON.stringify(result), thumbnail ?? null)
        .first();
      return row.id;
    },

    async updateLookup(id, { owner, status, battery }) {
      await db
        .prepare('UPDATE lookups SET owner = COALESCE(?, owner), status = COALESCE(?, status), battery = COALESCE(?, battery) WHERE id = ?')
        .bind(owner ?? null, status ?? null, battery ?? null, id)
        .run();
    },

    async deleteLookup(id) {
      await db.prepare('DELETE FROM lookups WHERE id = ?').bind(id).run();
    },

    async getLookup(id) {
      const row = await db.prepare('SELECT * FROM lookups WHERE id = ?').bind(id).first();
      return row && { ...row, result: JSON.parse(row.result) };
    },

    async listLookups(status, limit = 100) {
      const sql = status
        ? 'SELECT id, owner, status, battery, summary, thumbnail, created_at FROM lookups WHERE status = ? ORDER BY id DESC LIMIT ?'
        : 'SELECT id, owner, status, battery, summary, thumbnail, created_at FROM lookups ORDER BY id DESC LIMIT ?';
      const stmt = status ? db.prepare(sql).bind(status, limit) : db.prepare(sql).bind(limit);
      return (await stmt.all()).results;
    },

    async listWatches(q, limit = 200) {
      if (!q) return (await db.prepare('SELECT * FROM watches ORDER BY id DESC LIMIT ?').bind(limit).all()).results;
      const like = `%${q}%`;
      const norm = `%${compact(q)}%`;
      return (
        await db
          .prepare(
            `SELECT * FROM watches WHERE brand LIKE ? OR model LIKE ? OR owner LIKE ? OR battery LIKE ?
             OR reference_norm LIKE ? OR caseback_norm LIKE ? OR calibre_norm LIKE ? ORDER BY id DESC LIMIT ?`,
          )
          .bind(like, like, like, like, norm, norm, norm, limit)
          .all()
      ).results;
    },

    async deleteWatch(id) {
      await db.prepare('DELETE FROM watches WHERE id = ?').bind(id).run();
    },

    // "Confirmed after opening": remember the watch and teach the movement table.
    async confirm(w) {
      const calibreNorm = normalizeCalibre(w.calibre);
      const row = await db
        .prepare(
          `INSERT INTO watches (brand, model, reference, reference_norm, caseback_code, caseback_norm, calibre, calibre_norm, maker,
             movement_type, battery, case_mm, owner, notes, thumbnail, lookup_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        )
        .bind(
          w.brand || null, w.model || null, w.reference || null, compact(w.reference) || null,
          w.caseback_code || null, compact(w.caseback_code) || null, w.calibre || null, calibreNorm || null, w.maker || '',
          w.movement_type || null, w.battery || null, w.case_mm ?? null, w.owner || null, w.notes || null, w.thumbnail || null, w.lookup_id ?? null,
        )
        .first();

      let movement = null;
      if (calibreNorm && w.battery) {
        const existing = await db.prepare('SELECT * FROM movements WHERE maker = ? AND calibre_norm = ?').bind(w.maker || '', calibreNorm).first();
        const history = existing ? JSON.parse(existing.history) : [];
        history.push({ battery: w.battery, watch_id: row.id, at: new Date().toISOString() });
        // Same battery again: one more confirmation. A different battery: the newest real-world finding wins, history keeps the old one.
        const confirmations = existing && existing.battery === w.battery ? existing.confirmations + 1 : 1;
        await db
          .prepare(
            `INSERT INTO movements (maker, calibre_norm, calibre, movement_type, battery, confirmations, history, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
             ON CONFLICT (maker, calibre_norm) DO UPDATE SET calibre = excluded.calibre, movement_type = excluded.movement_type,
               battery = excluded.battery, confirmations = excluded.confirmations, history = excluded.history, updated_at = excluded.updated_at`,
          )
          .bind(w.maker || '', calibreNorm, w.calibre, w.movement_type || null, w.battery, confirmations, JSON.stringify(history.slice(-20)))
          .run();
        movement = { calibre: w.calibre, battery: w.battery, confirmations, changed: Boolean(existing && existing.battery !== w.battery), previous: existing?.battery ?? null };
      }
      if (w.lookup_id) await this.updateLookup(w.lookup_id, { status: 'done', battery: w.battery || null });
      return { watch_id: row.id, movement };
    },
  };
}
