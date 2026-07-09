/* =========================================================================
   Colisor da mesa 3D (table.glb — "Billiard Table", Futurealiti, CC-BY-4.0).

   DECISÃO FINAL: a física usa a MESA ANALÍTICA calibrada pelo mesh, e não o
   contorno bruto da malha. Motivo: o modelo é low-poly e, dentro das bocas,
   o funil/arco de madeira gera paredes irregulares que ejetam a bola
   ("colisor invisível"). Em vez disso, TODAS as medidas da geometria
   analítica em physics.js foram extraídas da borracha do mesh:

     • W=850.4 × H=421.4  → linhas de parada do centro da bola medidas nas
       almofadas (banda de contato, com correção da inclinação da face);
     • CT=25, MT=26.5     → pontas reais da borracha (com tolerância invisível);
     • capturas           → furos reais do modelo (canto/meio);
     • jaws mortos        → facing absorvente nas bocas.

   O alinhamento visual (game3d.js) usa o MESMO frame: S=354.331 unid/m,
   X0=-0.00175, Z0=0.00165, FELT=0.7794. Física e visual coincidem por
   construção — sem window.TABLE3D_COLLIDER, o setTable não roda e a mesa
   analítica calibrada permanece ativa (comportamento intencional).
   ========================================================================= */
