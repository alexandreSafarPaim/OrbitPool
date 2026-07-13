# OrbitPool Ranqueado — servidor autoritativo

Worker da Cloudflare (plano free) com Durable Objects + D1. O cliente envia
apenas o INPUT da tacada; o servidor roda o MESMO `physics.js` + `rules.js`
do jogo (gerados em `src/engine.mjs`) e decide bolas, faltas e vencedor.
Ninguém reporta "ganhei" — o ELO nasce aqui.

## Componentes

- `src/index.mjs`  — roteador: `/api/leaderboard`, `/ws/queue`, `/ws/room/:id`
- `src/queue.mjs`  — DO singleton de matchmaking (FIFO)
- `src/room.mjs`   — DO da partida (física+regras autoritativas, timeouts, forfeit)
- `src/auth.mjs`   — verifica JWT do Firebase (site) e do CrazyGames (portal)
- `src/elo.mjs`    — ELO K=32, temporada mensal, anti-farm (1×/0.6×/0.3×/0.15×/0)
- `src/engine.mjs` — GERADO por `npm run gen` a partir de `../public/` (não editar)
- `schema.sql`     — tabelas `players` (por temporada) e `matches`

## Setup (uma vez — precisa da SUA conta Cloudflare)

```bash
cd ranked
npm install
npx wrangler login
npx wrangler d1 create orbitpool     # copie o database_id p/ o wrangler.toml
npm run db:remote                    # aplica o schema no D1 de produção
npm run deploy
```

Depois do deploy, anote a URL do Worker (ex.: `orbitpool-ranked.<sua-conta>.workers.dev`)
— o cliente vai usá-la. Quando criar o projeto Firebase (fase 3), preencha
`FIREBASE_PROJECT_ID` no `wrangler.toml` e rode `npm run deploy` de novo.

## Desenvolvimento local

```bash
npm run db:local   # schema no D1 local
npm run dev        # wrangler dev na :8787 (ALLOW_DEV_AUTH=true)
npm test           # 2 jogadores simulados jogam uma partida real
```

Obs.: alterou `public/physics.js` ou `public/rules.js`? Rode `npm run gen`
(o `dev`/`deploy` já fazem isso automaticamente).

## Protocolo (resumo)

Fila:   WS `/ws/queue?token=...` → `{t:'matched', room, playerNo}`
Sala:   WS `/ws/room/<id>?token=...` → `joined` → `start{balls, elo}` →
        cliente manda `shotinput{ang,power,a,b}` / `ballcue{x,y}` / `aim{a}` →
        servidor responde `shot{segments,events,finalBalls, state{...}}` →
        no fim `ranked_result{winner, reason, elo}`.
Regras de segurança: só quem está NA VEZ pode agir; posição de bola na mão é
validada; timeout de 90s por tacada; 60s p/ reconectar (senão W.O.).
