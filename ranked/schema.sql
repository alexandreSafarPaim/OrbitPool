-- OrbitPool ranqueado — schema D1 (SQLite).
-- Aplicar: npx wrangler d1 execute orbitpool --file=schema.sql [--remote]

CREATE TABLE IF NOT EXISTS players (
  id         TEXT NOT NULL,             -- 'fb:<uid>' | 'cg:<uid>' | 'dev:<x>'
  season     TEXT NOT NULL,             -- 'YYYY-MM' (temporada mensal)
  name       TEXT NOT NULL,
  elo        REAL NOT NULL DEFAULT 1000,
  wins       INTEGER NOT NULL DEFAULT 0,
  losses     INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (id, season)
);
CREATE INDEX IF NOT EXISTS idx_players_season_elo ON players (season, elo DESC);

CREATE TABLE IF NOT EXISTS matches (
  id         TEXT PRIMARY KEY,          -- uuid
  season     TEXT NOT NULL,
  winner_id  TEXT NOT NULL,
  loser_id   TEXT NOT NULL,
  elo_delta  REAL NOT NULL,
  reason     TEXT NOT NULL,             -- game | forfeit | timeout
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_matches_pair_time ON matches (winner_id, loser_id, created_at);
CREATE INDEX IF NOT EXISTS idx_matches_time ON matches (created_at);
