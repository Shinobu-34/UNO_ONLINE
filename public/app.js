/* ═══════════════════════════════════════════════════════════
   UNO Online — Main Application Controller
   ═══════════════════════════════════════════════════════════ */

(function () {
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
    home: $('#home-screen'),
    lobby: $('#lobby-screen'),
    game: $('#game-screen'),
    victory: $('#victory-screen')
  };

  // Home
  const nameInput = $('#player-name-input');
  const createRoomBtn = $('#create-room-btn');
  const codeInput = $('#room-code-input');
  const joinRoomBtn = $('#join-room-btn');

  // Lobby
  const lobbyCode = $('#lobby-room-code');
  const copyCodeBtn = $('#copy-code-btn');
  const lobbyPlayers = $('#lobby-players');
  const startGameBtn = $('#start-game-btn');
  const leaveRoomBtn = $('#leave-room-btn');

  // Game
  const opponentsBar = $('#opponents-bar');
  const drawPile = $('#draw-pile');
  const drawCount = $('#draw-count');
  const discardPile = $('#discard-pile');
  const colorRing = $('#color-ring');
  const turnLabel = $('#turn-label');
  const actionLog = $('#action-log');
  const playerHand = $('#player-hand');
  const unoBtn = $('#uno-btn');
  const catchButtons = $('#catch-buttons');
  const dirIndicator = $('#direction-indicator');
  const gameLeaveBtn = $('#game-leave-btn');

  // Drawn card prompt
  const drawnPrompt = $('#drawn-card-prompt');
  const drawnPreview = $('#drawn-card-preview');
  const playDrawnBtn = $('#play-drawn-btn');
  const keepDrawnBtn = $('#keep-drawn-btn');

  // Color modal
  const colorModal = $('#color-modal');

  // Challenge modal
  const challengeModal = $('#challenge-modal');
  const challengeDesc = $('#challenge-modal-desc');
  const challengeTimer = $('#challenge-timer');
  const challengeYesBtn = $('#challenge-yes-btn');
  const challengeNoBtn = $('#challenge-no-btn');

  let challengeCountdownTimer = null;
  let challengeSecondsLeft = 10;

  // Victory
  const winnerName = $('#winner-name');
  const winnerScore = $('#winner-score');
  const playAgainBtn = $('#play-again-btn');
  const leaveGameBtn = $('#leave-game-btn');

  // ── Screen Management ─────────────────────────────────
  function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    if (screens[name]) screens[name].classList.add('active');
  }

  // ── Particle Background (Warp Speed Starfield & Gravity Card Rain) ──
  function initParticles() {
    const canvas = $('#particles-canvas');
    const ctx = canvas.getContext('2d');

    let centerX = window.innerWidth / 2;
    let centerY = window.innerHeight / 2;
    let maxDepth = Math.max(window.innerWidth, 1000);
    const stars = []; // Declare stars here at the top to avoid ReferenceError in resize() TDZ

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      centerX = canvas.width / 2;
      centerY = canvas.height / 2;
      maxDepth = Math.max(canvas.width, 1000);

      // Redistribute static stars to fill the new screen size on window resize
      if (stars.length > 0) {
        stars.forEach(star => {
          star.staticX = Math.random() * canvas.width;
          star.staticY = Math.random() * canvas.height;
        });
      }
    }
    resize();
    window.addEventListener('resize', resize);

    // Mouse state with velocity tracking
    let mouse = {
      x: centerX,
      y: centerY,
      targetX: centerX,
      targetY: centerY,
      vx: 0,
      vy: 0,
      lastX: centerX,
      lastY: centerY,
      isIdle: true
    };
    let idleTimer = null;

    window.addEventListener('mousemove', (e) => {
      mouse.targetX = e.clientX;
      mouse.targetY = e.clientY;
      mouse.isIdle = false;

      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        mouse.isIdle = true;
      }, 5000);
    });

    window.addEventListener('mouseleave', () => {
      mouse.isIdle = true;
    });

    // 1. Starfield Hyperdrive Background Layer
    const STAR_COUNT = 65;
    const starScaleFactor = 200;
    const starColors = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7']; // Red, Blue, Green, Yellow, Purple (Wild)

    for (let i = 0; i < STAR_COUNT; i++) {
      stars.push({
        x: (Math.random() - 0.5) * canvas.width * 2,
        y: (Math.random() - 0.5) * canvas.height * 2,
        z: Math.random() * maxDepth,
        color: starColors[Math.floor(Math.random() * starColors.length)],
        // Static coordinates for quiet gameplay background mode
        staticX: Math.random() * canvas.width,
        staticY: Math.random() * canvas.height,
        staticRadius: Math.random() * 1.5 + 0.8
      });
    }

    // 2. Gravity Card Rain Foreground Layer
    const CARD_COUNT = 36;
    const cards = [];
    const colors = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7']; // Red, Blue, Green, Yellow, Purple (Wild)
    const symbols = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '⊘', '⟲', '+2', 'W', '+4'];

    for (let i = 0; i < CARD_COUNT; i++) {
      cards.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height - 40,
        vx: (Math.random() - 0.5) * 2,
        vy: Math.random() * 2 + 1,
        angle: Math.random() * Math.PI * 2,
        va: (Math.random() - 0.5) * 0.05,
        color: colors[Math.floor(Math.random() * colors.length)],
        symbol: symbols[Math.floor(Math.random() * symbols.length)],
        width: 20,
        height: 30
      });
    }

    const gravity = 0.13;
    const airResistance = 0.99;
    const restitution = 0.6; // bounciness

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Check if the game screen is active to toggle quiet static background mode
      const isGameActive = screens.game && screens.game.classList.contains('active');

      if (isGameActive) {
        // Draw static space background (soft quiet stars, no card rain, no hyperdrive lines, no mouse halo)
        for (const star of stars) {
          ctx.save();
          ctx.fillStyle = star.color;
          ctx.globalAlpha = 0.25; // extremely subtle and calm
          ctx.beginPath();
          ctx.arc(star.staticX, star.staticY, star.staticRadius, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        requestAnimationFrame(draw);
        return; // skip gravity simulation, warp trails, and mouse events
      }

      // Smooth mouse tracking interpolation
      mouse.x += (mouse.targetX - mouse.x) * 0.12;
      mouse.y += (mouse.targetY - mouse.y) * 0.12;

      // Track mouse velocity
      mouse.vx = mouse.x - mouse.lastX;
      mouse.vy = mouse.y - mouse.lastY;
      mouse.lastX = mouse.x;
      mouse.lastY = mouse.y;

      const mouseSpeed = Math.sqrt(mouse.vx * mouse.vx + mouse.vy * mouse.vy);

      // Limit mouse velocity applied to cards
      const mv = Math.sqrt(mouse.vx * mouse.vx + mouse.vy * mouse.vy);
      const maxMouseSpeed = 16;
      if (mv > maxMouseSpeed) {
        mouse.vx = (mouse.vx / mv) * maxMouseSpeed;
        mouse.vy = (mouse.vy / mv) * maxMouseSpeed;
      }

      // If mouse is idle, make the virtual collider circle drift slowly around the center
      if (mouse.isIdle) {
        const time = Date.now() * 0.001;
        mouse.targetX = centerX + Math.sin(time * 1.5) * (centerX * 0.25);
        mouse.targetY = centerY + Math.cos(time * 1.1) * (centerY * 0.25);
      }

      // Calculate dynamic mouse interaction radius
      const mouseRadius = Math.max(60, Math.min(90, canvas.width * 0.06));

      // ──────────────────────────────────────────────────────────
      // LAYER 1: Deep Background Starfield Hyperdrive Warp
      // ──────────────────────────────────────────────────────────
      const baseStarSpeed = 1.0;
      const warpModifier = Math.min(18, mouseSpeed * 1.2);
      const currentStarSpeed = baseStarSpeed + warpModifier;

      for (const star of stars) {
        // Move star closer to the observer
        star.z -= currentStarSpeed;

        // Respawn star if it gets too close
        if (star.z <= 0) {
          star.z = maxDepth;
          star.x = (Math.random() - 0.5) * canvas.width * 2;
          star.y = (Math.random() - 0.5) * canvas.height * 2;
          star.color = starColors[Math.floor(Math.random() * starColors.length)];
        }

        // Project 3D coordinate onto 2D screen
        const px = centerX + (star.x / star.z) * starScaleFactor;
        const py = centerY + (star.y / star.z) * starScaleFactor;

        // Draw star streak from previous frame projected position
        const prevZ = star.z + currentStarSpeed;
        const ppx = centerX + (star.x / prevZ) * starScaleFactor;
        const ppy = centerY + (star.y / prevZ) * starScaleFactor;

        // Respawn if projected position is completely off-screen
        if (px < 0 || px > canvas.width || py < 0 || py > canvas.height) {
          star.z = maxDepth;
          star.x = (Math.random() - 0.5) * canvas.width * 2;
          star.y = (Math.random() - 0.5) * canvas.height * 2;
          star.color = starColors[Math.floor(Math.random() * starColors.length)];
          continue;
        }

        // Star opacity based on depth (guaranteeing minimum visibility at rest)
        const depthPercent = 1 - (star.z / maxDepth);
        const opacity = Math.min(0.75, 0.28 + depthPercent * 0.47);

        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.strokeStyle = star.color;

        // Thicker lines for strong visual appearance
        ctx.lineWidth = Math.max(2.0, depthPercent * 4.0 + (warpModifier * 0.12));

        // Ensure a minimum visual streak length of 3.5px so stars don't look like dim single pixels at rest
        let drawPpx = ppx;
        let drawPpy = ppy;
        const dx_streak = px - ppx;
        const dy_streak = py - ppy;
        const streakLen = Math.sqrt(dx_streak * dx_streak + dy_streak * dy_streak);
        if (streakLen < 3.5 && streakLen > 0) {
          const ratio = 3.5 / streakLen;
          drawPpx = px - dx_streak * ratio;
          drawPpy = py - dy_streak * ratio;
        }

        ctx.beginPath();
        ctx.moveTo(drawPpx, drawPpy);
        ctx.lineTo(px, py);
        ctx.stroke();
        ctx.restore();
      }

      // ──────────────────────────────────────────────────────────
      // LAYER 2: Mouse Interaction Ring & Forcefield Aura
      // ──────────────────────────────────────────────────────────
      ctx.save();
      const mouseGrad = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, mouseRadius);
      mouseGrad.addColorStop(0, 'rgba(255, 255, 255, 0.04)');
      mouseGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.015)');
      mouseGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = mouseGrad;
      ctx.beginPath();
      ctx.arc(mouse.x, mouse.y, mouseRadius, 0, Math.PI * 2);
      ctx.fill();

      // Faint boundary dash outline
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(mouse.x, mouse.y, mouseRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // ──────────────────────────────────────────────────────────
      // LAYER 3: Foreground Gravity Card Rain
      // ──────────────────────────────────────────────────────────
      for (const card of cards) {
        // Physics update
        card.vy += gravity;
        card.vx *= airResistance;
        card.vy *= airResistance;

        card.x += card.vx;
        card.y += card.vy;
        card.angle += card.va;

        // Collision with Mouse Cursor (Realistic 2D Bounce)
        const dx = card.x - mouse.x;
        const dy = card.y - mouse.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < mouseRadius) {
          const nx = dx / dist; // Collision normal X
          const ny = dy / dist; // Collision normal Y

          // Push out of cursor circle to prevent stuck cards
          card.x = mouse.x + nx * mouseRadius;
          card.y = mouse.y + ny * mouseRadius;

          // Relative velocity between card and moving mouse
          const rvx = card.vx - mouse.vx;
          const rvy = card.vy - mouse.vy;

          // Dot product of relative velocity and normal
          const velAlongNormal = rvx * nx + rvy * ny;

          // Only bounce if they are moving towards each other
          if (velAlongNormal < 0) {
            let impulse = -(1 + restitution) * velAlongNormal;

            // Adjust card velocity
            card.vx += impulse * nx + mouse.vx * 0.45;
            card.vy += impulse * ny + mouse.vy * 0.45;

            // Add organic spinning force depending on the impact
            card.va += (Math.random() - 0.5) * 0.15 + (mouse.vx * 0.01);
          }
        }

        // Clamp speed to prevent glitchy teleportation
        const speed = Math.sqrt(card.vx * card.vx + card.vy * card.vy);
        const maxSpeed = 14;
        if (speed > maxSpeed) {
          card.vx = (card.vx / speed) * maxSpeed;
          card.vy = (card.vy / speed) * maxSpeed;
        }

        // Keep horizontal boundaries wrapping
        const boundPad = 25;
        if (card.x < -boundPad) card.x = canvas.width + boundPad - 4;
        if (card.x > canvas.width + boundPad) card.x = -boundPad + 4;

        // Reset if goes off-screen bottom
        if (card.y > canvas.height + 40) {
          card.y = -40;
          card.x = Math.random() * canvas.width;
          card.vx = (Math.random() - 0.5) * 2;
          card.vy = Math.random() * 1.5 + 0.8;
          card.va = (Math.random() - 0.5) * 0.05;
        }

        // Draw Card Particle
        ctx.save();
        ctx.translate(card.x, card.y);
        ctx.rotate(card.angle);

        // Card shadow
        ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
        ctx.shadowBlur = 6;
        ctx.shadowOffsetY = 3;

        // Card body rounded rectangle
        ctx.beginPath();
        const r = 3;
        const w = card.width;
        const h = card.height;
        if (ctx.roundRect) {
          ctx.roundRect(-w / 2, -h / 2, w, h, r);
        } else {
          const x = -w / 2;
          const y = -h / 2;
          ctx.moveTo(x + r, y);
          ctx.lineTo(x + w - r, y);
          ctx.quadraticCurveTo(x + w, y, x + w, y + r);
          ctx.lineTo(x + w, y + h - r);
          ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
          ctx.lineTo(x + r, y + h);
          ctx.quadraticCurveTo(x, y + h, x, y + h - r);
          ctx.lineTo(x, y + r);
          ctx.quadraticCurveTo(x, y, x + r, y);
        }
        ctx.fillStyle = card.color;
        ctx.fill();

        // Card border stroke
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.lineWidth = 1.0;
        ctx.stroke();

        ctx.shadowColor = 'transparent';

        // White tilted oval in center
        ctx.save();
        ctx.rotate(-Math.PI / 8);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.beginPath();
        ctx.ellipse(0, 0, w * 0.32, h * 0.38, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Card symbol text
        ctx.fillStyle = '#ffffff';
        ctx.font = `900 10px var(--font-heading)`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(card.symbol, 0, 0);

        ctx.restore();
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

  // ── Challenge Timer ───────────────────────────────────
  function startChallengeTimer() {
    if (challengeCountdownTimer) return; // already running
    challengeSecondsLeft = 10;
    challengeTimer.textContent = `${challengeSecondsLeft}s`;

    challengeCountdownTimer = setInterval(() => {
      challengeSecondsLeft--;
      if (challengeSecondsLeft <= 0) {
        challengeTimer.textContent = '0s';
        stopChallengeTimer();
        challengeModal.style.display = 'none';
      } else {
        challengeTimer.textContent = `${challengeSecondsLeft}s`;
      }
    }, 1000);
  }

  function stopChallengeTimer() {
    if (challengeCountdownTimer) {
      clearInterval(challengeCountdownTimer);
      challengeCountdownTimer = null;
    }
  }

  function showCustomConfirm(title, desc, onYes) {
    const modal = $('#confirm-modal');
    const titleEl = $('#confirm-modal-title');
    const descEl = $('#confirm-modal-desc');
    const yesBtn = $('#confirm-yes-btn');
    const noBtn = $('#confirm-no-btn');

    titleEl.textContent = title;
    descEl.textContent = desc;
    modal.style.display = 'flex';

    // Clone buttons to clear existing listeners
    const newYesBtn = yesBtn.cloneNode(true);
    const newNoBtn = noBtn.cloneNode(true);
    yesBtn.parentNode.replaceChild(newYesBtn, yesBtn);
    noBtn.parentNode.replaceChild(newNoBtn, noBtn);

    newYesBtn.addEventListener('click', () => {
      modal.style.display = 'none';
      if (onYes) onYes();
    });

    newNoBtn.addEventListener('click', () => {
      modal.style.display = 'none';
    });
  }

  function leaveGameAction() {
    Network.disconnect();
    myId = null;
    roomCode = null;
    isHost = false;
    stopChallengeTimer();
    showScreen('home');
    // Reconnect the WebSocket for future use
    setTimeout(() => Network.connect(onMessage), 500);
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

      case 'roomClosed':
        showToast('🚪 ' + (data.reason || 'Room closed by host'));
        leaveGameAction();
        break;

      case 'kicked':
        showToast('🚪 ' + (data.reason || 'You were kicked from the room'));
        leaveGameAction();
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

      if (isHost && p.id !== myId) {
        const kickBtn = document.createElement('button');
        kickBtn.className = 'btn-kick';
        kickBtn.innerHTML = '✕';
        kickBtn.title = `Kick ${p.name}`;
        kickBtn.addEventListener('click', () => {
          showCustomConfirm(
            'Remove Player?',
            `Are you sure you want to remove ${p.name} from the room?`,
            () => {
              Network.send({ type: 'kickPlayer', targetId: p.id });
            }
          );
        });
        item.appendChild(kickBtn);
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
    $('#game-room-code-val').textContent = roomCode;

    // Opponents bar
    renderOpponents(state);

    // Draw pile count
    drawCount.textContent = state.drawPileCount;

    // Discard pile
    renderDiscardPile(state.topCard);

    // Color ring
    colorRing.className = 'current-color-ring ring-' + state.topColor;

    // Turn label & Wild 4 Challenge Modal
    if (state.pendingWild4) {
      if (state.pendingWild4.victimId === myId) {
        // I am the victim! Show the challenge dialog.
        challengeModal.style.display = 'flex';
        challengeDesc.textContent = `${state.pendingWild4.playerName} played a Wild Draw 4 card against you! Do you want to challenge?`;

        // Start countdown timer if not already running
        startChallengeTimer();
        turnLabel.textContent = 'Challenge or Decline the Wild Draw 4!';
        turnLabel.classList.add('my-turn');
      } else {
        // Someone else is the victim. Hide the modal and update turn label.
        challengeModal.style.display = 'none';
        stopChallengeTimer();
        const victimPlayer = state.players.find(p => p.id === state.pendingWild4.victimId);
        const victimName = victimPlayer ? victimPlayer.name : 'opponent';
        turnLabel.textContent = `Waiting for ${victimName} to decide on Wild 4 challenge...`;
        turnLabel.classList.add('my-turn');
      }
    } else {
      // No pending Wild 4, hide modal and stop timer
      challengeModal.style.display = 'none';
      stopChallengeTimer();

      // Normal turn label logic
      if (state.isMyTurn) {
        turnLabel.textContent = state.hasDrawnCard ? 'Play or keep your drawn card' : 'Your Turn!';
        turnLabel.classList.add('my-turn');
      } else {
        const current = state.players.find(p => p.id === state.currentPlayerId);
        turnLabel.textContent = current ? `${current.name}'s turn` : 'Waiting...';
        turnLabel.classList.remove('my-turn');
      }
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

    // Drawn card prompt
    if (state.drawnCard) {
      drawnCardData = { card: state.drawnCard, canPlay: true };
      showDrawnCardPrompt(state.drawnCard);
    } else {
      drawnPrompt.style.display = 'none';
      drawnCardData = null;
    }
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
    leaveGameAction();
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

  // Game — Challenge Wild Draw 4
  challengeYesBtn.addEventListener('click', () => {
    Network.send({ type: 'challengeWild4' });
    challengeModal.style.display = 'none';
    stopChallengeTimer();
  });

  challengeNoBtn.addEventListener('click', () => {
    Network.send({ type: 'declineWild4' });
    challengeModal.style.display = 'none';
    stopChallengeTimer();
  });

  // Game — Leave Game button
  gameLeaveBtn.addEventListener('click', () => {
    showCustomConfirm(
      'Leave Game?',
      'Are you sure you want to leave the game?',
      () => {
        leaveGameAction();
      }
    );
  });

  // Victory — Play Again
  playAgainBtn.addEventListener('click', () => {
    Network.send({ type: 'playAgain' });
  });

  // Victory — Leave
  leaveGameBtn.addEventListener('click', () => {
    leaveGameAction();
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
