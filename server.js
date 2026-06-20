const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

// ─── Storage ──────────────────────────────────────────────
const rooms = new Map();
const playerRooms = new Map(); // ws → { roomCode, playerId }

// ─── Helpers ──────────────────────────────────────────────
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

function generatePlayerId() {
  return 'p_' + Math.random().toString(36).substring(2, 11);
}

function send(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// ─── UNO Game Class ───────────────────────────────────────
class UnoGame {
  constructor(roomCode) {
    this.roomCode = roomCode;
    this.players = [];
    this.hostId = null;
    this.state = 'lobby';
    this.deck = [];
    this.discardPile = [];
    this.currentPlayerIndex = 0;
    this.direction = 1;
    this.currentColor = null;
    this.nextCardId = 0;
    this.drawnCard = null;
    this.actionLog = [];
  }

  // ── Player management ────────────────────────────────
  addPlayer(id, name, ws) {
    if (this.players.length >= 8) throw new Error('Room is full (max 8 players)');
    if (this.state !== 'lobby') throw new Error('Game already in progress');
    const player = { id, name, ws, hand: [], calledUno: false, connected: true };
    this.players.push(player);
    if (this.players.length === 1) this.hostId = id;
    return player;
  }

  removePlayer(playerId) {
    const idx = this.players.findIndex(p => p.id === playerId);
    if (idx === -1) return;

    if (this.state === 'lobby') {
      this.players.splice(idx, 1);
      if (this.players.length > 0 && this.hostId === playerId) {
        this.hostId = this.players[0].id;
      }
    } else {
      this.players[idx].connected = false;
      this.players[idx].ws = null;
      if (this.currentPlayerIndex === idx) {
        this.nextTurn();
        this.broadcastState();
        this.broadcastNotification(`${this.players[idx].name} disconnected. Skipping their turn.`);
      }
    }
  }

  reconnectPlayer(playerId, ws) {
    const player = this.players.find(p => p.id === playerId);
    if (player) {
      player.ws = ws;
      player.connected = true;
      return true;
    }
    return false;
  }

  // ── Deck ──────────────────────────────────────────────
  createDeck() {
    const cards = [];
    const colors = ['red', 'blue', 'green', 'yellow'];

    for (const color of colors) {
      // One 0 per color
      cards.push({ id: this.nextCardId++, color, value: 0, type: 'number' });
      // Two each of 1-9
      for (let n = 1; n <= 9; n++) {
        cards.push({ id: this.nextCardId++, color, value: n, type: 'number' });
        cards.push({ id: this.nextCardId++, color, value: n, type: 'number' });
      }
      // Two each of action cards
      for (let i = 0; i < 2; i++) {
        cards.push({ id: this.nextCardId++, color, value: null, type: 'skip' });
        cards.push({ id: this.nextCardId++, color, value: null, type: 'reverse' });
        cards.push({ id: this.nextCardId++, color, value: null, type: 'draw2' });
      }
    }
    // 4 Wild + 4 Wild Draw Four
    for (let i = 0; i < 4; i++) {
      cards.push({ id: this.nextCardId++, color: null, value: null, type: 'wild' });
      cards.push({ id: this.nextCardId++, color: null, value: null, type: 'wild4' });
    }
    return cards; // 108 cards
  }

  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  reshuffleDeck() {
    if (this.discardPile.length <= 1) return;
    const top = this.discardPile.pop();
    this.deck = this.shuffle([...this.discardPile]);
    this.discardPile = [top];
  }

  drawFromDeck(count) {
    const drawn = [];
    for (let i = 0; i < count; i++) {
      if (this.deck.length === 0) this.reshuffleDeck();
      if (this.deck.length === 0) break;
      drawn.push(this.deck.pop());
    }
    return drawn;
  }

  // ── Game flow ─────────────────────────────────────────
  startGame() {
    if (this.players.length < 2) throw new Error('Need at least 2 players to start');
    if (this.state !== 'lobby') throw new Error('Game already in progress');

    this.state = 'playing';
    this.nextCardId = 0;
    this.deck = this.shuffle(this.createDeck());
    this.discardPile = [];
    this.currentPlayerIndex = 0;
    this.direction = 1;
    this.drawnCard = null;
    this.actionLog = [];

    // Deal 7 cards
    for (const p of this.players) {
      p.hand = this.drawFromDeck(7);
      p.calledUno = false;
    }

    // Flip first card (no Wild Draw 4 as first)
    let first;
    while (true) {
      first = this.deck.pop();
      if (first.type === 'wild4') {
        this.deck.unshift(first);
        this.shuffle(this.deck);
      } else break;
    }
    this.discardPile.push(first);
    this.currentColor = first.color || 'red';

    // Apply first-card effects
    if (first.type === 'skip') {
      this.log(`First card is Skip — ${this.players[0].name} is skipped!`);
      this.nextTurn();
    } else if (first.type === 'reverse') {
      this.direction = -1;
      this.log('First card is Reverse — direction reversed!');
      if (this.players.length === 2) this.nextTurn();
    } else if (first.type === 'draw2') {
      const victim = this.players[0];
      victim.hand.push(...this.drawFromDeck(2));
      this.log(`First card is Draw 2 — ${victim.name} draws 2 and is skipped!`);
      this.nextTurn();
    } else if (first.type === 'wild') {
      this.currentColor = 'red';
      this.log('First card is Wild — color set to Red.');
    }

    this.broadcastState();
    this.broadcastNotification(`Game started! It's ${this.cur().name}'s turn.`);
  }

  cur() { return this.players[this.currentPlayerIndex]; }

  nextTurn() {
    this.drawnCard = null;
    const connected = this.players.filter(p => p.connected).length;
    if (connected === 0) return;
    let safety = this.players.length + 1;
    do {
      this.currentPlayerIndex = ((this.currentPlayerIndex + this.direction) % this.players.length + this.players.length) % this.players.length;
      safety--;
    } while (!this.players[this.currentPlayerIndex].connected && safety > 0);
  }

  // ── Card validation ───────────────────────────────────
  isValidPlay(card) {
    if (card.type === 'wild' || card.type === 'wild4') return true;
    const top = this.topCard();
    if (card.color === this.currentColor) return true;
    if (card.type === 'number' && top.type === 'number' && card.value === top.value) return true;
    if (card.type !== 'number' && card.type === top.type) return true;
    return false;
  }

  topCard() { return this.discardPile[this.discardPile.length - 1]; }

  hasPlayableCard(player) {
    return player.hand.some(c => this.isValidPlay(c));
  }

  // ── Actions ───────────────────────────────────────────
  playCard(playerId, cardId, chosenColor) {
    const player = this.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found');
    if (player.id !== this.cur().id) throw new Error("Not your turn");

    const ci = player.hand.findIndex(c => c.id === cardId);
    if (ci === -1) throw new Error('Card not in hand');

    const card = player.hand[ci];
    if (!this.isValidPlay(card)) throw new Error('Invalid play');
    if ((card.type === 'wild' || card.type === 'wild4') && !chosenColor) {
      throw new Error('Must choose a color for wild cards');
    }

    // Remove from hand, add to discard
    player.hand.splice(ci, 1);
    this.discardPile.push(card);

    // Set color
    this.currentColor = (card.type === 'wild' || card.type === 'wild4') ? chosenColor : card.color;

    // Log it
    const cn = this.currentColor.charAt(0).toUpperCase() + this.currentColor.slice(1);
    if (card.type === 'number') this.log(`${player.name} played ${cn} ${card.value}`);
    else if (card.type === 'wild') this.log(`${player.name} played Wild → ${cn}`);
    else if (card.type === 'wild4') this.log(`${player.name} played Wild Draw 4 → ${cn}`);
    else {
      const label = card.type === 'draw2' ? 'Draw 2' : card.type === 'skip' ? 'Skip' : 'Reverse';
      this.log(`${player.name} played ${cn} ${label}`);
    }

    // Win check
    if (player.hand.length === 0) {
      this.state = 'finished';
      this.broadcastGameOver(player);
      return;
    }

    // Apply effects (may skip additional players)
    this.applyEffect(card);
    this.nextTurn();
    this.broadcastState();
  }

  applyEffect(card) {
    const n = this.players.length;
    switch (card.type) {
      case 'skip':
        if (n === 2) {
          // no extra nextTurn needed — nextTurn in playCard already skips
        } else {
          this.nextTurn(); // skip one more
        }
        break;

      case 'reverse':
        this.direction *= -1;
        if (n === 2) this.nextTurn(); // reverse = skip in 2-player
        break;

      case 'draw2': {
        const vi = ((this.currentPlayerIndex + this.direction) % n + n) % n;
        const victim = this.players[vi];
        victim.hand.push(...this.drawFromDeck(2));
        victim.calledUno = false;
        this.log(`${victim.name} draws 2 cards and is skipped!`);
        this.nextTurn();
        break;
      }

      case 'wild4': {
        const vi2 = ((this.currentPlayerIndex + this.direction) % n + n) % n;
        const victim2 = this.players[vi2];
        victim2.hand.push(...this.drawFromDeck(4));
        victim2.calledUno = false;
        this.log(`${victim2.name} draws 4 cards and is skipped!`);
        this.nextTurn();
        break;
      }
    }
  }

  drawCard(playerId) {
    const player = this.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found');
    if (player.id !== this.cur().id) throw new Error("Not your turn");
    if (this.drawnCard) throw new Error('Already drew a card this turn');

    const cards = this.drawFromDeck(1);
    if (cards.length === 0) throw new Error('No cards left in deck');

    const card = cards[0];
    player.hand.push(card);
    player.calledUno = false;
    this.drawnCard = card;

    this.log(`${player.name} drew a card`);

    const canPlay = this.isValidPlay(card);
    send(player.ws, { type: 'drawnCard', card, canPlay });

    if (!canPlay) {
      this.drawnCard = null;
      this.nextTurn();
    }
    this.broadcastState();
  }

  playDrawnCard(playerId, chosenColor) {
    if (!this.drawnCard) throw new Error('No drawn card');
    this.playCard(playerId, this.drawnCard.id, chosenColor);
  }

  keepDrawnCard(playerId) {
    const player = this.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found');
    if (player.id !== this.cur().id) throw new Error("Not your turn");
    this.log(`${player.name} kept the drawn card`);
    this.drawnCard = null;
    this.nextTurn();
    this.broadcastState();
  }

  callUno(playerId) {
    const player = this.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found');
    player.calledUno = true;
    this.broadcastNotification(`🎴 ${player.name} called UNO!`);
    this.broadcastState();
  }

  catchUno(catcherId, targetId) {
    const catcher = this.players.find(p => p.id === catcherId);
    const target = this.players.find(p => p.id === targetId);
    if (!catcher || !target) throw new Error('Player not found');
    if (target.hand.length !== 1) throw new Error('Target does not have 1 card');
    if (target.calledUno) throw new Error('They already called UNO');

    target.hand.push(...this.drawFromDeck(2));
    target.calledUno = false;
    this.log(`🚨 ${catcher.name} caught ${target.name}! +2 penalty cards!`);
    this.broadcastNotification(`🚨 ${catcher.name} caught ${target.name}!`);
    this.broadcastState();
  }

  // ── Broadcasting ──────────────────────────────────────
  log(msg) {
    this.actionLog.push({ message: msg, ts: Date.now() });
    if (this.actionLog.length > 50) this.actionLog.shift();
  }

  stateForPlayer(player) {
    return {
      type: 'gameState',
      hand: player.hand,
      topCard: this.topCard(),
      topColor: this.currentColor,
      currentPlayerId: this.cur().id,
      direction: this.direction,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        cardCount: p.hand.length,
        calledUno: p.calledUno,
        connected: p.connected,
        isHost: p.id === this.hostId
      })),
      myId: player.id,
      drawPileCount: this.deck.length,
      isMyTurn: player.id === this.cur().id,
      hasDrawnCard: this.drawnCard !== null && player.id === this.cur().id,
      catchable: this.players
        .filter(p => p.id !== player.id && p.hand.length === 1 && !p.calledUno)
        .map(p => ({ id: p.id, name: p.name })),
      log: this.actionLog.slice(-10),
      gameState: this.state
    };
  }

  broadcastState() {
    for (const p of this.players) {
      if (p.connected) send(p.ws, this.stateForPlayer(p));
    }
  }

  broadcastNotification(message) {
    for (const p of this.players) send(p.ws, { type: 'notification', message });
  }

  broadcastGameOver(winner) {
    let score = 0;
    for (const p of this.players) {
      for (const c of p.hand) {
        if (c.type === 'number') score += c.value;
        else if (['skip', 'reverse', 'draw2'].includes(c.type)) score += 20;
        else score += 50;
      }
    }
    for (const p of this.players) {
      send(p.ws, {
        type: 'gameOver',
        winnerId: winner.id,
        winnerName: winner.name,
        score,
        players: this.players.map(pl => ({
          id: pl.id, name: pl.name, cardCount: pl.hand.length, hand: pl.hand
        }))
      });
    }
  }

  lobbyState() {
    return {
      type: 'lobbyUpdate',
      roomCode: this.roomCode,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        isHost: p.id === this.hostId,
        connected: p.connected
      })),
      hostId: this.hostId
    };
  }

  broadcastLobby() {
    for (const p of this.players) {
      if (p.connected) send(p.ws, this.lobbyState());
    }
  }

  resetForNewGame() {
    this.state = 'lobby';
    for (const p of this.players) {
      p.hand = [];
      p.calledUno = false;
    }
    this.deck = [];
    this.discardPile = [];
    this.actionLog = [];
    this.drawnCard = null;
    this.currentPlayerIndex = 0;
    this.direction = 1;
  }
}

