# Relatório Técnico: Física Realista para Jogo de Sinuca

**Objetivo:** Especificação completa da física de um simulador de sinuca/bilhar com realismo de nível acadêmico, pronta para implementação.

**Referências-base:** Mathavan et al. (2010) para colisão bola-tabela; Han (2005) para dinâmica de carambola; Ron Shepard, *Amateur Physics for the Amateur Pool Player*; arquitetura event-based do simulador open-source *pooltool* (Evan Kiefl).

---

## 1. Arquitetura recomendada: simulação orientada a eventos (event-based)

Existem duas abordagens:

**A) Timestep fixo (discreto):** avança o mundo em passos de Δt (ex: 1/240s), detecta sobreposição de bolas e resolve. Simples, mas sofre de *tunneling* (bolas rápidas atravessam umas às outras), imprecisão nos ângulos de colisão e custo alto para precisão aceitável.

**B) Event-based (contínuo/analítico) — RECOMENDADO:** como o movimento das bolas entre eventos é descrito por equações fechadas (polinômios no tempo), é possível calcular *analiticamente* o instante exato do próximo evento (colisão bola-bola, colisão bola-tabela, transição de deslizamento→rolamento, etc.). O algoritmo é:

```
1. Para cada par/objeto, calcular o tempo até cada evento possível
2. Escolher o evento com menor tempo t_min
3. Evoluir TODAS as bolas analiticamente até t_min
4. Resolver o evento (aplicar impulsos/mudança de estado)
5. Repetir até nenhuma bola estar em movimento
```

Isso dá precisão perfeita (sem tunneling), é determinístico e é mais barato computacionalmente. Para renderização, basta interpolar/avaliar as equações de movimento em qualquer t entre eventos.

**Regra crítica:** mesmo que o evento envolva só as bolas 1 e 2, a bola 3 só pode ser evoluída até o instante desse evento — nunca além.

---

## 2. Constantes físicas e parâmetros

