/* =========================================================================
   ELO + persistência em D1. Temporada mensal (YYYY-MM): ranking zera todo
   mês (retenção), histórico fica em matches.
   Anti-farm: vitórias repetidas contra o MESMO oponente nas últimas 24h
   valem cada vez menos (1×, 0.6×, 0.3×, 0.15×, depois 0).
   ========================================================================= */
'use strict';

export const K = 32;
export const BASE_ELO = 1000;

export const currentSeason = () => new Date().toISOString().slice(0, 7); // YYYY-MM

export function eloDelta(winner, loser, k = K) {
  const expected = 1 / (1 + Math.pow(10, (loser - winner) / 400));
  return k * (1 - expected);
}

export function repeatFactor(prevPairMatches24h) {
  const f = [1, 0.6, 0.3, 0.15];
  return prevPairMatches24h < f.length ? f[prevPairMatches24h] : 0;
}

async function ensurePlayer(db, season, id, name) {
  await db.prepare(
    `INSERT INTO players (id, season, name, elo, wins, losses, updated_at)
     VALUES (?, ?, ?, ?, 0, 0, unixepoch())
     ON CONFLICT(id, season) DO UPDATE SET name = excluded.name`
  ).bind(id, season, name, BASE_ELO).run();
}

export async function getElo(db, id) {
  const season = currentSeason();
  const row = await db.prepare('SELECT elo FROM players WHERE id = ? AND season = ?')
    .bind(id, season).first();
  return row ? row.elo : BASE_ELO;
}

// Registra o resultado e devolve os novos ratings.
// winner/loser: { id, name }. reason: 'game' | 'forfeit' | 'timeout'.
export async function recordResult(db, winner, loser, reason = 'game') {
  const season = currentSeason();
  await ensurePlayer(db, season, winner.id, winner.name);
  await ensurePlayer(db, season, loser.id, loser.name);

  const pair = await db.prepare(
    `SELECT COUNT(*) AS c FROM matches
     WHERE created_at > unixepoch() - 86400
       AND ((winner_id = ?1 AND loser_id = ?2) OR (winner_id = ?2 AND loser_id = ?1))`
  ).bind(winner.id, loser.id).first();

  const wRow = await db.prepare('SELECT elo FROM players WHERE id = ? AND season = ?').bind(winner.id, season).first();
  const lRow = await db.prepare('SELECT elo FROM players WHERE id = ? AND season = ?').bind(loser.id, season).first();
  const wElo = wRow ? wRow.elo : BASE_ELO, lElo = lRow ? lRow.elo : BASE_ELO;

  const factor = repeatFactor(pair ? pair.c : 0);
  const delta = Math.round(eloDelta(wElo, lElo) * factor * 100) / 100;

  await db.batch([
    db.prepare(`UPDATE players SET elo = elo + ?, wins = wins + 1, updated_at = unixepoch()
                WHERE id = ? AND season = ?`).bind(delta, winner.id, season),
    db.prepare(`UPDATE players SET elo = MAX(?, elo - ?), losses = losses + 1, updated_at = unixepoch()
                WHERE id = ? AND season = ?`).bind(0, delta, loser.id, season),
    db.prepare(`INSERT INTO matches (id, season, winner_id, loser_id, elo_delta, reason, created_at)
                VALUES (?, ?, ?, ?, ?, ?, unixepoch())`)
      .bind(crypto.randomUUID(), season, winner.id, loser.id, delta, reason),
  ]);

  return { winnerElo: wElo + delta, loserElo: Math.max(0, lElo - delta), delta, factor };
}

export async function leaderboard(db, limit = 50) {
  const season = currentSeason();
  const rs = await db.prepare(
    `SELECT name, elo, wins, losses FROM players
     WHERE season = ? ORDER BY elo DESC, wins DESC LIMIT ?`
  ).bind(season, Math.min(limit, 100)).all();
  return { season, players: rs.results || [] };
}
