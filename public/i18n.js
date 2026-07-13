/* =========================================================================
   OrbitPool — internacionalização (i18n).
   Idiomas: en (padrão/fallback), pt, es, fr.
   • Detecta o idioma do sistema (navigator.languages); se não for um dos
     suportados, cai no INGLÊS. Escolha manual persiste em localStorage.
   • OrbitI18N.t(chave, params) → string traduzida ({x} interpolado).
   • Elementos estáticos usam data-i18n / data-i18n-html / data-i18n-ph /
     data-i18n-aria e são traduzidos por OrbitI18N.apply().
   • Trocar de idioma dispara o evento 'orbitpool:lang' (HUD re-renderiza).
   O nome/título "OrbitPool" nunca é traduzido.
   ========================================================================= */
'use strict';

window.OrbitI18N = (function () {
  const LSKEY = 'orbitpool.lang';
  const SUPPORTED = ['en', 'pt', 'es', 'fr'];
  const NAMES = { en: 'English', pt: 'Português', es: 'Español', fr: 'Français' };
  const OGLOCALE = { en: 'en_US', pt: 'pt_BR', es: 'es_ES', fr: 'fr_FR' };
  const CANON_BASE = 'https://orbitpool.com.br/';

  // ---- Dicionário: chave → { en, pt, es, fr } ------------------------------
  const D = {
    // ---- Conta / abas do menu / login -----------------------------------
    'acct.guestTitle': { pt: 'Jogando como convidado', en: 'Playing as guest', es: 'Jugando como invitado', fr: 'Vous jouez en invité' },
    'acct.guestSub': { pt: 'entre pra salvar ELO e stats', en: 'sign in to save your ELO & stats', es: 'entra para guardar ELO y stats', fr: 'connectez-vous pour garder votre ELO' },
    'acct.login': { pt: 'Entrar', en: 'Sign in', es: 'Entrar', fr: 'Connexion' },
    'acct.logout': { pt: 'Sair', en: 'Sign out', es: 'Salir', fr: 'Quitter' },
    'acct.logged': { pt: 'ELO {elo} · logado', en: 'ELO {elo} · signed in', es: 'ELO {elo} · conectado', fr: 'ELO {elo} · connecté' },
    'acct.loggedNoElo': { pt: 'logado', en: 'signed in', es: 'conectado', fr: 'connecté' },
    'tab.play': { pt: 'Jogar', en: 'Play', es: 'Jugar', fr: 'Jouer' },
    'tab.ranked': { pt: 'Ranqueada', en: 'Ranked', es: 'Clasificatoria', fr: 'Classé' },
    'tab.bot': { pt: 'Treino', en: 'Practice', es: 'Práctica', fr: 'Entraînement' },
    'or.code': { pt: 'ou entra por código', en: 'or join with a code', es: 'o entra con código', fr: 'ou entrez avec un code' },
    'rk.lockTitle': { pt: 'precisa se identificar', en: 'you need to sign in', es: 'necesitas identificarte', fr: 'identifiez-vous' },
    'rk.lockSub': { pt: 'a ranqueada vale ELO — entre na conta ou jogue como convidado.', en: 'ranked is ELO-rated — sign in or play as a guest.', es: 'la clasificatoria vale ELO — entra o juega como invitado.', fr: 'le classé compte pour l’ELO — connectez-vous ou jouez en invité.' },
    'rk.loginCta': { pt: 'Entrar pra jogar ranqueada', en: 'Sign in to play ranked', es: 'Entra para jugar clasificatoria', fr: 'Connectez-vous pour le classé' },
    'rk.guestCta': { pt: 'Jogar ranqueada como convidado', en: 'Play ranked as guest', es: 'Jugar clasificatoria como invitado', fr: 'Jouer classé en invité' },
    'rk.queueCta': { pt: 'Entrar na fila 1v1 · vale ELO', en: 'Join the 1v1 queue · ELO rated', es: 'Entrar a la cola 1v1 · vale ELO', fr: 'File 1v1 · compte pour l’ELO' },
    'rk.lbCta': { pt: 'Ver ranking da temporada', en: 'View season leaderboard', es: 'Ver ranking de la temporada', fr: 'Voir le classement de la saison' },
    'auth.title2': { pt: 'Entrar na conta', en: 'Sign in', es: 'Entrar en la cuenta', fr: 'Connexion' },
    'auth.tag': { pt: '— pra jogar valendo ELO —', en: '— to play for ELO —', es: '— para jugar por ELO —', fr: '— pour jouer classé —' },
    'auth.name': { pt: 'nome', en: 'name', es: 'nombre', fr: 'nom' },
    'auth.email': { pt: 'e-mail', en: 'email', es: 'correo', fr: 'e-mail' },
    'auth.pass': { pt: 'senha', en: 'password', es: 'contraseña', fr: 'mot de passe' },
    'auth.signin': { pt: 'Entrar', en: 'Sign in', es: 'Entrar', fr: 'Connexion' },
    'auth.signup': { pt: 'Criar conta', en: 'Create account', es: 'Crear cuenta', fr: 'Créer un compte' },
    'auth.noAccount': { pt: 'não tem conta?', en: 'no account yet?', es: '¿no tienes cuenta?', fr: 'pas de compte ?' },
    'auth.create': { pt: 'criar rapidinho', en: 'create one in seconds', es: 'créala rapidito', fr: 'créez-en un vite fait' },
    'auth.haveAccount': { pt: 'já tem conta?', en: 'already have an account?', es: '¿ya tienes cuenta?', fr: 'déjà un compte ?' },
    'auth.toSignin': { pt: 'entrar', en: 'sign in', es: 'entrar', fr: 'se connecter' },
    'auth.or': { pt: 'ou', en: 'or', es: 'o', fr: 'ou' },
    'auth.err.invalid': { pt: 'E-mail ou senha incorretos.', en: 'Wrong email or password.', es: 'Correo o contraseña incorrectos.', fr: 'E-mail ou mot de passe incorrect.' },
    'auth.err.emailInUse': { pt: 'Esse e-mail já tem conta — tenta entrar.', en: 'That email already has an account — try signing in.', es: 'Ese correo ya tiene cuenta — intenta entrar.', fr: 'Cet e-mail a déjà un compte — connectez-vous.' },
    'auth.err.weakPass': { pt: 'Senha muito curta (mínimo 6 caracteres).', en: 'Password too short (6+ characters).', es: 'Contraseña muy corta (mínimo 6).', fr: 'Mot de passe trop court (6 min).' },
    'auth.err.badEmail': { pt: 'E-mail inválido.', en: 'Invalid email.', es: 'Correo inválido.', fr: 'E-mail invalide.' },
    'auth.err.tooMany': { pt: 'Muitas tentativas — espera um pouco.', en: 'Too many attempts — wait a bit.', es: 'Demasiados intentos — espera un poco.', fr: 'Trop de tentatives — patientez.' },
    'auth.err.popup': { pt: 'A janela do Google foi fechada/bloqueada.', en: 'The Google window was closed/blocked.', es: 'La ventana de Google se cerró/bloqueó.', fr: 'La fenêtre Google a été fermée/bloquée.' },
    'auth.err.network': { pt: 'Sem conexão — tenta de novo.', en: 'No connection — try again.', es: 'Sin conexión — inténtalo de nuevo.', fr: 'Pas de connexion — réessayez.' },
    'auth.err.needName': { pt: 'Diz teu nome pra criar a conta.', en: 'Tell us your name to create the account.', es: 'Dinos tu nombre para crear la cuenta.', fr: 'Indiquez votre nom pour créer le compte.' },
    'auth.err.generic': { pt: 'Não deu — tenta de novo.', en: 'Something failed — try again.', es: 'Algo falló — inténtalo de nuevo.', fr: 'Échec — réessayez.' },
    // ---- Ranqueado / leaderboard --------------------------------------
    'or.ranked': { pt: 'ou joga valendo ranking', en: 'or play ranked', es: 'o juega clasificatoria', fr: 'ou jouez en classé' },
    'mode.ranked': { pt: 'Ranqueado', en: 'Ranked', es: 'Clasificatoria', fr: 'Classé' },
    'mode.rankedSub': { pt: '1v1 online · vale ELO', en: '1v1 online · ELO rated', es: '1v1 online · con ELO', fr: '1v1 en ligne · classé ELO' },
    'mode.lb': { pt: 'Ranking', en: 'Leaderboard', es: 'Ranking', fr: 'Classement' },
    'mode.lbSub': { pt: 'top da temporada', en: 'season top players', es: 'top de la temporada', fr: 'top de la saison' },
    'rk.searching': { pt: 'Procurando adversário… (deixa aberto!)', en: 'Searching for an opponent… (keep this open!)', es: 'Buscando rival… (¡no cierres!)', fr: 'Recherche d’un adversaire… (gardez la page ouverte !)' },
    'rk.needLogin': { pt: 'É preciso entrar (Google ou convidado) para jogar ranqueado.', en: 'You need to sign in (Google or guest) to play ranked.', es: 'Debes iniciar sesión (Google o invitado) para jugar clasificatoria.', fr: 'Connectez-vous (Google ou invité) pour jouer en classé.' },
    'auth.title': { pt: '🏆 Entrar para jogar ranqueado', en: '🏆 Sign in to play ranked', es: '🏆 Inicia sesión para jugar clasificatoria', fr: '🏆 Connectez-vous pour jouer en classé' },
    'auth.sub': { pt: 'Sua identidade protege o ranking contra trapaça.', en: 'Your identity protects the leaderboard from cheating.', es: 'Tu identidad protege el ranking contra trampas.', fr: 'Votre identité protège le classement contre la triche.' },
    'auth.google': { pt: 'Entrar com Google', en: 'Sign in with Google', es: 'Iniciar sesión con Google', fr: 'Se connecter avec Google' },
    'auth.guest': { pt: '🎭 Jogar como convidado', en: '🎭 Play as guest', es: '🎭 Jugar como invitado', fr: '🎭 Jouer en invité' },
    'auth.cancel': { pt: 'Cancelar', en: 'Cancel', es: 'Cancelar', fr: 'Annuler' },
    'auth.note': { pt: 'Convidado: seu ELO fica salvo só neste navegador. Com Google, vale em qualquer aparelho.', en: 'Guest: your ELO is saved in this browser only. With Google it follows you anywhere.', es: 'Invitado: tu ELO se guarda solo en este navegador. Con Google te sigue en cualquier dispositivo.', fr: 'Invité : votre ELO reste dans ce navigateur. Avec Google, il vous suit partout.' },
    'rk.connFail': { pt: 'Não deu para falar com o servidor ranqueado. Tenta de novo.', en: 'Could not reach the ranked server. Try again.', es: 'No se pudo conectar al servidor clasificatorio. Inténtalo de nuevo.', fr: 'Impossible de joindre le serveur classé. Réessayez.' },
    'rk.authFail': { pt: 'Conexão recusada (login inválido ou servidor fora).', en: 'Connection refused (invalid sign-in or server down).', es: 'Conexión rechazada (sesión inválida o servidor caído).', fr: 'Connexion refusée (session invalide ou serveur indisponible).' },
    'rk.wonWO': { pt: 'O adversário abandonou — vitória por W.O.!', en: 'Your opponent left — you win by forfeit!', es: 'Tu rival abandonó — ¡ganas por abandono!', fr: 'Votre adversaire a quitté — victoire par forfait !' },
    'rk.lostWO': { pt: 'Tempo esgotado/abandono — derrota por W.O.', en: 'Time out/abandon — you lose by forfeit.', es: 'Tiempo agotado/abandono — pierdes por abandono.', fr: 'Temps écoulé/abandon — défaite par forfait.' },
    'rk.eloDelta': { pt: 'ELO {delta}.', en: 'ELO {delta}.', es: 'ELO {delta}.', fr: 'ELO {delta}.' },
    'rk.again': { pt: '🏆 Buscar outra partida', en: '🏆 Find another match', es: '🏆 Buscar otra partida', fr: '🏆 Chercher une autre partie' },
    'lb.title': { pt: 'Temporada {season}', en: 'Season {season}', es: 'Temporada {season}', fr: 'Saison {season}' },
    'lb.close': { pt: 'Fechar', en: 'Close', es: 'Cerrar', fr: 'Fermer' },
    'lb.wl': { pt: '{w}V · {l}D', en: '{w}W · {l}L', es: '{w}V · {l}D', fr: '{w}V · {l}D' },
    'lb.empty': { pt: 'Ninguém no ranking ainda — seja o primeiro!', en: 'Nobody ranked yet — be the first!', es: 'Nadie en el ranking todavía — ¡sé el primero!', fr: 'Personne au classement — soyez le premier !' },
    // SEO — título e descrição por idioma (aplicados no <head> por updateHead)
    'meta.title': {
      pt: 'OrbitPool — Sinuca 8-Ball 3D Multiplayer Online Grátis',
      en: 'OrbitPool — Free Online 3D 8-Ball Pool Multiplayer',
      es: 'OrbitPool — Billar 8-Ball 3D Multijugador Online Gratis',
      fr: 'OrbitPool — Billard 8-Ball 3D Multijoueur en Ligne Gratuit',
    },
    'meta.desc': {
      pt: 'OrbitPool é um jogo de sinuca (8-Ball) 3D multiplayer online e gratuito. Jogue no navegador, sem instalar e sem cadastro: crie uma sala, envie o código a um amigo e joguem em tempo real.',
      en: 'OrbitPool is a free online 3D 8-Ball pool game you play in the browser — no install, no sign-up. Create a room, send the code to a friend and play real-time multiplayer.',
      es: 'OrbitPool es un juego de billar (8-Ball) 3D multijugador online y gratis. Juega en el navegador, sin instalar y sin registro: crea una sala, envía el código a un amigo y jueguen en tiempo real.',
      fr: 'OrbitPool est un jeu de billard (8-Ball) 3D multijoueur en ligne et gratuit. Jouez dans le navigateur, sans installation ni inscription : créez une salle, envoyez le code à un ami et jouez en temps réel.',
    },
    // SEO — H1 (texto para leitores de tela/crawlers) e bloco "Sobre / FAQ"
    'seo.h1': {
      pt: ' — Jogue Sinuca 8-Ball 3D Multiplayer Online Grátis, direto no navegador, sem instalar e sem cadastro',
      en: ' — Play Free Online 3D 8-Ball Pool Multiplayer, right in your browser, no install and no sign-up',
      es: ' — Juega al Billar 8-Ball 3D Multijugador Online Gratis, en el navegador, sin instalar y sin registro',
      fr: ' — Jouez au Billard 8-Ball 3D Multijoueur en Ligne Gratuit, dans le navigateur, sans installation ni inscription',
    },
    'about.toggle': { pt: 'ℹ Sobre o jogo & FAQ', en: 'ℹ About the game & FAQ', es: 'ℹ Sobre el juego y FAQ', fr: 'ℹ À propos du jeu & FAQ' },
    'about.h2': {
      pt: 'OrbitPool — sinuca 8-Ball 3D online e grátis',
      en: 'OrbitPool — free online 3D 8-Ball pool',
      es: 'OrbitPool — billar 8-Ball 3D online y gratis',
      fr: 'OrbitPool — billard 8-Ball 3D en ligne et gratuit',
    },
    'about.p1': {
      pt: 'O OrbitPool é um jogo de sinuca (bilhar 8-Ball) em 3D para jogar online, de graça e direto no navegador — sem baixar nada, sem instalar e sem cadastro. Crie uma sala, envie o código para um amigo e joguem uma partida de pool multiplayer em tempo real por conexão P2P. Funciona no computador e no celular (mouse ou toque).',
      en: 'OrbitPool is a 3D 8-Ball pool game you play online, for free and right in your browser — no download, no install and no sign-up. Create a room, send the code to a friend and play a real-time multiplayer pool match over a P2P connection. Works on desktop and mobile (mouse or touch).',
      es: 'OrbitPool es un juego de billar (8-Ball) en 3D para jugar online, gratis y directo en el navegador — sin descargar nada, sin instalar y sin registro. Crea una sala, envía el código a un amigo y jueguen una partida de billar multijugador en tiempo real por conexión P2P. Funciona en el ordenador y en el móvil (ratón o táctil).',
      fr: 'OrbitPool est un jeu de billard (8-Ball) en 3D à jouer en ligne, gratuitement et directement dans le navigateur — sans téléchargement, sans installation et sans inscription. Créez une salle, envoyez le code à un ami et jouez une partie de billard multijoueur en temps réel via une connexion P2P. Fonctionne sur ordinateur et mobile (souris ou tactile).',
    },
    'about.h3play': {
      pt: 'Como jogar sinuca online no OrbitPool',
      en: 'How to play pool online on OrbitPool',
      es: 'Cómo jugar al billar online en OrbitPool',
      fr: 'Comment jouer au billard en ligne sur OrbitPool',
    },
    'about.pplay': {
      pt: 'Mire com o mouse, segure CTRL e puxe para trás para carregar a força, e solte para dar a tacada. Use SHIFT para aplicar efeito (inglês, follow e draw), TAB para ver a mesa de cima e o scroll para dar zoom. Você também pode jogar contra o bot (treino) ou em duplas com os amigos.',
      en: 'Aim with the mouse, hold CTRL and pull back to charge power, then release to take the shot. Use SHIFT to apply spin (english, follow and draw), TAB for the top view and scroll to zoom. You can also play against the bot (practice) or in teams with friends.',
      es: 'Apunta con el ratón, mantén CTRL y tira hacia atrás para cargar la fuerza, y suelta para dar el golpe. Usa SHIFT para aplicar efecto (inglés, follow y draw), TAB para ver la mesa desde arriba y el scroll para acercar. También puedes jugar contra el bot (práctica) o en parejas con amigos.',
      fr: 'Visez avec la souris, maintenez CTRL et tirez vers l’arrière pour charger la puissance, puis relâchez pour tirer. Utilisez SHIFT pour appliquer l’effet (rétro, coulé et rappel), TAB pour la vue de dessus et la molette pour zoomer. Vous pouvez aussi jouer contre le bot (entraînement) ou en équipes avec des amis.',
    },
    'about.h3rules': {
      pt: 'Regras do 8-Ball', en: '8-Ball rules', es: 'Reglas del 8-Ball', fr: 'Règles du 8-Ball',
    },
    'about.prules': {
      pt: 'A mesa começa aberta. Quem encaçapa a primeira bola numerada define seu grupo: lisas (1–7) ou listradas (9–15). Acertou uma bola do seu grupo, continua jogando; errou, passa a vez. Faltas (branca na caçapa, não tocar em bola ou acertar a bola errada primeiro) dão bola na mão ao adversário. Você vence ao encaçapar a bola 8 depois de limpar todo o seu grupo.',
      en: 'The table starts open. Whoever pots the first numbered ball claims their group: solids (1–7) or stripes (9–15). Pot a ball from your group and you keep shooting; miss and it is the opponent’s turn. Fouls (potting the cue ball, hitting no ball, or hitting the wrong ball first) give the opponent ball in hand. You win by potting the 8-ball after clearing your whole group.',
      es: 'La mesa empieza abierta. Quien mete la primera bola numerada define su grupo: lisas (1–7) o rayadas (9–15). Si metes una bola de tu grupo sigues jugando; si fallas, pasa el turno. Las faltas (meter la blanca, no tocar bola o golpear primero la bola equivocada) dan bola en mano al rival. Ganas metiendo la bola 8 tras limpiar todo tu grupo.',
      fr: 'La table commence ouverte. Celui qui empoche la première bille numérotée choisit son groupe : pleines (1–7) ou rayées (9–15). Empochez une bille de votre groupe et vous rejouez ; ratez et c’est au tour de l’adversaire. Les fautes (bille blanche empochée, aucune bille touchée ou mauvaise bille touchée en premier) donnent bille en main à l’adversaire. Vous gagnez en empochant la bille 8 après avoir nettoyé tout votre groupe.',
    },
    'about.h3faq': {
      pt: 'Perguntas frequentes', en: 'Frequently asked questions', es: 'Preguntas frecuentes', fr: 'Questions fréquentes',
    },
    'about.q1': { pt: 'O OrbitPool é gratuito?', en: 'Is OrbitPool free?', es: '¿OrbitPool es gratis?', fr: 'OrbitPool est-il gratuit ?' },
    'about.a1': {
      pt: 'Sim, é 100% grátis e sem cadastro. Basta abrir no navegador e jogar.',
      en: 'Yes, it is 100% free with no sign-up. Just open it in your browser and play.',
      es: 'Sí, es 100% gratis y sin registro. Solo ábrelo en el navegador y juega.',
      fr: 'Oui, c’est 100% gratuit et sans inscription. Ouvrez-le simplement dans le navigateur et jouez.',
    },
    'about.q2': { pt: 'Preciso instalar alguma coisa?', en: 'Do I need to install anything?', es: '¿Necesito instalar algo?', fr: 'Dois-je installer quelque chose ?' },
    'about.a2': {
      pt: 'Não. O jogo roda direto no navegador (com WebGL) no PC ou no celular. Também dá para instalar como app (PWA), se quiser.',
      en: 'No. The game runs right in the browser (with WebGL) on PC or mobile. You can also install it as an app (PWA) if you like.',
      es: 'No. El juego funciona directo en el navegador (con WebGL) en PC o móvil. También puedes instalarlo como app (PWA) si quieres.',
      fr: 'Non. Le jeu tourne directement dans le navigateur (avec WebGL) sur PC ou mobile. Vous pouvez aussi l’installer comme application (PWA) si vous le souhaitez.',
    },
    'about.q3': { pt: 'Como jogo com um amigo?', en: 'How do I play with a friend?', es: '¿Cómo juego con un amigo?', fr: 'Comment jouer avec un ami ?' },
    'about.a3': {
      pt: 'Crie uma sala, copie o código e mande para o seu amigo. Quando ele entrar com o mesmo código, a partida multiplayer começa em tempo real.',
      en: 'Create a room, copy the code and send it to your friend. When they join with the same code, the real-time multiplayer match begins.',
      es: 'Crea una sala, copia el código y envíalo a tu amigo. Cuando entre con el mismo código, la partida multijugador comienza en tiempo real.',
      fr: 'Créez une salle, copiez le code et envoyez-le à votre ami. Dès qu’il rejoint avec le même code, la partie multijoueur en temps réel commence.',
    },
    'about.q4': { pt: 'Dá para jogar sozinho?', en: 'Can I play solo?', es: '¿Puedo jugar solo?', fr: 'Puis-je jouer en solo ?' },
    'about.a4': {
      pt: 'Sim. Há um modo de treino contra o bot, com opção de linha guia para praticar as tacadas.',
      en: 'Yes. There is a practice mode against the bot, with an optional guide line to practice your shots.',
      es: 'Sí. Hay un modo de práctica contra el bot, con línea guía opcional para practicar los golpes.',
      fr: 'Oui. Il y a un mode entraînement contre le bot, avec une ligne de visée optionnelle pour travailler vos tirs.',
    },
    'about.q5': { pt: 'Funciona no celular?', en: 'Does it work on mobile?', es: '¿Funciona en el móvil?', fr: 'Ça marche sur mobile ?' },
    'about.a5': {
      pt: 'Funciona. Os controles por toque aparecem automaticamente em telas de celular e tablet.',
      en: 'It does. Touch controls appear automatically on phone and tablet screens.',
      es: 'Sí. Los controles táctiles aparecen automáticamente en pantallas de móvil y tablet.',
      fr: 'Oui. Les commandes tactiles apparaissent automatiquement sur les écrans de téléphone et tablette.',
    },
    // ===== Lobby (letreiro + quadro) =====
    'lobby.badge': { en: '🍺 up for a game of pool?', pt: '🍺 bora jogar uma sinuca?', es: '🍺 ¿echamos una partida de billar?', fr: '🍺 on se fait un billard ?' },
    'lobby.tagline': { en: '~ dive bar pool ~', pt: '~ sinuca de boteco ~', es: '~ billar de cantina ~', fr: '~ billard de bistrot ~' },
    'lobby.sub': {
      en: 'Good old 8-ball to play with your crew. Set up a table, send the code to the group chat and go — no sign-up, no fuss.',
      pt: 'Aquele 8-ball raiz pra jogar com a galera. Cria a mesa, manda o código no grupo do zap e bora — sem cadastro, sem frescura.',
      es: 'El 8-ball de toda la vida para jugar con tus amigos. Crea la mesa, manda el código al grupo y listo — sin registro, sin complicaciones.',
      fr: 'Le bon vieux 8-ball à jouer entre potes. Crée la table, envoie le code au groupe et c\'est parti — sans inscription, sans prise de tête.',
    },
    'beer.cap': { en: 'dirty glass', pt: 'copo sujo', es: 'vaso sucio', fr: 'verre sale' },
    'howto.head': { en: 'how to play:', pt: 'como joga:', es: 'cómo se juega:', fr: 'comment jouer :' },
    'howto.mouse': { en: 'aim · ↑↓ camera', pt: 'mira · ↑↓ câmera', es: 'apuntar · ↑↓ cámara', fr: 'viser · ↑↓ caméra' },
    'howto.ctrl': { en: 'hold & pull = power', pt: 'segura e puxa = força', es: 'mantén y tira = fuerza', fr: 'maintiens et tire = force' },
    'howto.shift': { en: 'adjust spin', pt: 'ajusta o efeito', es: 'ajusta el efecto', fr: 'règle l\'effet' },
    'howto.tab': { en: 'top view', pt: 'vê de cima', es: 'vista desde arriba', fr: 'vue du dessus' },
    'howto.scroll': { en: 'zoom in', pt: 'chega mais perto', es: 'acércate', fr: 'zoomer' },
    'howto.esc': { en: 'pause / quit', pt: 'pausa / sai', es: 'pausa / salir', fr: 'pause / quitter' },
    'card.title': { en: 'Today\'s Menu', pt: 'Menu do Dia', es: 'Menú del Día', fr: 'Menu du Jour' },
    'card.sub': { en: '— pool night tonight —', pt: '— hoje tem sinuca —', es: '— hoy hay billar —', fr: '— ce soir, billard —' },
    'field.nick': { en: 'your nickname', pt: 'seu apelido', es: 'tu apodo', fr: 'ton pseudo' },
    'nick.ph': { en: 'e.g. Eightball Eddie', pt: 'Ex: Zé da Tacada', es: 'Ej: Mano de Tiza', fr: 'Ex : Roi de la Craie' },
    'field.open': { en: 'open a table', pt: 'abrir a mesa', es: 'abrir la mesa', fr: 'ouvrir la table' },
    'mode.1v1': { en: 'classic match', pt: 'partida clássica', es: 'partida clásica', fr: 'partie classique' },
    'mode.2v2': { en: 'teams · 4 players', pt: 'duplas · 4 jogadores', es: 'parejas · 4 jugadores', fr: 'équipes · 4 joueurs' },
    'share.lbl': { en: 'send this code to your friends:', pt: 'manda esse código pros amigos:', es: 'manda este código a tus amigos:', fr: 'envoie ce code à tes amis :' },
    'btn.copy': { en: 'Copy', pt: 'Copiar', es: 'Copiar', fr: 'Copier' },
    'btn.copied': { en: 'Copied!', pt: 'Copiado!', es: '¡Copiado!', fr: 'Copié !' },
    'or.join': { en: 'or join your friends\' table', pt: 'ou entra na dos amigos', es: 'o entra en la de tus amigos', fr: 'ou rejoins celle de tes amis' },
    'btn.join': { en: 'Join', pt: 'Entrar', es: 'Entrar', fr: 'Rejoindre' },
    'or.bot': { en: 'or practice against the bot', pt: 'ou treina com o bot', es: 'o entrena con el bot', fr: 'ou entraîne-toi contre le bot' },
    'bot.beginner': { en: 'Beginner', pt: 'Iniciante', es: 'Principiante', fr: 'Débutant' },
    'bot.amateur': { en: 'Amateur', pt: 'Amador', es: 'Aficionado', fr: 'Amateur' },
    'bot.pro': { en: 'Pro', pt: 'Pro', es: 'Pro', fr: 'Pro' },
    'bot.goat': { en: '🐐 Mineirinho de Araxá', pt: '🐐 Mineirinho de Araxá', es: '🐐 Mineirinho de Araxá', fr: '🐐 Mineirinho de Araxá' },
    'hint.p2p': {
      en: 'Direct connection between you. No server, no account — just show up and play. To test solo, open two tabs.',
      pt: 'Conexão direta entre vocês. Zero servidor, zero conta — é só chegar e jogar. Pra testar sozinho, abre em duas abas.',
      es: 'Conexión directa entre ustedes. Cero servidor, cero cuenta — llega y juega. Para probar solo, abre dos pestañas.',
      fr: 'Connexion directe entre vous. Zéro serveur, zéro compte — tu arrives et tu joues. Pour tester seul, ouvre deux onglets.',
    },
    'hint.credit': {
      en: '3D table: “Billiard Table” by <a href="https://sketchfab.com/futurealiti" target="_blank" rel="noopener">Futurealiti</a> (<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC-BY-4.0</a>).',
      pt: 'Mesa 3D: “Billiard Table” de <a href="https://sketchfab.com/futurealiti" target="_blank" rel="noopener">Futurealiti</a> (<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC-BY-4.0</a>).',
      es: 'Mesa 3D: “Billiard Table” de <a href="https://sketchfab.com/futurealiti" target="_blank" rel="noopener">Futurealiti</a> (<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC-BY-4.0</a>).',
      fr: 'Table 3D : « Billiard Table » par <a href="https://sketchfab.com/futurealiti" target="_blank" rel="noopener">Futurealiti</a> (<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC-BY-4.0</a>).',
    },
    'lang.label': { en: 'Language', pt: 'Idioma', es: 'Idioma', fr: 'Langue' },

    // ===== HUD =====
    'hud.player': { en: 'Player', pt: 'Jogador', es: 'Jugador', fr: 'Joueur' },
    'hud.playerN': { en: 'Player {n}', pt: 'Jogador {n}', es: 'Jugador {n}', fr: 'Joueur {n}' },
    'default.you': { en: 'You', pt: 'Você', es: 'Tú', fr: 'Toi' },
    'default.opp': { en: 'Opponent', pt: 'Adversário', es: 'Rival', fr: 'Adversaire' },
    'tag.you': { en: 'YOU', pt: 'VOCÊ', es: 'TÚ', fr: 'TOI' },
    'tag.turn': { en: 'TURN', pt: 'NA VEZ', es: 'TURNO', fr: 'AU TOUR' },
    'grp.open': { en: 'open table', pt: 'mesa aberta', es: 'mesa abierta', fr: 'table ouverte' },
    'grp.solids': { en: 'solids', pt: 'lisas', es: 'lisas', fr: 'pleines' },
    'grp.stripes': { en: 'stripes', pt: 'listradas', es: 'rayadas', fr: 'rayées' },
    'sb.series': { en: 'BEST OF {n}', pt: 'MELHOR DE {n}', es: 'MEJOR DE {n}', fr: 'MEILLEUR DES {n}' },
    'sb.single': { en: 'SINGLE GAME', pt: 'PARTIDA ÚNICA', es: 'PARTIDA ÚNICA', fr: 'PARTIE UNIQUE' },
    'tl.series': { en: 'best-of-3 series', pt: 'série melhor de 3', es: 'serie al mejor de 3', fr: 'série au meilleur des 3' },
    'btn.playAgain': { en: '🎱 Play again', pt: '🎱 Jogar de novo', es: '🎱 Jugar de nuevo', fr: '🎱 Rejouer' },
    'hud.controls': { en: 'CONTROLS', pt: 'CONTROLES', es: 'CONTROLES', fr: 'COMMANDES' },
    'k.click': { en: 'Click', pt: 'Clique', es: 'Clic', fr: 'Clic' },
    'd.click': { en: 'lock cursor', pt: 'travar cursor', es: 'bloquear cursor', fr: 'verrouiller le curseur' },
    'd.mouse': { en: 'turn the cue · ↑↓ camera height', pt: 'girar o taco · ↑↓ altura da câmera', es: 'girar el taco · ↑↓ altura de cámara', fr: 'tourner la queue · ↑↓ hauteur de caméra' },
    'd.ctrl': { en: 'hold + pull = power · release = shoot', pt: 'segurar + puxar = força · soltar = tacar', es: 'mantén + tira = fuerza · suelta = tirar', fr: 'maintenir + tirer = force · relâcher = tirer' },
    'd.shift': { en: 'adjust spin', pt: 'ajustar efeito', es: 'ajustar efecto', fr: 'régler l\'effet' },
    'd.tab': { en: 'top view', pt: 'ver de cima', es: 'vista superior', fr: 'vue du dessus' },
    'd.scroll': { en: 'zoom', pt: 'zoom', es: 'zoom', fr: 'zoom' },
    'd.music': { en: 'music: next · previous · pause', pt: 'música: próxima · anterior · pausar', es: 'música: siguiente · anterior · pausa', fr: 'musique : suivante · précédente · pause' },
    'd.esc': { en: 'menu (pause / settings / quit)', pt: 'menu (pausa / config / sair)', es: 'menú (pausa / ajustes / salir)', fr: 'menu (pause / réglages / quitter)' },
    'status.connecting': { en: 'Connecting…', pt: 'Conectando...', es: 'Conectando…', fr: 'Connexion…' },
    'hud.effect': { en: 'SPIN', pt: 'EFEITO', es: 'EFECTO', fr: 'EFFET' },
    'hud.power': { en: 'POWER', pt: 'FORÇA', es: 'FUERZA', fr: 'FORCE' },
    'hud.holdpull': { en: 'hold + pull', pt: 'segurar + puxar', es: 'mantén + tira', fr: 'maintenir + tirer' },
    'contact.lbl': { en: 'spin / contact point', pt: 'efeito / ponto de contato', es: 'efecto / punto de contacto', fr: 'effet / point de contact' },

    // ===== Controles touch (mobile) =====
    'mb.menu': { en: 'menu', pt: 'menu', es: 'menú', fr: 'menu' },
    'mb.top': { en: 'top', pt: 'de cima', es: 'arriba', fr: 'dessus' },
    'mb.cam': { en: 'camera', pt: 'câmera', es: 'cámara', fr: 'caméra' },
    'mb.spin': { en: 'spin', pt: 'efeito', es: 'efecto', fr: 'effet' },
    'mb.music': { en: 'music', pt: 'música', es: 'música', fr: 'musique' },
    'mb.power': { en: 'power ↓', pt: 'força ↓', es: 'fuerza ↓', fr: 'force ↓' },
    'mb.ariaTop': { en: 'top view', pt: 'ver de cima', es: 'vista superior', fr: 'vue du dessus' },
    'mb.ariaCam': { en: 'camera height', pt: 'altura da câmera', es: 'altura de la cámara', fr: 'hauteur de la caméra' },
    'mb.ariaSpin': { en: 'spin', pt: 'efeito', es: 'efecto', fr: 'effet' },
    'mb.ariaMusic': { en: 'next track', pt: 'próxima música', es: 'siguiente canción', fr: 'piste suivante' },
    'mb.aimL': { en: 'rotate aim left', pt: 'girar mira à esquerda', es: 'girar mira a la izquierda', fr: 'tourner la visée à gauche' },
    'mb.aimR': { en: 'rotate aim right', pt: 'girar mira à direita', es: 'girar mira a la derecha', fr: 'tourner la visée à droite' },
    'ps.aria': { en: 'shot power', pt: 'força da tacada', es: 'fuerza del tiro', fr: 'force du tir' },

    // ===== Lobby de duplas (2v2) =====
    'tl.title': { en: '🤝 Teams — room', pt: '🤝 Duplas — sala', es: '🤝 Parejas — sala', fr: '🤝 Équipes — salle' },
    'tl.sub': {
      en: 'The room creator sets the teams. Rotation: A1 → B1 → A2 → B2.',
      pt: 'O criador da sala monta os times. Rotação: A1 → B1 → A2 → B2.',
      es: 'El creador de la sala arma los equipos. Rotación: A1 → B1 → A2 → B2.',
      fr: 'Le créateur de la salle compose les équipes. Rotation : A1 → B1 → A2 → B2.',
    },
    'tl.random': { en: '🎲 Random teams', pt: '🎲 Times aleatórios', es: '🎲 Equipos aleatorios', fr: '🎲 Équipes aléatoires' },
    'tl.start': { en: 'Start match', pt: 'Começar partida', es: 'Empezar partida', fr: 'Lancer la partie' },
    'tl.waitPlayer': { en: 'Waiting for player…', pt: 'Aguardando jogador…', es: 'Esperando jugador…', fr: 'En attente d\'un joueur…' },
    'tl.teamA': { en: 'Team A', pt: 'Time A', es: 'Equipo A', fr: 'Équipe A' },
    'tl.teamB': { en: 'Team B', pt: 'Time B', es: 'Equipo B', fr: 'Équipe B' },
    'tl.you': { en: ' (you)', pt: ' (você)', es: ' (tú)', fr: ' (toi)' },
    'tl.waiting': { en: 'Waiting for players ({n}/4)… Room code: {code}', pt: 'Aguardando jogadores ({n}/4)… Código da sala: {code}', es: 'Esperando jugadores ({n}/4)… Código de sala: {code}', fr: 'En attente de joueurs ({n}/4)… Code de la salle : {code}' },
    'tl.balance': { en: 'Each team needs 2 players.', pt: 'Os times precisam ter 2 jogadores cada.', es: 'Cada equipo necesita 2 jugadores.', fr: 'Chaque équipe doit avoir 2 joueurs.' },
    'tl.ready': { en: 'All set! You can start.', pt: 'Tudo pronto! Pode começar.', es: '¡Todo listo! Puedes empezar.', fr: 'Tout est prêt ! Tu peux lancer.' },
    'tl.waitHost': { en: 'Waiting for the host to start the match…', pt: 'Aguardando o host começar a partida…', es: 'Esperando a que el anfitrión empiece…', fr: 'En attente du lancement par l\'hôte…' },
    'tl.close': { en: '✖ Close room', pt: '✖ Fechar sala', es: '✖ Cerrar sala', fr: '✖ Fermer la salle' },
    'tl.leave': { en: '✖ Leave room', pt: '✖ Sair da sala', es: '✖ Salir de la sala', fr: '✖ Quitter la salle' },
    'tl.closed': { en: 'The host closed the room.', pt: 'O criador fechou a sala.', es: 'El anfitrión cerró la sala.', fr: 'L\'hôte a fermé la salle.' },
    'tl.closedByYou': { en: 'Room closed.', pt: 'Sala fechada.', es: 'Sala cerrada.', fr: 'Salle fermée.' },
    'tl.leftByYou': { en: 'You left the room.', pt: 'Você saiu da sala.', es: 'Saliste de la sala.', fr: 'Tu as quitté la salle.' },

    // ===== Modal de GPU / WebGL =====
    'gpu.slow.title': { en: '🐢 Running in slow mode…', pt: '🐢 Tá rodando no modo lento…', es: '🐢 Va en modo lento…', fr: '🐢 Ça tourne au ralenti…' },
    'gpu.slow.body': {
      en: 'Your browser\'s <b>hardware acceleration</b> is off — the game works, but without the GPU it stutters and lags. Turning it on makes the experience <b>much</b> better.',
      pt: 'A <b>aceleração gráfica</b> do seu navegador está desativada — o jogo funciona, mas sem usar a placa de vídeo ele trava e engasga. Ativando, a experiência melhora <b>muito</b>.',
      es: 'La <b>aceleración gráfica</b> de tu navegador está desactivada — el juego funciona, pero sin la tarjeta gráfica se traba. Activándola, la experiencia mejora <b>mucho</b>.',
      fr: 'L\'<b>accélération matérielle</b> de ton navigateur est désactivée — le jeu fonctionne, mais sans carte graphique ça rame. En l\'activant, l\'expérience est <b>bien</b> meilleure.',
    },
    'gpu.playAnyway': { en: 'Play anyway', pt: 'Jogar assim mesmo', es: 'Jugar igual', fr: 'Jouer quand même' },
    'gpu.nowebgl.title': { en: '😵 This browser has no WebGL', pt: '😵 Este navegador está sem WebGL', es: '😵 Este navegador no tiene WebGL', fr: '😵 Ce navigateur n\'a pas WebGL' },
    'gpu.nowebgl.body': {
      en: 'The game is 3D and needs <b>WebGL</b> to draw the table — it usually disappears when the browser\'s <b>hardware acceleration</b> is off. Turn it on, restart the browser and reload this page. You can check the status at <b>chrome://gpu</b>.',
      pt: 'O jogo é 3D e precisa de <b>WebGL</b> para desenhar a mesa — normalmente ele some quando a <b>aceleração de hardware</b> do navegador está desativada. Ative, reinicie o navegador e recarregue esta página. Dá pra conferir o estado em <b>chrome://gpu</b>.',
      es: 'El juego es 3D y necesita <b>WebGL</b> para dibujar la mesa — suele desaparecer cuando la <b>aceleración de hardware</b> del navegador está desactivada. Actívala, reinicia el navegador y recarga esta página. Puedes verificar el estado en <b>chrome://gpu</b>.',
      fr: 'Le jeu est en 3D et a besoin de <b>WebGL</b> pour dessiner la table — il disparaît généralement quand l\'<b>accélération matérielle</b> du navigateur est désactivée. Active-la, redémarre le navigateur et recharge cette page. Tu peux vérifier l\'état sur <b>chrome://gpu</b>.',
    },
    'gpu.ok': { en: 'Got it', pt: 'Entendi', es: 'Entendido', fr: 'Compris' },
    'gpu.open': { en: '🔧 Open browser settings', pt: '🔧 Abrir configurações do navegador', es: '🔧 Abrir ajustes del navegador', fr: '🔧 Ouvrir les réglages du navigateur' },
    'gpu.copied': { en: '✓ Address copied! Paste it in a new tab', pt: '✓ Endereço copiado! Cola numa aba nova', es: '✓ ¡Dirección copiada! Pégala en una pestaña nueva', fr: '✓ Adresse copiée ! Colle-la dans un nouvel onglet' },
    'gpu.hint': {
      en: 'Turn on “Use hardware acceleration when available”, restart your browser and come back.',
      pt: 'Ative “Usar aceleração de hardware quando disponível”, reinicie o navegador e volte aqui.',
      es: 'Activa «Usar aceleración de hardware cuando esté disponible», reinicia el navegador y vuelve.',
      fr: 'Active « Utiliser l\'accélération matérielle si disponible », redémarre le navigateur et reviens.',
    },
    'gpu.noWebglLobby': {
      en: '⚠️ The game can\'t run without WebGL — enable graphics acceleration and reload.',
      pt: '⚠️ Sem WebGL o jogo não roda — ative a aceleração gráfica e recarregue.',
      es: '⚠️ Sin WebGL el juego no funciona — activa la aceleración gráfica y recarga.',
      fr: '⚠️ Sans WebGL le jeu ne peut pas tourner — active l\'accélération graphique et recharge.',
    },

    // ===== Fim de jogo / série =====
    'end.title': { en: 'Game over', pt: 'Fim de jogo', es: 'Fin del juego', fr: 'Fin de partie' },
    'btn.rematch': { en: 'Play again', pt: 'Jogar de novo', es: 'Jugar de nuevo', fr: 'Rejouer' },
    'end.waitingOpp': { en: 'Waiting for the opponent…', pt: 'Aguardando o adversário...', es: 'Esperando al rival…', fr: 'En attente de l\'adversaire…' },
    'end.wonSeries.you': { en: '🏆 You won the best of 3!', pt: '🏆 Você venceu o melhor de 3!', es: '🏆 ¡Ganaste el mejor de 3!', fr: '🏆 Tu as gagné le meilleur des 3 !' },
    'end.wonSeries.team': { en: '🏆 Your team won the best of 3!', pt: '🏆 Seu time venceu o melhor de 3!', es: '🏆 ¡Tu equipo ganó el mejor de 3!', fr: '🏆 Ton équipe a gagné le meilleur des 3 !' },
    'end.lostSeries.you': { en: '😞 You lost the best of 3', pt: '😞 Você perdeu o melhor de 3', es: '😞 Perdiste el mejor de 3', fr: '😞 Tu as perdu le meilleur des 3' },
    'end.lostSeries.team': { en: '😞 Your team lost the best of 3', pt: '😞 Seu time perdeu o melhor de 3', es: '😞 Tu equipo perdió el mejor de 3', fr: '😞 Ton équipe a perdu le meilleur des 3' },
    'end.finalScore': { en: 'Final score: {a} – {b}.', pt: 'Placar final: {a} – {b}.', es: 'Marcador final: {a} – {b}.', fr: 'Score final : {a} – {b}.' },
    'btn.newSeries': { en: 'New series', pt: 'Nova série', es: 'Nueva serie', fr: 'Nouvelle série' },
    'end.wonGame.you': { en: '🎉 You won the game!', pt: '🎉 Você venceu a partida!', es: '🎉 ¡Ganaste la partida!', fr: '🎉 Tu as gagné la partie !' },
    'end.wonGame.team': { en: '🎉 Your team won the game!', pt: '🎉 Seu time venceu a partida!', es: '🎉 ¡Tu equipo ganó la partida!', fr: '🎉 Ton équipe a gagné la partie !' },
    'end.lostGame.you': { en: 'You lost the game', pt: 'Você perdeu a partida', es: 'Perdiste la partida', fr: 'Tu as perdu la partie' },
    'end.lostGame.team': { en: 'Your team lost the game', pt: 'Seu time perdeu a partida', es: 'Tu equipo perdió la partida', fr: 'Ton équipe a perdu la partie' },
    'end.seriesScore': { en: 'Series score: {a} – {b}.', pt: 'Placar da série: {a} – {b}.', es: 'Marcador de la serie: {a} – {b}.', fr: 'Score de la série : {a} – {b}.' },
    'btn.nextGame': { en: 'Next game', pt: 'Próxima partida', es: 'Siguiente partida', fr: 'Partie suivante' },

    // ===== Regras / mensagens de jogo =====
    'foul.noContact': { en: 'the cue ball didn\'t touch any ball', pt: 'a branca não tocou em nenhuma bola', es: 'la blanca no tocó ninguna bola', fr: 'la blanche n\'a touché aucune bille' },
    'foul.scratch': { en: 'the cue ball was potted (scratch)', pt: 'a branca caiu (scratch)', es: 'la blanca cayó (scratch)', fr: 'la blanche est tombée (scratch)' },
    'foul.eightFirstOpen': { en: 'hit the 8 first on an open table', pt: 'acertou a 8 primeiro com a mesa aberta', es: 'golpeó la 8 primero con mesa abierta', fr: 'a touché la 8 en premier sur table ouverte' },
    'foul.mustHit8': { en: 'should have hit the 8 first', pt: 'devia acertar a 8 primeiro', es: 'debía golpear la 8 primero', fr: 'devait toucher la 8 en premier' },
    'foul.wrongGroup': { en: 'hit the opponent\'s ball first', pt: 'acertou a bola do adversário primeiro', es: 'golpeó la bola del rival primero', fr: 'a touché la bille adverse en premier' },
    'msg.win8': { en: '8-ball potted! {team} wins! 🏆', pt: 'Bola 8 encaçapada! {team} venceu! 🏆', es: '¡Bola 8 embocada! ¡{team} ganó! 🏆', fr: 'Bille 8 empochée ! {team} gagne ! 🏆' },
    'msg.lose8': { en: '{name} potted the 8 too early. {team} wins!', pt: '{name} encaçapou a 8 fora de hora. {team} venceu!', es: '{name} embocó la 8 antes de tiempo. ¡{team} ganó!', fr: '{name} a empoché la 8 trop tôt. {team} gagne !' },
    'msg.groups': { en: '{team} got the {group}.', pt: '{team} ficou com as {group}.', es: '{team} se queda con las {group}.', fr: '{team} prend les {group}.' },
    'msg.continue': { en: '{name} potted and shoots again.', pt: '{name} encaçapou e continua.', es: '{name} embocó y sigue.', fr: '{name} a empoché et continue.' },
    'msg.oppBall': { en: '{name} potted an opponent\'s ball. Turn passes.', pt: '{name} encaçapou bola do adversário. Passa a vez.', es: '{name} embocó una bola del rival. Pasa el turno.', fr: '{name} a empoché une bille adverse. Au suivant.' },
    'msg.foul': { en: 'Foul: {reason}. {name} plays with ball in hand.', pt: 'Falta: {reason}. {name} joga com a bola na mão.', es: 'Falta: {reason}. {name} juega con bola en mano.', fr: 'Faute : {reason}. {name} joue avec bille en main.' },
    'msg.turnOf': { en: '{name}\'s turn.', pt: 'Vez de {name}.', es: 'Turno de {name}.', fr: 'Au tour de {name}.' },
    'msg.miscue': { en: 'Miscue! Weak shot.', pt: 'Miscue! Tacada fraca.', es: '¡Miscue! Tiro flojo.', fr: 'Fausse queue ! Coup raté.' },

    // ===== Banner da vez =====
    'ban.teamWon': { en: 'YOUR TEAM WON', pt: 'SEU TIME VENCEU', es: 'TU EQUIPO GANÓ', fr: 'TON ÉQUIPE A GAGNÉ' },
    'ban.youWon': { en: 'YOU WON', pt: 'VOCÊ VENCEU', es: 'GANASTE', fr: 'TU AS GAGNÉ' },
    'ban.gameOver': { en: 'GAME OVER', pt: 'FIM DE JOGO', es: 'FIN DEL JUEGO', fr: 'FIN DE PARTIE' },
    'ban.bihTouch': { en: 'BALL IN HAND — TAP THE FELT', pt: 'BOLA NA MÃO — TOQUE NO PANO', es: 'BOLA EN MANO — TOCA EL PAÑO', fr: 'BILLE EN MAIN — TOUCHE LE TAPIS' },
    'ban.bih': { en: 'BALL IN HAND', pt: 'BOLA NA MÃO', es: 'BOLA EN MANO', fr: 'BILLE EN MAIN' },
    'ban.yourTurnDrag': { en: 'YOUR TURN — DRAG TO AIM', pt: 'SUA VEZ — ARRASTA P/ MIRAR', es: 'TU TURNO — ARRASTRA PARA APUNTAR', fr: 'À TOI — GLISSE POUR VISER' },
    'ban.clickAim': { en: 'CLICK TO AIM', pt: 'CLIQUE PARA MIRAR', es: 'CLIC PARA APUNTAR', fr: 'CLIQUE POUR VISER' },
    'ban.yourTurn': { en: 'YOUR TURN', pt: 'SUA VEZ', es: 'TU TURNO', fr: 'À TOI DE JOUER' },
    'ban.turnOf': { en: '{name}\'S TURN', pt: 'VEZ DE {name}', es: 'TURNO DE {name}', fr: 'AU TOUR DE {name}' },
    'ban.partner': { en: ' (YOUR PARTNER)', pt: ' (SUA DUPLA)', es: ' (TU PAREJA)', fr: ' (TON COÉQUIPIER)' },

    // ===== Status transitórios =====
    'st.placedAim': { en: 'Ball placed. Move the mouse to aim.', pt: 'Bola posicionada. Mova o mouse para mirar.', es: 'Bola colocada. Mueve el ratón para apuntar.', fr: 'Bille placée. Bouge la souris pour viser.' },
    'st.placed': { en: 'Ball placed.', pt: 'Bola posicionada.', es: 'Bola colocada.', fr: 'Bille placée.' },
    'st.left': { en: '{name} left — they can come back using the room code.', pt: '{name} saiu — ele pode voltar entrando com o código da sala.', es: '{name} salió — puede volver con el código de la sala.', fr: '{name} est parti — il peut revenir avec le code de la salle.' },
    'st.rejoined': { en: '{name} is back at the table!', pt: '{name} voltou à mesa!', es: '¡{name} volvió a la mesa!', fr: '{name} est de retour à la table !' },
    'st.reconnected': { en: 'Reconnected! The game goes on. 🎱', pt: 'Reconectado! A partida continua. 🎱', es: '¡Reconectado! La partida continúa. 🎱', fr: 'Reconnecté ! La partie continue. 🎱' },
    'st.botThinking': { en: '🤖 {name} is thinking…', pt: '🤖 {name} está pensando…', es: '🤖 {name} está pensando…', fr: '🤖 {name} réfléchit…' },
    'music.paused': { en: '⏸ music paused', pt: '⏸ música pausada', es: '⏸ música en pausa', fr: '⏸ musique en pause' },

    // ===== Mensagens do lobby =====
    'lm.joined': { en: 'Joined as Player {n}.', pt: 'Entrou como Jogador {n}.', es: 'Entraste como Jugador {n}.', fr: 'Connecté comme Joueur {n}.' },
    'lm.waitingOthers': { en: ' Waiting for the other players…', pt: ' Aguardando os outros jogadores...', es: ' Esperando a los demás jugadores…', fr: ' En attente des autres joueurs…' },
    'lm.joinedRoom': { en: 'Joined the room as Player {n}.', pt: 'Entrou na sala como Jogador {n}.', es: 'Entraste en la sala como Jugador {n}.', fr: 'Tu as rejoint la salle comme Joueur {n}.' },
    'lm.waiting4': { en: 'Waiting for all 4 players to join…', pt: 'Aguardando os 4 jogadores entrarem na sala...', es: 'Esperando a que entren los 4 jugadores…', fr: 'En attente des 4 joueurs…' },
    'lm.waiting2': { en: 'Waiting for the second player to join…', pt: 'Aguardando o segundo jogador entrar na sala...', es: 'Esperando al segundo jugador…', fr: 'En attente du deuxième joueur…' },
    'lm.full': { en: 'Room full (or game already started)! Try another room.', pt: 'Sala cheia (ou partida já começou)! Tente outra sala.', es: '¡Sala llena (o la partida ya empezó)! Prueba otra sala.', fr: 'Salle pleine (ou partie déjà commencée) ! Essaie une autre salle.' },
    'lm.nameRequired': { en: '✍️ Enter your name to play.', pt: '✍️ Digite seu nome para jogar.', es: '✍️ Escribe tu nombre para jugar.', fr: '✍️ Entre ton nom pour jouer.' },
    'lm.created4': { en: '2v2 room created. Send the code to the other 3 players…', pt: 'Sala 2v2 criada. Envie o código para os outros 3 jogadores...', es: 'Sala 2v2 creada. Envía el código a los otros 3 jugadores…', fr: 'Salle 2v2 créée. Envoie le code aux 3 autres joueurs…' },
    'lm.created2': { en: 'Room created. Waiting for your opponent to join with the code…', pt: 'Sala criada. Aguardando o adversário entrar com o código...', es: 'Sala creada. Esperando a que el rival entre con el código…', fr: 'Salle créée. En attente de l\'adversaire avec le code…' },
    'lm.enterCode': { en: 'Enter the room code the host sent you.', pt: 'Digite o código da sala que o host te enviou.', es: 'Escribe el código de sala que te envió el anfitrión.', fr: 'Entre le code de salle envoyé par l\'hôte.' },
    'lm.connectingRoom': { en: 'Connecting to room {code}…', pt: 'Conectando à sala {code}...', es: 'Conectando a la sala {code}…', fr: 'Connexion à la salle {code}…' },
    'lm.netError': { en: 'Network error.', pt: 'Erro de rede.', es: 'Error de red.', fr: 'Erreur réseau.' },

    // ===== Nomes de bot / time =====
    'botname.iniciante': { en: 'Beginner Bot', pt: 'Bot Iniciante', es: 'Bot Principiante', fr: 'Bot Débutant' },
    'botname.amador': { en: 'Amateur Bot', pt: 'Bot Amador', es: 'Bot Aficionado', fr: 'Bot Amateur' },
    'botname.pro': { en: 'Pro Bot', pt: 'Bot Pro', es: 'Bot Pro', fr: 'Bot Pro' },
    'botname.mineirinho': { en: 'Mineirinho de Araxá', pt: 'Mineirinho de Araxá', es: 'Mineirinho de Araxá', fr: 'Mineirinho de Araxá' },
    'botname.default': { en: 'Bot', pt: 'Bot', es: 'Bot', fr: 'Bot' },
    'team.n': { en: 'Team {n}', pt: 'Time {n}', es: 'Equipo {n}', fr: 'Équipe {n}' },

    // ===== Rede (net.js) =====
    'net.closed': { en: 'Connection to the server closed. Reload the page.', pt: 'Conexão com o servidor encerrada. Recarregue a página.', es: 'Conexión con el servidor cerrada. Recarga la página.', fr: 'Connexion au serveur fermée. Recharge la page.' },
    'net.serverFail': { en: 'Couldn\'t connect to the server.', pt: 'Não foi possível conectar ao servidor.', es: 'No se pudo conectar al servidor.', fr: 'Impossible de se connecter au serveur.' },
    'net.noPeer': { en: 'The P2P network (PeerJS) didn\'t load. Check your connection/blockers.', pt: 'A rede P2P (PeerJS) não carregou. Verifique sua conexão/bloqueadores.', es: 'La red P2P (PeerJS) no cargó. Revisa tu conexión/bloqueadores.', fr: 'Le réseau P2P (PeerJS) n\'a pas chargé. Vérifie ta connexion/bloqueurs.' },
    'net.codeTaken': { en: 'That room code is already in use. Create another room.', pt: 'Esse código de sala já está em uso. Crie outra sala.', es: 'Ese código de sala ya está en uso. Crea otra sala.', fr: 'Ce code de salle est déjà utilisé. Crée une autre salle.' },
    'net.error': { en: 'Network error: {err}', pt: 'Erro de rede: {err}', es: 'Error de red: {err}', fr: 'Erreur réseau : {err}' },
    'net.timeout': { en: 'Couldn\'t find the room. Check the code (the host must have created the room and be online).', pt: 'Não encontrei a sala. Confira o código (o host precisa ter criado a sala e estar online).', es: 'No encontré la sala. Revisa el código (el anfitrión debe haber creado la sala y estar en línea).', fr: 'Salle introuvable. Vérifie le code (l\'hôte doit avoir créé la salle et être en ligne).' },
    'net.notFound': { en: 'Room not found. Check the code and try again.', pt: 'Sala não encontrada. Confira o código e tente de novo.', es: 'Sala no encontrada. Revisa el código e inténtalo de nuevo.', fr: 'Salle introuvable. Vérifie le code et réessaie.' },

    // ===== Menu de pausa / configurações (menu.js) =====
    'menu.pause': { en: '⏸ Paused', pt: '⏸ Pausa', es: '⏸ Pausa', fr: '⏸ Pause' },
    'menu.paused': { en: 'Game paused', pt: 'Jogo pausado', es: 'Juego en pausa', fr: 'Jeu en pause' },
    'menu.resume': { en: 'Resume', pt: 'Continuar', es: 'Continuar', fr: 'Reprendre' },
    'menu.settings': { en: '⚙ Settings', pt: '⚙ Configurações', es: '⚙ Ajustes', fr: '⚙ Réglages' },
    'menu.quit': { en: 'Quit', pt: 'Sair', es: 'Salir', fr: 'Quitter' },
    'menu.autoSaved': { en: 'Settings saved automatically', pt: 'Ajustes salvos automaticamente', es: 'Ajustes guardados automáticamente', fr: 'Réglages enregistrés automatiquement' },
    'menu.volMaster': { en: 'Master volume', pt: 'Volume geral', es: 'Volumen general', fr: 'Volume général' },
    'menu.volSfx': { en: 'Sound effects', pt: 'Efeitos sonoros', es: 'Efectos de sonido', fr: 'Effets sonores' },
    'menu.volMusic': { en: 'Music', pt: 'Música', es: 'Música', fr: 'Musique' },
    'menu.sensX': { en: 'Horizontal sensitivity (aim)', pt: 'Sensibilidade horizontal (mira)', es: 'Sensibilidad horizontal (apuntado)', fr: 'Sensibilité horizontale (visée)' },
    'menu.sensY': { en: 'Vertical sensitivity (camera)', pt: 'Sensibilidade vertical (câmera)', es: 'Sensibilidad vertical (cámara)', fr: 'Sensibilité verticale (caméra)' },
    'menu.back': { en: 'Back', pt: 'Voltar', es: 'Volver', fr: 'Retour' },

    // ===== Erros do carregador (index.html) =====
    'err.engine': {
      en: 'Couldn\'t load the 3D engine (Three.js). Disable blockers/extensions for localhost, or download three.min.js into the game folder.',
      pt: 'Não consegui carregar a engine 3D (Three.js). Desative bloqueadores/extensões para localhost, ou baixe o three.min.js para a pasta do jogo.',
      es: 'No se pudo cargar el motor 3D (Three.js). Desactiva bloqueadores/extensiones para localhost, o descarga three.min.js a la carpeta del juego.',
      fr: 'Impossible de charger le moteur 3D (Three.js). Désactive les bloqueurs/extensions pour localhost, ou télécharge three.min.js dans le dossier du jeu.',
    },
    'err.file': { en: 'Failed to load {file}', pt: 'Falha ao carregar {file}', es: 'Error al cargar {file}', fr: 'Échec du chargement de {file}' },
  };

  // ---- Detecção: localStorage → idioma do sistema → inglês -----------------
  function detect() {
    try {
      const p = new URLSearchParams(location.search).get('lang');
      if (SUPPORTED.includes(p)) return p; // ?lang= tem prioridade (variantes hreflang)
    } catch (e) {}
    try {
      const saved = localStorage.getItem(LSKEY);
      if (SUPPORTED.includes(saved)) return saved;
    } catch (e) {}
    const cands = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || 'en'];
    for (const l of cands) {
      const p = String(l || '').slice(0, 2).toLowerCase();
      if (SUPPORTED.includes(p)) return p;
    }
    return 'en'; // padrão quando o idioma do sistema não é suportado
  }
  let lang = detect();

  function t(key, params) {
    const entry = D[key];
    let s = entry ? (entry[lang] != null ? entry[lang] : entry.en) : key;
    if (params) for (const k in params) s = s.split('{' + k + '}').join(params[k]);
    return s;
  }

  // Atualiza <head> (título, descrição, canonical, Open Graph) p/ o idioma atual.
  function setAttr(sel, attr, val) {
    const el = document.head && document.head.querySelector(sel);
    if (el) el.setAttribute(attr, val);
  }
  function updateHead() {
    const canon = CANON_BASE + '?lang=' + lang;
    const title = t('meta.title'), desc = t('meta.desc');
    document.title = title;
    setAttr('meta[name="description"]', 'content', desc);
    setAttr('link[rel="canonical"]', 'href', canon);
    setAttr('meta[property="og:url"]', 'content', canon);
    setAttr('meta[property="og:title"]', 'content', title);
    setAttr('meta[property="og:description"]', 'content', desc);
    setAttr('meta[property="og:locale"]', 'content', OGLOCALE[lang]);
    setAttr('meta[name="twitter:title"]', 'content', title);
    setAttr('meta[name="twitter:description"]', 'content', desc);
  }

  // Mantém o ?lang= da URL em sincronia com o idioma (auto-canonicaliza a variante).
  function syncUrl() {
    try {
      const cur = new URLSearchParams(location.search).get('lang');
      if (cur !== lang && history.replaceState) {
        const u = new URL(location.href);
        u.searchParams.set('lang', lang);
        history.replaceState(null, '', u.pathname + u.search + u.hash);
      }
    } catch (e) {}
  }

  // Traduz os elementos estáticos marcados com data-i18n* (idempotente).
  function apply(root) {
    root = root || document;
    root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.getAttribute('data-i18n')); });
    root.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.getAttribute('data-i18n-html')); });
    root.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.getAttribute('data-i18n-ph')); });
    root.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria'))); });
    document.documentElement.setAttribute('lang', lang === 'pt' ? 'pt-BR' : lang);
    updateHead();
    syncUrl();
    // Sincroniza os seletores de idioma existentes.
    document.querySelectorAll('select.i18n-lang').forEach((sel) => { if (sel.value !== lang) sel.value = lang; });
  }

  function setLang(l) {
    if (!SUPPORTED.includes(l)) l = 'en';
    if (l === lang) return;
    lang = l;
    try { localStorage.setItem(LSKEY, l); } catch (e) {}
    apply();
    document.dispatchEvent(new CustomEvent('orbitpool:lang', { detail: { lang: l } }));
  }

  // Preenche um <select> com os idiomas e liga a troca (fallback simples).
  function fillSelect(sel) {
    sel.classList.add('i18n-lang');
    sel.innerHTML = '';
    for (const l of SUPPORTED) {
      const o = document.createElement('option');
      o.value = l; o.textContent = NAMES[l];
      sel.appendChild(o);
    }
    sel.value = lang;
    sel.addEventListener('change', () => setLang(sel.value));
  }

  // ---- Dropdown PERSONALIZADO (tema boteco — nada de <select> nativo) ------
  // customSelect(mount, { wide }) monta: botão 🌐 + lista com ✓ no idioma
  // atual. Abre pra cima quando falta espaço embaixo (ex.: canto inferior).
  let cssDone = false;
  function injectCSS() {
    if (cssDone) return; cssDone = true;
    const st = document.createElement('style');
    st.textContent = `
    .oi18n-dd{position:relative;display:inline-block;font-family:'Kalam',cursive;}
    .oi18n-btn{display:flex;align-items:center;gap:8px;background:transparent;border:none;cursor:pointer;
      color:#ffd24a;font-family:'Permanent Marker',cursive;font-size:13px;letter-spacing:.05em;
      padding:0;text-transform:uppercase;}
    .oi18n-g{font-size:15px;}
    .oi18n-car{font-style:normal;font-size:11px;transition:transform .15s;}
    .oi18n-dd.open .oi18n-car{transform:rotate(180deg);}
    .oi18n-list{position:absolute;right:0;top:calc(100% + 10px);min-width:158px;padding:6px;z-index:120;
      background:radial-gradient(120% 90% at 30% 10%, #2f3b34, #1c241f 85%);
      border:2px solid #5a3413;border-radius:12px;
      box-shadow:0 14px 34px rgba(0,0,0,.55), inset 0 0 22px rgba(0,0,0,.45);}
    .oi18n-list.up{top:auto;bottom:calc(100% + 10px);}
    .oi18n-item{display:flex;align-items:center;gap:8px;width:100%;padding:8px 10px;border:none;border-radius:8px;
      background:transparent;color:#e8d9b5;font-family:'Kalam',cursive;font-size:15px;font-weight:700;
      cursor:pointer;text-align:left;}
    .oi18n-item:hover{background:rgba(255,210,74,.14);color:#ffd24a;}
    .oi18n-item .oi18n-chk{width:14px;color:#ffd24a;opacity:0;}
    .oi18n-item.sel{color:#fff;}
    .oi18n-item.sel .oi18n-chk{opacity:1;}
    .oi18n-dd.wide{display:block;width:100%;}
    .oi18n-dd.wide .oi18n-btn{width:100%;padding:10px 12px;border-radius:9px;text-transform:none;
      background:rgba(255,255,255,.06);border:1.5px solid rgba(255,255,255,.2);
      color:#f3ecdb;font-family:'Kalam',cursive;font-size:15px;}
    .oi18n-dd.wide .oi18n-cur{flex:1;text-align:left;font-weight:700;}
    .oi18n-dd.wide .oi18n-car{color:#ffd24a;}
    .oi18n-dd.wide .oi18n-list{left:0;right:0;}`;
    document.head.appendChild(st);
  }

  function customSelect(mount, opts) {
    injectCSS();
    opts = opts || {};
    const dd = document.createElement('div');
    dd.className = 'oi18n-dd' + (opts.wide ? ' wide' : '');
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'oi18n-btn';
    btn.innerHTML = '<span class="oi18n-g">🌐</span><b class="oi18n-cur"></b><i class="oi18n-car">▾</i>';
    const list = document.createElement('div');
    list.className = 'oi18n-list'; list.hidden = true;
    for (const l of SUPPORTED) {
      const it = document.createElement('button');
      it.type = 'button'; it.className = 'oi18n-item'; it.dataset.l = l;
      const chk = document.createElement('span'); chk.className = 'oi18n-chk'; chk.textContent = '✓';
      const nm = document.createElement('span'); nm.textContent = NAMES[l];
      it.append(chk, nm);
      it.addEventListener('click', (e) => { e.stopPropagation(); setLang(l); closeList(); });
      list.appendChild(it);
    }
    function refresh() {
      btn.querySelector('.oi18n-cur').textContent = NAMES[lang];
      list.querySelectorAll('.oi18n-item').forEach((it) => it.classList.toggle('sel', it.dataset.l === lang));
    }
    function openList() {
      list.hidden = false; dd.classList.add('open');
      list.classList.remove('up');
      const r = btn.getBoundingClientRect();
      const lh = list.offsetHeight || 180;
      if (window.innerHeight - r.bottom < lh + 18) list.classList.add('up'); // sem espaço embaixo → abre pra cima
    }
    function closeList() { list.hidden = true; dd.classList.remove('open'); }
    btn.addEventListener('click', (e) => { e.stopPropagation(); list.hidden ? openList() : closeList(); });
    document.addEventListener('click', (e) => { if (!dd.contains(e.target)) closeList(); });
    document.addEventListener('keydown', (e) => {
      if ((e.key === 'Escape' || e.key === 'Esc') && !list.hidden) { e.stopPropagation(); closeList(); }
    }, true); // captura: fecha o dropdown sem abrir/fechar o menu de pausa
    document.addEventListener('orbitpool:lang', refresh);
    refresh();
    dd.append(btn, list);
    mount.appendChild(dd);
    return dd;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => apply());
  else apply();

  return { t, apply, setLang, fillSelect, customSelect, lang: () => lang, SUPPORTED, NAMES };
})();