| Parâmetro | Símbolo | Valor padrão (pool americano) | Notas |
|---|---|---|---|
| Massa da bola | m | 0,170 kg | Snooker: 0,141 kg |
| Raio da bola | R | 0,028575 m (2¼" diâm.) | Snooker: 0,02625 m |
| Momento de inércia | I | (2/5)·m·R² | Esfera sólida |
| Gravidade | g | 9,81 m/s² | |
| Atrito de deslizamento bola-pano | μs | 0,15 – 0,25 (padrão 0,2) | Pano rápido: menor |
| Atrito de rolamento bola-pano | μr | 0,005 – 0,015 (padrão 0,01) | |
| Atrito de spin (pião) bola-pano | μsp | ≈ 0,044 · (R relativo) — ver §4.4 | |
| Restituição bola-bola | e_bb | 0,92 – 0,98 (padrão 0,95) | Fenólica ≈ quase elástica |
| Atrito bola-bola (throw) | μbb | 0,03 – 0,08 (padrão 0,06; varia com velocidade) | |
| Restituição bola-tabela | e_bc | ≈ 0,85 (Mathavan: 0,98 na normal do ponto de contato; efetivo 0,7–0,9) | Cai com velocidade |
| Atrito bola-tabela | μbc | ≈ 0,14 – 0,2 | |
| Altura do contato da tabela | h | (7/5)·R = 1,4·R acima da mesa | Padrão WPA |
| Mesa 8-ft (área de jogo) | | 2,24 m × 1,12 m | 9-ft: 2,54 × 1,27 m |
| Boca da caçapa de canto | | ≈ 0,117 m (4,5"–4,625") | Lateral: ≈ 0,127 m |
| Massa do taco | M | 0,50 – 0,60 kg | |

Todos os coeficientes devem ficar em um arquivo de configuração — são os "knobs" de realismo do jogo.

---

## 3. Estado da bola e estados de movimento

### 3.1 Estado

Cada bola carrega:

```
posição      r = (x, y, z)        [z só se implementar saltos]
velocidade   v = (vx, vy, vz)
vel. angular ω = (ωx, ωy, ωz)     [rad/s]
estado       ∈ {STATIONARY, SPINNING, ROLLING, SLIDING, AIRBORNE, POCKETED}
```

### 3.2 Grandeza-chave: velocidade relativa no ponto de contato

A física da bola no pano é governada pela **velocidade de deslizamento do ponto de contato** com a mesa:

```
u = v + R·(ẑ × ω_horizontal)     →  em 2D: u = (vx − R·ωy,  vy + R·ωx)
```

- **|u| > 0** → a bola está **DESLIZANDO** (sliding)
- **|u| = 0** e |v| > 0 → **ROLAMENTO puro** (rolling): v = R·ω (rolar sem deslizar)
- **|v| = 0** e |ωz| > 0 → **GIRANDO no lugar** (spinning, como pião)
- tudo zero → **PARADA**

### 3.3 Transições naturais (eventos de transição)

Toda transição vai de energia maior para menor, causada por atrito:

```
SLIDING  → ROLLING     (quando |u| chega a 0)
ROLLING  → STATIONARY  (quando |v| chega a 0)
SPINNING → sem spin    (quando |ωz| chega a 0)
```

**Bug clássico se ignorar:** se você continuar aplicando a equação de sliding após u=0, a bola começa a girar ao contrário e ganha energia infinitamente. As transições PRECISAM ser eventos tratados.

---

## 4. Equações de movimento no pano

### 4.1 Fase de DESLIZAMENTO (sliding)

O atrito cinético atua oposto a **u** (não oposto a v!):

```
û = u / |u|                          (direção do deslizamento, constante durante a fase)
a  = −μs · g · û                     (desaceleração linear)
α  = −(5·μs·g)/(2·R) · (ẑ × û)       (aceleração angular sobre eixos horizontais)
```

Soluções fechadas (û é constante no referencial alinhado ao deslizamento inicial):

```
r(t) = r₀ + v₀·t − ½·μs·g·t²·û
v(t) = v₀ − μs·g·t·û
u(t) = u₀ − (7/2)·μs·g·t·û
```

**Duração da fase:** t_slide = (2·|u₀|) / (7·μs·g). Nesse instante ocorre a transição para ROLLING.

Observação importante: durante o sliding com efeito lateral/retrograde, a **trajetória é parabólica** (é isso que produz o "curvar" da bola com massé ou draw em ângulo).

### 4.2 Fase de ROLAMENTO (rolling)

Rolamento puro: v = R·ω a cada instante. O atrito de rolamento desacelera na direção de v:

```
v(t) = v₀ − μr·g·t·v̂₀
r(t) = r₀ + v₀·t − ½·μr·g·t²·v̂₀
ω_horizontal acompanha: ω = (ẑ × v)/R... na prática ω = v/R no eixo perpendicular
```

**Duração:** t_roll = |v₀| / (μr·g). Trajetória em linha reta.

### 4.3 Componente vertical do spin (ωz) — o "inglês"

ωz (spin em torno do eixo vertical) **não afeta a trajetória no pano** (com pano ideal), mas é crucial nas colisões com tabela e bola. Decai por atrito de pivô:

```
ωz(t) = ωz₀ − sign(ωz₀) · (5·μsp·g)/(2·R) · t
```

### 4.4 Coeficiente de spin

Valor usado pelo pooltool/literatura: μsp ≈ 10 · 0,022/R... na prática, use decaimento angular de ~2–10 rad/s² e calibre visualmente. Alternativa simples: `ω̇z = −(5·μsp·g)/(2·R)` com μsp ≈ 0,044·(R/0,028575) ajustável.

---

## 5. A tacada (cue strike)

### 5.1 Parâmetros da tacada

```
V0     = velocidade do taco no impacto (0,5 – 8 m/s; break ≈ 7–11 m/s)
(a, b) = offset do ponto de impacto em relação ao centro da bola,
         normalizado por R. a = lateral (inglês), b = vertical (follow/draw)
         limite físico: √(a² + b²) ≤ 0,5 (além disso = miscue/erro de tacada)
θ      = elevação do taco (0° tacada normal; > 45° massé)
φ      = direção horizontal da tacada
```

### 5.2 Velocidade resultante da bola

Modelo de impacto taco-bola (impulso com taco de massa M, bola de massa m):

```
v_bola = (2·V0) / (1 + m/M + (5/(2R²))·(a² + b² ... termos de offset))
```

Fórmula prática (usada no pooltool):

```
v = 2·V0 / (1 + m/M + (5/2)·(a² + b² + ... c²·termos))
```

onde o denominador cresce com o offset — tacada fora do centro transfere **menos velocidade linear e mais spin**. Versão simplificada aceitável para jogo:

```
v_bola ≈ (2·V0)/(1 + m/M) · fator(offset)    com fator caindo ~10–15% no offset máximo
```

### 5.3 Spin gerado pela tacada

Com impacto no ponto (a·R, b·R) da face da bola:

```
ω_gerado = (v_bola / R) · (5/2) · vetor_offset
Especificamente:
  b > 0 (acima do centro)  → topspin (FOLLOW): ωy alinhado com avanço
  b < 0 (abaixo do centro) → backspin (DRAW): bola desliza com u grande,
                             após colisão frontal ela RETORNA
  a ≠ 0 (lado)             → ωz (inglês/side spin)
```

Magnitude: `|ω| = (5·v·offset)/(2·R)` para cada componente.

### 5.4 Squirt (deflexão do taco) — realismo avançado

Ao aplicar inglês (a ≠ 0), a bola sai levemente desviada da linha do taco (~1°–4°). Modelo simples:

```
ângulo_squirt ≈ arctan( a · k_squirt ),  k_squirt ≈ 0,05–0,1
```

Opcional, mas jogadores experientes notam a ausência.

### 5.5 Massé / jump (opcional)

Com taco elevado (θ > 0), parte do impulso vai para baixo → a bola ganha spin que faz a trajetória curvar (parábola durante o sliding, §4.1). Para θ muito alto + offset baixo, a bola salta (necessário eixo z).

---

## 6. Colisão bola-bola

### 6.1 Modelo base (instantâneo, impulso na linha dos centros)

No instante da colisão (|r₁ − r₂| = 2R):

```
n̂ = (r₂ − r₁)/|r₂ − r₁|          (normal, do centro 1 para o 2)
t̂ = perpendicular a n̂

Decompor velocidades:  v₁n = (v₁·n̂),  v₁t = v₁ − v₁n·n̂  (idem bola 2)
```

Para massas iguais e restituição e_bb, o impulso normal:

```
J = m·(1 + e_bb)/2 · (v₁n − v₂n)

v₁' = v₁ − (J/m)·n̂
v₂' = v₂ + (J/m)·n̂
```

Com e_bb = 1 e bola 2 parada: **as componentes normais se trocam completamente** — a bola alvo sai na linha dos centros, a bola branca mantém só a componente tangencial (regra dos 90°). Com e_bb = 0,95, a bola branca retém ~2,5% da velocidade normal (realista).

**Importante:** o spin (ω) das duas bolas **não muda** na colisão no modelo sem atrito — é por isso que follow/draw funcionam: a bola branca para (ou quase) na colisão frontal, mas seu topspin/backspin continua, e o atrito com o pano a acelera para frente (follow) ou para trás (draw) logo em seguida.

### 6.2 Throw (arremesso induzido) — o refinamento que dá realismo profissional

Há atrito entre as bolas (μbb ≈ 0,03–0,08) durante o contato. A força tangencial:

1. **Cut-induced throw:** em colisões de corte, a bola alvo é "arrastada" alguns graus (até ~5°) na direção do movimento tangencial da branca.
2. **Spin-induced throw:** inglês na branca "arremessa" a bola alvo para o lado oposto ao spin.
3. **Transferência de spin:** a bola alvo ganha um pouco de inglês oposto.

Implementação (impulso tangencial limitado por Coulomb):

```
v_rel_contato = velocidade relativa das superfícies no ponto de contato
              = (v₁ − v₂)_tangencial + R·(ω₁ + ω₂) × n̂   (componentes tangenciais)

J_t = min( μbb · J_normal , impulso que zeraria v_rel_contato )
Aplicar J_t na direção −v̂_rel_contato à bola 1, +J_t à bola 2
Atualizar ω das duas bolas: Δω = (R·n̂ × J_t)/I
```

μbb realista **decresce com a velocidade**: `μbb(v) ≈ 0,06·e^(−0,7·v_rel)` + piso de 0,01 (aproximação dos dados do Dr. Dave). Pode usar constante 0,05 numa primeira versão.

### 6.3 Detecção analítica do instante de colisão (event-based)

Entre eventos, as posições são polinômios quadráticos no tempo. A condição de colisão:

```
|r₁(t) − r₂(t)|² = (2R)²
```

é um **polinômio de grau 4 em t**. Resolver a quártica (fórmula fechada ou numérico robusto) e tomar a menor raiz real positiva. Se não houver raiz, não há colisão entre esse par.

---

## 7. Colisão bola-tabela (cushion) — a parte mais delicada

A tabela toca a bola a uma altura h = 1,4·R (acima do equador!), o que empurra a bola contra a mesa e comprime a trajetória. O modelo de referência é **Mathavan et al. (2010)**, que resolve equações diferenciais do impacto com atrito na tabela E na mesa simultaneamente. Valores experimentais desse trabalho: restituição ≈ 0,98 no ponto de contato e atrito bola-tabela ≈ 0,14, válido até ~2,5 m/s de velocidade normal (acima disso a tabela deforma demais).

### 7.1 Modelo simplificado (bom para primeira versão)

```
1. Refletir a componente normal:      v_n' = −e_bc · v_n
2. Reduzir a tangencial pelo atrito:  v_t' = v_t · (1 − k_t)   , k_t ≈ 0,1–0,2
3. Efeito do inglês (ωz):             v_t' += f_spin · R · ωz  , f_spin ≈ 0,15–0,25
4. Reter parte do spin, inverter parte:
     ωz' ≈ 0,5–0,8 · ωz  ;  ω_normal reflete parcialmente
```

Isso já reproduz os efeitos visíveis: inglês "encurtando" ou "alargando" o ângulo de rebote.

### 7.2 Modelo completo (Han 2005 / Mathavan 2010) — recomendado para "perfeitamente real"

Trata o impacto como impulsos com atrito em DOIS contatos (tabela no ponto alto h=1,4R e mesa embaixo), integrando sobre o impulso normal:

- A componente normal usa e_bc dependente da velocidade: `e_bc(v_n) ≈ 0,98 − 0,022·v_n` (cai com impacto forte).
- O atrito na tabela (μbc ≈ 0,14–0,2) acopla velocidade tangencial e spin: bola com topspin rebate mais "comprida"; com backspin, mais "curta"; com inglês forte e ângulo raso, a bola pode até **voltar para o mesmo lado** de onde veio (fenômeno documentado experimentalmente).
- Depois do rebote, a velocidade resultante geralmente tem componente **para dentro da mesa** (porque o contato é acima do centro) → a mesa aplica reação e, em tacadas fortes, a bola **pula** levemente ao sair da tabela.

Sugestão prática: implementar o modelo do paper de Mathavan (equações 12–19 do artigo, disponíveis publicamente) como função `resolve_cushion_collision(ball, cushion) → (v', ω')`. O pooltool tem implementação de referência em Python (open source, MIT) que pode ser portada.

### 7.3 Geometria das tabelas

Modelar cada tabela como **segmento de reta** (colisão = distância ponto-segmento ≤ R) + **arcos/segmentos nas entradas das caçapas** (jaws). As pontas das tabelas perto das caçapas são chanfradas — modelar como segmentos angulados ou círculos pequenos; isso define se a bola "morre" na boca ou entra.

---

## 8. Caçapas

```
- Cada caçapa = círculo de captura (raio ≈ 0,06–0,07 m) posicionado ligeiramente
  para fora da linha das tabelas.
- Evento de encaçapamento: centro da bola cruza o círculo de captura
  → estado POCKETED, remover da mesa (animar queda com gravidade se quiser).
- Realismo extra: se a bola passa raspando, ela colide com as jaws (chanfros)
  e pode "chacoalhar" na boca — isso emerge naturalmente se as jaws forem
  modeladas como segmentos de tabela.
```

---

## 9. Loop de simulação (pseudocódigo)

```python
def simulate(balls, table):
    while any(b.state != STATIONARY and b.state != POCKETED for b in balls):
        events = []
        for b in balls:
            events.append(transition_event_time(b))          # slide→roll, roll→stop, spin→stop
        for b1, b2 in pairs(balls):
            events.append(ball_ball_collision_time(b1, b2))  # raiz da quártica
        for b in balls:
            for c in table.cushion_segments:
                events.append(ball_cushion_collision_time(b, c))  # quadrática
            for p in table.pockets:
                events.append(ball_pocket_time(b, p))

        e = min(events, key=lambda ev: ev.t)
        for b in balls:
            b.evolve_analytic(e.t)      # equações fechadas §4
        e.resolve()                      # impulsos §5–§8
```

Para renderizar a 60 fps, guarde a lista de eventos com timestamps e avalie as equações fechadas em cada frame (a simulação inteira pode rodar instantaneamente antes da animação — ótimo também para IA/preview de tacada).

**Alternativa timestep** (se preferir simplicidade): Δt ≤ 1/300 s, com *continuous collision detection* por par (resolver a quártica dentro do passo) para evitar tunneling no break.

---

## 10. Caso especiais e armadilhas conhecidas

1. **Break (colisões simultâneas):** no rack, várias colisões ocorrem "ao mesmo tempo". Event-based resolve naturalmente em sequência (t idênticos → resolver em ordem arbitrária com epsilon). Adicionar jitter microscópico (~1e-9 m) nas posições do rack evita degenerescências e produz quebras variadas e realistas.
2. **Bolas encostadas (frozen balls):** distância inicial exatamente 2R → excluir pares já em contato da detecção até se separarem, ou usar epsilon.
3. **Energia:** verifique que cada evento nunca AUMENTA a energia total (teste automatizado essencial).
4. **Ordem follow/draw:** o efeito de follow/draw acontece APÓS a colisão, via fase de sliding — não aplique "empurrão" artificial na colisão.
5. **Nunca aplicar atrito de sliding após u = 0** (§3.3).
6. **Miscue:** se √(a²+b²) > 0,5, a tacada falha (aplicar velocidade mínima + som de erro).

---

## 11. Ordem de implementação sugerida

1. **Fase 1 — Núcleo:** estados de movimento + equações fechadas (§4), tacada central (sem spin), colisão bola-bola sem atrito (§6.1), tabela como reflexão simples, caçapas. → Jogo já jogável.
2. **Fase 2 — Spin:** tacada com offset (a,b) (§5), follow/draw/inglês, decaimento de ωz, colisão de tabela com efeito de spin (§7.1).
3. **Fase 3 — Realismo profissional:** throw bola-bola (§6.2), modelo Mathavan de tabela (§7.2), squirt (§5.4), e_bb e μbb dependentes de velocidade.
4. **Fase 4 — Extras:** massé/jump (eixo z), física de queda na caçapa, jaws detalhadas.

---

## 12. Referências para consulta durante a implementação

- Mathavan, S. et al., *A theoretical analysis of billiard ball dynamics under cushion impacts*, Proc. IMechE Part C, 2010 — modelo definitivo de tabela.
- Han, I., *Dynamics in Carom and Three Cushion Billiards*, J. Mech. Sci. Tech., 2005.
- Shepard, R., *Amateur Physics for the Amateur Pool Player* (3ª ed.) — derivações completas de sliding/rolling/throw.
- Kiefl, E., blog do **pooltool** (ekiefl.github.io) + repositório github.com/ekiefl/pooltool — implementação event-based de referência em Python (MIT).
- Dr. Dave Billiards (drdavepoolinfo.com/physics) — dados experimentais de coeficientes.