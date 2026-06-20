/* ═══════════════════════════════════════════════════════════
   UNO Online — Main Application Controller
   ═══════════════════════════════════════════════════════════ */

(function() {
  'use strict';

  // ── State ──────────────────────────────────────────────
  let myId = null;
  let roomCode = null;
  let isHost = false;
  let gameState = null;
  let pendingWildCardId = null;   // card id waiting for color pick
  let pendingDrawnWild = false;   // drawn card is wild, waiting for color pick
  let drawnCardData = null;       // { card, canPlay }

  // ── DOM References ─────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const screens = {
    home:    $('#home-screen'),
    lobby:   $('#lobby-screen'),
    game:    $('#game-screen'),
    victory: $('#victory-screen')
  };

  // Home
  const nameInput      = $('#player-name-input');
  const createRoomBtn  = $('#create-room-btn');
  const codeInput      = $('#room-code-input');
  const joinRoomBtn    = $('#join-room-btn');

  // Lobby
  const lobbyCode      = $('#lobby-room-code');
  const copyCodeBtn    = $('#copy-code-btn');
  const lobbyPlayers   = $('#lobby-players');
  const startGameBtn   = $('#start-game-btn');
  const leaveRoomBtn   = $('#leave-room-btn');

  // Game
  const opponentsBar   = $('#opponents-bar');
  const drawPile       = $('#draw-pile');
  const drawCount      = $('#draw-count');
  const discardPile    = $('#discard-pile');
  const colorRing      = $('#color-ring');
  const turnLabel      = $('#turn-label');
  const actionLog      = $('#action-log');
  const playerHand     = $('#player-hand');
  const unoBtn         = $('#uno-btn');
  const catchButtons   = $('#catch-buttons');
  const dirIndicator   = $('#direction-indicator');

  // Drawn card prompt
  const drawnPrompt    = $('#drawn-card-prompt');
  const drawnPreview   = $('#drawn-card-preview');
  const playDrawnBtn   = $('#play-drawn-btn');
  const keepDrawnBtn   = $('#keep-drawn-btn');

  // Color modal
  const colorModal     = $('#color-modal');

  // Victory
  const winnerName     = $('#winner-name');
  const winnerScore    = $('#winner-score');
  const playAgainBtn   = $('#play-again-btn');
  const leaveGameBtn   = $('#leave-game-btn');

  // ── Screen Management ─────────────────────────────────
  function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    if (screens[name]) screens[name].classList.add('active');
  }

  // ── Particle Background ───────────────────────────────
  function initParticles() {
    const canvas = $('#particles-canvas');
    const ctx = canvas.getContext('2d');
    let particles = [];
    const COUNT = 50;

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    for (let i = 0; i < COUNT; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 2 + 0.5,
        dx: (Math.random() - 0.5) * 0.4,
        dy: (Math.random() - 0.5) * 0.4,
        a: Math.random() * 0.3 + 0.05
      });
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of particles) {
        p.x += p.dx;
        p.y += p.dy;
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(168, 85, 247, ${p.a})`;
        ctx.fill();
      }
      requestAnimationFrame(draw);
    }
    draw();
  }

  // ── Toast Notifications ───────────────────────────────
  function showToast(message, duration = 3000) {
    const container = $('#toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast-out');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // ── Confetti ──────────────────────────────────────────
  function launchConfetti() {
    const wrapper = $('#confetti-wrapper');
    wrapper.innerHTML = '';
    const colors = ['#EF4444', '#3B82F6', '#22C55E', '#EAB308', '#A855F7', '#EC4899', '#F97316'];
    for (let i = 0; i < 80; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.left = Math.random() * 100 + '%';
      piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      piece.style.animationDuration = (Math.random() * 2 + 2) + 's';
      piece.style.animationDelay = (Math.random() * 1.5) + 's';
      piece.style.width = (Math.random() * 8 + 6) + 'px';
      piece.style.height = (Math.random() * 8 + 6) + 'px';
      wrapper.appendChild(piece);
    }
  }

  // ── Network Message Handler ───────────────────────────
  function onMessage(data) {
    switch (data.type) {
      case 'roomCreated':
        myId = data.playerId;
        roomCode = data.roomCode;
        isHost = true;
        showLobby();
        break;

      case 'roomJoined':
        myId = data.playerId;
        roomCode = data.roomCode;
        isHost = false;
        showLobby();
        break;

      case 'lobbyUpdate':
        renderLobby(data);
        break;

      case 'gameState':
        gameState = data;
        drawnPrompt.style.display = 'none';
        renderGame(data);
        break;

      case 'drawnCard':
        drawnCardData = { card: data.card, canPlay: data.canPlay };
        if (data.canPlay) {
          showDrawnCardPrompt(data.card);
        }
        break;

      case 'notification':
        showToast(data.message);
        break;

      case 'gameOver':
        showVictory(data);
        break;

      case 'error':
        showToast('⚠️ ' + data.message, 4000);
        break;
    }
  }

  // ── Show Lobby ────────────────────────────────────────
  function showLobby() {
    lobbyCode.textContent = roomCode;
    showScreen('lobby');
  }

  function renderLobby(data) {
    // Check if I'm host
    isHost = data.hostId === myId;

    // Players list
    lobbyPlayers.innerHTML = '';
    data.players.forEach((p, i) => {
      const item = document.createElement('div');
      item.className = 'player-item';

      const avatar = document.createElement('div');
      avatar.className = 'player-avatar';
      avatar.style.background = CardRenderer.getAvatarColor(i);
      avatar.textContent = CardRenderer.getInitials(p.name);

      const name = document.createElement('div');
      name.className = 'player-name';
      name.textContent = p.name + (p.id === myId ? ' (You)' : '');

      item.appendChild(avatar);
      item.appendChild(name);

      if (p.isHost) {
        const badge = document.createElement('span');
        badge.className = 'player-badge';
        badge.textContent = '👑 Host';
        item.appendChild(badge);
      }

      lobbyPlayers.appendChild(item);
    });

    // Start button (host only, 2+ players)
    if (isHost && data.players.length >= 2) {
      startGameBtn.style.display = '';
    } else {
      startGameBtn.style.display = 'none';
    }
  }

  // ── Render Game ───────────────────────────────────────
  function renderGame(state) {
    showScreen('game');

    // Opponents bar
    renderOpponents(state);

    // Draw pile count
    drawCount.textContent = state.drawPileCount;

    // Discard pile
    renderDiscardPile(state.topCard);

    // Color ring
    colorRing.className = 'current-color-ring ring-' + state.topColor;

    // Turn label
    if (state.isMyTurn) {
      turnLabel.textContent = state.hasDrawnCard ? 'Play or keep your drawn card' : 'Your Turn!';
      turnLabel.classList.add('my-turn');
    } else {
      const current = state.players.find(p => p.id === state.currentPlayerId);
      turnLabel.textContent = current ? `${current.name}'s turn` : 'Waiting...';
      turnLabel.classList.remove('my-turn');
    }

    // Direction
    if (state.direction === -1) {
      dirIndicator.style.transform = 'translateY(-50%) scaleX(-1)';
    } else {
      dirIndicator.style.transform = 'translateY(-50%) scaleX(1)';
    }

    // Player hand
    renderHand(state);

    // UNO button — show if I have 2 cards (can call preemptively) or 1 card (can still call)
    const me = state.players.find(p => p.id === myId);
    if (me && (me.cardCount <= 2) && state.isMyTurn) {
      unoBtn.style.display = '';
    } else {
      unoBtn.style.display = 'none';
    }

    // Catch buttons
    renderCatchButtons(state.catchable);

    // Action log
    renderLog(state.log);

    // Draw pile interactivity
    drawPile.style.pointerEvents = state.isMyTurn && !state.hasDrawnCard ? 'auto' : 'none';
    drawPile.style.opacity = state.isMyTurn && !state.hasDrawnCard ? '1' : '0.6';
  }

  function renderOpponents(state) {
    opponentsBar.innerHTML = '';
    const playerIndex = {};
    state.players.forEach((p, i) => playerIndex[p.id] = i);

    state.players.forEach((p, i) => {
      if (p.id === myId) return; // skip self

      const chip = document.createElement('div');
      chip.className = 'opponent-chip';
      if (p.id === state.currentPlayerId) chip.classList.add('active-turn');
      if (!p.connected) chip.classList.add('disconnected');

      const avatar = document.createElement('div');
      avatar.className = 'opp-avatar';
      avatar.style.background = CardRenderer.getAvatarColor(i);
      avatar.textContent = CardRenderer.getInitials(p.name);

      const nameSpan = document.createElement('span');
      nameSpan.textContent = p.name;

      const count = document.createElement('span');
      count.className = 'opp-count';
      count.textContent = '🃏 ' + p.cardCount;

      chip.appendChild(avatar);
      chip.appendChild(nameSpan);
      chip.appendChild(count);

      if (p.calledUno && p.cardCount === 1) {
        const unoBadge = document.createElement('span');
        unoBadge.className = 'opp-uno-badge';
        unoBadge.textContent = 'UNO';
        chip.appendChild(unoBadge);
      }

      opponentsBar.appendChild(chip);
    });
  }

  function renderDiscardPile(topCard) {
    discardPile.innerHTML = '';
    if (!topCard) return;
    const el = CardRenderer.createCard(topCard, { playable: true });
    el.classList.add('card-played');
    el.style.cursor = 'default';
    discardPile.appendChild(el);
  }

  function renderHand(state) {
    playerHand.innerHTML = '';

    // Determine which cards are playable
    const playable = new Set();
    if (state.isMyTurn && !state.hasDrawnCard) {
      for (const card of state.hand) {
        if (isPlayableClient(card, state)) {
          playable.add(card.id);
        }
      }
    }

    // Sort hand: by color then value
    const colorOrder = { red: 0, blue: 1, green: 2, yellow: 3 };
    const sorted = [...state.hand].sort((a, b) => {
      const ca = a.color ? colorOrder[a.color] : 5;
      const cb = b.color ? colorOrder[b.color] : 5;
      if (ca !== cb) return ca - cb;
      const va = a.type === 'number' ? a.value : 10;
      const vb = b.type === 'number' ? b.value : 10;
      return va - vb;
    });

    sorted.forEach((card, i) => {
      const canPlay = playable.has(card.id);
      const el = CardRenderer.createCard(card, {
        playable: state.isMyTurn ? canPlay : undefined,
        onClick: canPlay ? () => handlePlayCard(card) : null
      });
      el.style.zIndex = i;
      playerHand.appendChild(el);
    });
  }

  function isPlayableClient(card, state) {
    if (card.type === 'wild' || card.type === 'wild4') return true;
    if (card.color === state.topColor) return true;
    const top = state.topCard;
    if (card.type === 'number' && top.type === 'number' && card.value === top.value) return true;
    if (card.type !== 'number' && card.type === top.type) return true;
    return false;
  }

  function renderCatchButtons(catchable) {
    catchButtons.innerHTML = '';
    if (!catchable || catchable.length === 0) return;

    catchable.forEach(p => {
      const btn = document.createElement('button');
      btn.className = 'btn btn-catch';
      btn.textContent = `🚨 Catch ${p.name}!`;
      btn.addEventListener('click', () => {
        Network.send({ type: 'catchUno', targetId: p.id });
      });
      catchButtons.appendChild(btn);
    });
  }

  function renderLog(log) {
    if (!log) return;
    actionLog.innerHTML = '';
    log.forEach(entry => {
      const el = document.createElement('div');
      el.className = 'log-entry';
      el.textContent = entry.message;
      actionLog.appendChild(el);
    });
    actionLog.scrollTop = actionLog.scrollHeight;
  }

  // ── Card Play Handler ─────────────────────────────────
  function handlePlayCard(card) {
    if (card.type === 'wild' || card.type === 'wild4') {
      pendingWildCardId = card.id;
      pendingDrawnWild = false;
      colorModal.style.display = 'flex';
    } else {
      Network.send({ type: 'playCard', cardId: card.id });
    }
  }

  // ── Drawn Card Prompt ─────────────────────────────────
  function showDrawnCardPrompt(card) {
    drawnPreview.innerHTML = '';
    const el = CardRenderer.createCard(card, { playable: true });
    el.style.margin = '0';
    el.style.cursor = 'default';
    drawnPreview.appendChild(el);
    drawnPrompt.style.display = '';
  }

  // ── Victory Screen ────────────────────────────────────
  function showVictory(data) {
    showScreen('victory');
    winnerName.textContent = `${data.winnerName} Wins!`;
    winnerScore.textContent = `Score: ${data.score} points`;
    launchConfetti();
    playAgainBtn.style.display = isHost ? '' : 'none';
  }

  // ── Event Listeners ───────────────────────────────────

  // Home — Create Room
  createRoomBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) {
      showToast('Please enter your name');
      nameInput.focus();
      return;
    }
    Network.send({ type: 'createRoom', playerName: name });
  });

  // Home — Join Room
  joinRoomBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    const code = codeInput.value.trim().toUpperCase();
    if (!name) {
      showToast('Please enter your name');
      nameInput.focus();
      return;
    }
    if (!code || code.length !== 4) {
      showToast('Enter a 4-character room code');
      codeInput.focus();
      return;
    }
    Network.send({ type: 'joinRoom', playerName: name, roomCode: code });
  });

  // Allow Enter key on inputs
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') createRoomBtn.click();
  });
  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinRoomBtn.click();
  });

  // Lobby — Copy Code
  copyCodeBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
      showToast('Room code copied! 📋');
    } catch {
      showToast('Code: ' + roomCode);
    }
  });

  // Lobby — Start Game
  startGameBtn.addEventListener('click', () => {
    Network.send({ type: 'startGame' });
  });

  // Lobby — Leave Room
  leaveRoomBtn.addEventListener('click', () => {
    Network.disconnect();
    myId = null;
    roomCode = null;
    isHost = false;
    showScreen('home');
    // Reconnect the WebSocket for future use
    setTimeout(() => Network.connect(onMessage), 500);
  });

  // Game — Draw Pile
  drawPile.addEventListener('click', () => {
    if (gameState && gameState.isMyTurn && !gameState.hasDrawnCard) {
      Network.send({ type: 'drawCard' });
    }
  });

  // Game — UNO Button
  unoBtn.addEventListener('click', () => {
    Network.send({ type: 'callUno' });
    unoBtn.style.display = 'none';
  });

  // Game — Play Drawn Card
  playDrawnBtn.addEventListener('click', () => {
    if (!drawnCardData) return;
    const card = drawnCardData.card;
    if (card.type === 'wild' || card.type === 'wild4') {
      pendingWildCardId = card.id;
      pendingDrawnWild = true;
      colorModal.style.display = 'flex';
      drawnPrompt.style.display = 'none';
    } else {
      Network.send({ type: 'playDrawnCard' });
      drawnPrompt.style.display = 'none';
      drawnCardData = null;
    }
  });

  // Game — Keep Drawn Card
  keepDrawnBtn.addEventListener('click', () => {
    Network.send({ type: 'keepDrawnCard' });
    drawnPrompt.style.display = 'none';
    drawnCardData = null;
  });

  // Color Modal — Color Choice
  $$('.color-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const color = btn.dataset.color;
      colorModal.style.display = 'none';

      if (pendingDrawnWild) {
        Network.send({ type: 'playDrawnCard', chosenColor: color });
        drawnCardData = null;
      } else {
        Network.send({ type: 'playCard', cardId: pendingWildCardId, chosenColor: color });
      }
      pendingWildCardId = null;
      pendingDrawnWild = false;
    });
  });

  // Victory — Play Again
  playAgainBtn.addEventListener('click', () => {
    Network.send({ type: 'playAgain' });
  });

  // Victory — Leave
  leaveGameBtn.addEventListener('click', () => {
    Network.disconnect();
    myId = null;
    roomCode = null;
    isHost = false;
    showScreen('home');
    setTimeout(() => Network.connect(onMessage), 500);
  });

  // ── Initialize ────────────────────────────────────────
  function init() {
    initParticles();
    Network.connect(onMessage);
    showScreen('home');

    // Focus name input
    setTimeout(() => nameInput.focus(), 500);
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