// ─── WebSocket Handling ───────────────────────────────────
wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return send(ws, { type: 'error', message: 'Invalid JSON' }); }

    const info = playerRooms.get(ws);
    const roomCode = info?.roomCode;
    const playerId = info?.playerId;
    const game = roomCode ? rooms.get(roomCode) : null;

    try {
      switch (msg.type) {

        case 'createRoom': {
          const code = generateRoomCode();
          const pid = generatePlayerId();
          const g = new UnoGame(code);
          g.addPlayer(pid, (msg.playerName || 'Player').substring(0, 20), ws);
          rooms.set(code, g);
          playerRooms.set(ws, { roomCode: code, playerId: pid });
          send(ws, { type: 'roomCreated', roomCode: code, playerId: pid });
          g.broadcastLobby();
          break;
        }

        case 'joinRoom': {
          const code = (msg.roomCode || '').toUpperCase().trim();
          const g = rooms.get(code);
          if (!g) return send(ws, { type: 'error', message: 'Room not found. Check the code and try again.' });
          const pid = generatePlayerId();
          g.addPlayer(pid, (msg.playerName || 'Player').substring(0, 20), ws);
          playerRooms.set(ws, { roomCode: code, playerId: pid });
          send(ws, { type: 'roomJoined', roomCode: code, playerId: pid });
          g.broadcastLobby();
          break;
        }

        case 'startGame':
          if (!game) return;
          if (playerId !== game.hostId) return send(ws, { type: 'error', message: 'Only the host can start the game' });
          game.startGame();
          break;

        case 'playCard':
          if (!game) return;
          game.playCard(playerId, msg.cardId, msg.chosenColor || null);
          break;

        case 'drawCard':
          if (!game) return;
          game.drawCard(playerId);
          break;

        case 'playDrawnCard':
          if (!game) return;
          game.playDrawnCard(playerId, msg.chosenColor || null);
          break;

        case 'keepDrawnCard':
          if (!game) return;
          game.keepDrawnCard(playerId);
          break;

        case 'callUno':
          if (!game) return;
          game.callUno(playerId);
          break;

        case 'catchUno':
          if (!game) return;
          game.catchUno(playerId, msg.targetId);
          break;

        case 'playAgain':
          if (!game) return;
          if (playerId !== game.hostId) return send(ws, { type: 'error', message: 'Only the host can restart' });
          game.resetForNewGame();
          game.broadcastLobby();
          break;

        default:
          send(ws, { type: 'error', message: 'Unknown message type' });
      }
    } catch (e) {
      send(ws, { type: 'error', message: e.message });
    }
  });

  ws.on('close', () => {
    const info = playerRooms.get(ws);
    if (!info) return;
    const game = rooms.get(info.roomCode);
    if (game) {
      game.removePlayer(info.playerId);
      if (game.players.every(p => !p.connected)) {
        rooms.delete(info.roomCode);
        console.log(`Room ${info.roomCode} deleted (empty)`);
      } else {
        game.state === 'lobby' ? game.broadcastLobby() : game.broadcastState();
      }
    }
    playerRooms.delete(ws);
  });
});

// ─── Start Server ─────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n  🎴  UNO Server running at http://localhost:${PORT}\n`);
});
