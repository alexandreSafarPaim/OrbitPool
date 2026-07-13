# 🎱 Bilhar Multiplayer

Jogo de sinuca **8-Ball** multiplayer para navegador, em tempo real. Física em
canvas, mira com taco e potência, e partidas em rede via WebSocket — **sem
nenhuma dependência externa** (servidor em Node puro).

## Como rodar

```bash
node server.js
# ou
npm start
```

Depois abra **http://localhost:3000** no navegador.

Para jogar a dois:
- Abra em **duas abas** (ou dois dispositivos), digite o mesmo **nome de sala**
  nos dois e entre. A partida começa automaticamente quando o segundo jogador entra.
- Em outros dispositivos da mesma rede, use o IP da sua máquina no lugar de
  `localhost` (ex.: `http://192.168.0.10:3000`).

## Como jogar

- **Arraste para trás** da bola branca e **solte** para dar a tacada. Quanto mais
  longe você puxa, mais forte a tacada (veja a barra de potência).
- A linha pontilhada mostra a mira e o ponto de contato previsto.
- **Efeito:** antes de mirar, arraste na mini bola branca (acima da barra de
  potência) para escolher onde o taco vai tocar — acima/abaixo do centro dá
  *follow*/*draw*, dos lados dá inglês (side spin). Offset muito grande vira
  miscue (tacada falha).
- **Regras (8-Ball):**
  - A mesa começa "aberta". Quem encaçapar a primeira bola numerada define seu
    grupo: **lisas (1–7)** ou **listradas (9–15)**.
  - Encaçapar bola do seu grupo → continua jogando. Caso contrário, passa a vez.
  - **Faltas** (branca cai, não toca em bola, ou acerta bola errada primeiro):
    o adversário joga com **bola na mão** (toque para reposicionar a branca).
  - Encaçape a **bola 8** só depois de limpar seu grupo para **vencer**.
    Encaçapá-la antes da hora (ou com falta) faz você **perder**.

## Arquitetura

- **`server.js`** — servidor HTTP (arquivos estáticos) + WebSocket em Node puro.
  Gerencia salas de 2 jogadores e repassa mensagens entre eles.
- **`public/physics.js`** — motor de física event-based (sliding/rolling, spin/
  efeito, throw bola-bola, colisão de tabela, caçapas). Ao soltar a tacada, o
  jogador da vez calcula a tacada INTEIRA de uma vez (analiticamente, sem
  passos de tempo) e o resultado (timeline + eventos) é enviado pronto pelo
  WebSocket; o adversário só reproduz os mesmos dados — sem re-simular e sem
  problemas de determinismo de ponto flutuante entre máquinas.
- **`public/game.js`** — renderização, mira, efeito (inglês/follow/draw), regras
  do 8-ball e rede no cliente.
- **`public/index.html` / `style.css`** — lobby e HUD.
- **`public/rules.js`** — regras do 8-ball em módulo puro, compartilhado entre
  o cliente e o servidor ranqueado.
- **`public/ranked.js` + `ranked/`** — modo RANQUEADO: matchmaking + partida em
  servidor AUTORITATIVO (Cloudflare Workers/Durable Objects, plano free). O
  cliente envia só o input da tacada; o servidor roda a mesma física/regras,
  decide o vencedor e grava o ELO no D1 (temporada mensal). Ver `ranked/README.md`.

## Notas

- A porta pode ser mudada com a variável de ambiente `PORT` (ex.: `PORT=8080 node server.js`).
- Funciona com mouse e toque (touch), então dá para jogar no celular.
