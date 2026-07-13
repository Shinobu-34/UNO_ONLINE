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
    this.unoCatchablePlayerId = null;
    this.currentTheme = 'classic';
    this.botTimer = null;       // pending bot-turn setTimeout handle
    this.botCatchTimer = null;  // pending bot-catch setTimeout handle
  }

  // ── Player management ────────────────────────────────
  addPlayer(id, name, ws, pfp) {
    if (this.players.length >= 8) throw new Error('Room is full (max 8 players)');
    if (this.state !== 'lobby') throw new Error('Game already in progress');
    const player = { id, name, ws, hand: [], calledUno: false, connected: true, isBot: false, pfp: pfp || null };
    this.players.push(player);
    if (this.players.length === 1) this.hostId = id;
    return player;
  }

  removePlayer(playerId) {
    const idx = this.players.findIndex(p => p.id === playerId);
    if (idx === -1) return;

    const isHostLeaving = (this.hostId === playerId);

    if (this.state === 'lobby') {
      this.players.splice(idx, 1);
      if (this.players.length > 0 && isHostLeaving) {
        this.hostId = this.players[0].id;
      }
    } else if (this.state === 'finished') {
      // Game is over (state is 'finished')
      // If the host leaves, delete the entire room / notify players
      if (isHostLeaving) {
        this.closeRoom('The host has left. The room is closed.');
        return;
      }
      // If a regular player leaves after game over, just remove them
      this.players.splice(idx, 1);
    } else {
      const disconnectedName = this.players[idx].name; // capture name before nulling ws
      this.players[idx].connected = false;
      this.players[idx].ws = null;

      // If the disconnected player was the victim of a pending draw, resolve it immediately (auto-accept)
      if (this.pendingDraw && this.pendingDraw.victimId === playerId) {
        clearTimeout(this.drawTimer);
        this.drawTimer = null;
        // Give the disconnected player their penalty cards and advance to next turn
        const victim = this.players[idx];
        victim.hand.push(...this.drawFromDeck(this.pendingDraw.accumulatedDraw));
        this.log(`${disconnectedName} disconnected and auto-drew ${this.pendingDraw.accumulatedDraw} cards.`);
        this.currentPlayerIndex = this.pendingDraw.victimIdx;
        this.pendingDraw = null;
        this.nextTurn();
        this.broadcastState();
        this.broadcastNotification(`${disconnectedName} disconnected. Penalty auto-resolved. Skipping their turn.`);
        return;
      }

      // If the disconnected player is the current active player, skip their turn
      if (this.currentPlayerIndex === idx) {
        // If they had an active pendingDraw they initiated, clear it
        if (this.pendingDraw && this.pendingDraw.playerId === playerId) {
          clearTimeout(this.drawTimer);
          this.drawTimer = null;
          this.pendingDraw = null;
        }
        this.nextTurn();
        this.broadcastState();
        this.broadcastNotification(`${disconnectedName} disconnected. Skipping their turn.`);
      }
    }
  }

  closeRoom(reason) {
    // Cancel any pending bot timers so they don't fire after the room is gone
    if (this.botTimer) { clearTimeout(this.botTimer); this.botTimer = null; }
    if (this.botCatchTimer) { clearTimeout(this.botCatchTimer); this.botCatchTimer = null; }
    // Notify all connected human players
    for (const p of this.players) {
      if (p.connected && p.ws) {
        send(p.ws, { type: 'roomClosed', reason });
      }
    }
    // Delete the room from storage
    rooms.delete(this.roomCode);
  }

  kickPlayer(targetId) {
    if (this.state !== 'lobby') throw new Error('Cannot kick players once the game has started');
    const idx = this.players.findIndex(p => p.id === targetId);
    if (idx === -1) return;

    const kickedPlayer = this.players[idx];

    // Send a message to the kicked player so they know they were kicked and return to home screen
    if (kickedPlayer.ws) {
      send(kickedPlayer.ws, { type: 'kicked', reason: 'You have been removed from the room by the host.' });
    }

    // Remove them from the list
    this.players.splice(idx, 1);

    this.broadcastNotification(`${kickedPlayer.name} was removed from the room.`);
    this.broadcastLobby();
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

  // ── Bot Management ──────────────────────────────────
  addBot() {
    if (this.state !== 'lobby') throw new Error('Cannot add bots after the game has started');
    const botCount = this.players.filter(p => p.isBot).length;
    if (botCount >= 4) throw new Error('Maximum of 4 bots allowed per room');
    if (this.players.length >= 8) throw new Error('Room is full (max 8 players)');
    const BOT_NAMES = ['Alex', 'Sam', 'Jordan', 'Casey'];
    const usedBotNames = this.players.filter(p => p.isBot).map(p => p.name);
    const available = BOT_NAMES.find(n => !usedBotNames.includes('Bot ' + n));
    const botName = available ? 'Bot ' + available : 'Bot ' + (botCount + 1);
    const botId = 'bot_' + Math.random().toString(36).substring(2, 9);
    this.players.push({
      id: botId, name: botName, ws: null,
      hand: [], calledUno: false, connected: true, isBot: true, pfp: null
    });
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
    if (card.type === 'wild') return true;
    // Wild Draw 4: can ONLY be played if player has NO cards matching current color
    if (card.type === 'wild4') {
      const player = this.cur();
      const hasMatchingColor = player.hand.some(
        c => c.id !== card.id && c.color === this.currentColor
      );
      // Allow it to be played (server will track legality for challenges)
      // But we return true to allow the play — challenge handles enforcement
      return true;
    }
    const top = this.topCard();
    if (card.color === this.currentColor) return true;
    if (card.type === 'number' && top.type === 'number' && card.value === top.value) return true;
    if (card.type !== 'number' && card.type === top.type) return true;
    return false;
  }

  // Check if Wild Draw 4 was played legally (no matching color cards in hand)
  wasWild4Legal(player, originalHand) {
    return !originalHand.some(c => c.color === this.currentColor);
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

    // Starting a play clears any active catchable status from the previous turn
    this.unoCatchablePlayerId = null;

    const ci = player.hand.findIndex(c => c.id === cardId);
    if (ci === -1) throw new Error('Card not in hand');

    const card = player.hand[ci];
    if (!this.isValidPlay(card)) throw new Error('Invalid play');
    if ((card.type === 'wild' || card.type === 'wild4') && !chosenColor) {
      throw new Error('Must choose a color for wild cards');
    }

    // For Wild Draw 4, track legality for possible challenge
    let wild4Legal = true;
    if (card.type === 'wild4') {
      // Check BEFORE removing the card: did the player have any matching color cards?
      wild4Legal = !player.hand.some(c => c.id !== card.id && c.color === this.currentColor);
    }

    // Remove from hand, add to discard
    player.hand.splice(ci, 1);
    this.discardPile.push(card);

    // Set color
    this.currentColor = (card.type === 'wild' || card.type === 'wild4') ? chosenColor : card.color;

    const cn = this.currentColor.charAt(0).toUpperCase() + this.currentColor.slice(1);
    if (card.type === 'number') this.log(`${player.name} played ${cn} ${card.value}`);
    else if (card.type === 'wild') this.log(`${player.name} played Wild → ${cn}`);
    else if (card.type === 'wild4') this.log(`${player.name} played Wild Draw 4 → ${cn}`);
    else {
      const label = card.type === 'draw2' ? 'Draw 2' : card.type === 'skip' ? 'Skip' : 'Reverse';
      this.log(`${player.name} played ${cn} ${label}`);
    }

    if (player.hand.length === 0) {
      this.state = 'finished';
      this.broadcastGameOver(player);
      return;
    }

    if (player.hand.length !== 1) player.calledUno = false;
    if (player.hand.length === 1 && !player.calledUno) this.unoCatchablePlayerId = player.id;
    // If a bot pre-called UNO, broadcast the notification now (before broadcastState)
    if (player.hand.length === 1 && player.calledUno && player.isBot) {
      this.broadcastNotification(`🎴 ${player.name} called UNO!`);
    }

    // For Wild Draw 4 and Draw 2: enter Stack or Draw phase
    if (card.type === 'wild4' || card.type === 'draw2') {
      const penalty = card.type === 'wild4' ? 4 : 2;
      this.pendingDraw = {
        playerId: player.id,
        playerName: player.name,
        cardType: card.type,
        accumulatedDraw: penalty,
        chosenColor: this.currentColor
      };

      const n = this.players.length;
      const victimIdx = ((this.currentPlayerIndex + this.direction) % n + n) % n;
      const victim = this.players[victimIdx];
      this.pendingDraw.victimId = victim.id;
      this.pendingDraw.victimIdx = victimIdx;

      this.drawTimer = setTimeout(() => {
        this.acceptDraw(victim.id);
      }, 10000);

      this.broadcastState();
      return;
    }

    this.applyEffect(card);
    this.nextTurn();
    this.broadcastState();
  }

  acceptDraw(playerId) {
    if (!this.pendingDraw) return;
    if (this.pendingDraw.victimId !== playerId) return;

    clearTimeout(this.drawTimer);

    const { victimId, victimIdx, accumulatedDraw } = this.pendingDraw;
    const victim = this.players.find(p => p.id === victimId);

    victim.hand.push(...this.drawFromDeck(accumulatedDraw));
    victim.calledUno = false;
    this.log(`${victim.name} draws ${accumulatedDraw} cards and is skipped!`);

    this.pendingDraw = null;
    this.currentPlayerIndex = victimIdx;
    this.nextTurn();
    this.broadcastState();
  }

  stackDraw(playerId, cardId, chosenColor) {
    if (!this.pendingDraw) return;
    if (this.pendingDraw.victimId !== playerId) return;

    const player = this.players.find(p => p.id === playerId);
    const cardIdx = player.hand.findIndex(c => c.id === cardId);
    if (cardIdx === -1) return;
    const card = player.hand[cardIdx];
    
    if (card.type !== this.pendingDraw.cardType) return;

    clearTimeout(this.drawTimer);

    player.hand.splice(cardIdx, 1);
    this.discardPile.push(card);
    
    if (card.type === 'wild4') {
      this.currentColor = chosenColor;
    } else {
      this.currentColor = card.color || this.currentColor;
    }

    // UNO check: match playCard() pattern — make player catchable instead of auto-penalizing
    if (player.hand.length !== 1) player.calledUno = false;
    if (player.hand.length === 1 && !player.calledUno) {
      this.unoCatchablePlayerId = player.id;
    }
    // If a bot pre-called UNO, broadcast the notification now (before broadcastState)
    if (player.hand.length === 1 && player.calledUno && player.isBot) {
      this.broadcastNotification(`🎴 ${player.name} called UNO!`);
    }

    this.currentPlayerIndex = this.pendingDraw.victimIdx;
    
    const n = this.players.length;
    const nextVictimIdx = ((this.currentPlayerIndex + this.direction) % n + n) % n;
    const nextVictim = this.players[nextVictimIdx];
    
    const increment = card.type === 'wild4' ? 4 : 2;
    const newDrawAmount = this.pendingDraw.accumulatedDraw + increment;

    this.pendingDraw = {
      playerId: player.id,
      playerName: player.name,
      victimId: nextVictim.id,
      victimIdx: nextVictimIdx,
      cardType: card.type,
      chosenColor: this.currentColor,
      accumulatedDraw: newDrawAmount
    };

    this.log(`💥 ${player.name} stacked a +${increment}! ${nextVictim.name} faces +${newDrawAmount}!`);

    this.drawTimer = setTimeout(() => {
      this.acceptDraw(nextVictim.id);
    }, 10000);

    if (player.hand.length === 0) {
      this.state = 'finished';
      this.broadcastGameOver(player);
      return;
    }

    this.broadcastState();
  }

  applyEffect(card) {
    const n = this.players.length;
    switch (card.type) {
      case 'skip':
        this.nextTurn();
        break;
      case 'reverse':
        this.direction *= -1;
        if (n === 2) this.nextTurn();
        break;
    }
  }

  drawCard(playerId) {
    const player = this.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found');
    if (player.id !== this.cur().id) throw new Error("Not your turn");
    if (this.pendingDraw) throw new Error('A draw penalty is pending — stack or accept it first');

    this.unoCatchablePlayerId = null;
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
    if (this.unoCatchablePlayerId === playerId) {
      this.unoCatchablePlayerId = null;
    }
    this.broadcastNotification(`🎴 ${player.name} called UNO!`);
    this.broadcastState();
  }

  catchUno(catcherId, targetId) {
    const catcher = this.players.find(p => p.id === catcherId);
    const target = this.players.find(p => p.id === targetId);
    if (!catcher || !target) throw new Error('Player not found');
    if (target.id !== this.unoCatchablePlayerId) {
      throw new Error('Player cannot be caught or already called UNO / turn progressed');
    }

    target.hand.push(...this.drawFromDeck(2));
    target.calledUno = false;
    this.unoCatchablePlayerId = null;
    this.log(`🚨 ${catcher.name} caught ${target.name}! +2 penalty cards!`);
    this.broadcastNotification(`🚨 ${catcher.name} caught ${target.name}! +2 cards!`);
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
        isHost: p.id === this.hostId,
        isBot: p.isBot || false,
        pfp: p.pfp
      })),
      myId: player.id,
      drawPileCount: this.deck.length,
      isMyTurn: player.id === this.cur().id && !this.pendingDraw,
      hasDrawnCard: this.drawnCard !== null && player.id === this.cur().id,
      drawnCard: (this.drawnCard !== null && player.id === this.cur().id) ? this.drawnCard : null,
      pendingDraw: this.pendingDraw ? {
        victimId: this.pendingDraw.victimId,
        playerName: this.pendingDraw.playerName,
        cardType: this.pendingDraw.cardType,
        accumulatedDraw: this.pendingDraw.accumulatedDraw
      } : null,
      catchable: this.unoCatchablePlayerId && this.unoCatchablePlayerId !== player.id
        ? [this.players.find(p => p.id === this.unoCatchablePlayerId)].filter(Boolean).map(p => ({ id: p.id, name: p.name }))
        : [],
      log: this.actionLog.slice(-10),
      gameState: this.state,
      currentTheme: this.currentTheme
    };
  }

  broadcastState() {
    for (const p of this.players) {
      if (p.connected) send(p.ws, this.stateForPlayer(p));
    }
    // After every state push, schedule the next bot action if needed
    this.scheduleBotTurn();
    this.scheduleBotCatch();
  }

  broadcastNotification(message) {
    for (const p of this.players) {
      if (p.connected && p.ws) send(p.ws, { type: 'notification', message });
    }
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
        connected: p.connected,
        isBot: p.isBot || false,
        pfp: p.pfp
      })),
      hostId: this.hostId,
      currentTheme: this.currentTheme
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
    this.pendingDraw = null;
    if (this.drawTimer) clearTimeout(this.drawTimer);
    this.drawTimer = null;
    this.currentPlayerIndex = 0;
    this.direction = 1;
    this.unoCatchablePlayerId = null;
    if (this.botTimer) { clearTimeout(this.botTimer); this.botTimer = null; }
    if (this.botCatchTimer) { clearTimeout(this.botCatchTimer); this.botCatchTimer = null; }
    // Remove disconnected human players; keep bots for the next game
    this.players = this.players.filter(p => p.isBot || p.connected);
  }

  // ── Bot AI ─────────────────────────────────────────────

  scheduleBotTurn() {
    if (this.state !== 'playing') return;
    if (this.botTimer) { clearTimeout(this.botTimer); this.botTimer = null; }

    // Determine which bot should act:
    // • If a pendingDraw is active, check if the victim is a bot
    // • Otherwise, check if the current player is a bot
    let targetBot = null;
    if (this.pendingDraw) {
      targetBot = this.players.find(
        p => p.id === this.pendingDraw.victimId && p.isBot && p.connected
      ) || null;
    } else {
      const cur = this.cur();
      targetBot = (cur && cur.isBot && cur.connected) ? cur : null;
    }
    if (!targetBot) return;

    const delay = 4000 + Math.random() * 1000; // 4–5 second human-like delay
    const botId = targetBot.id;
    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      this.performBotTurn(botId);
    }, delay);
  }

  performBotTurn(botId) {
    if (this.state !== 'playing') return;
    const bot = this.players.find(p => p.id === botId);
    if (!bot || !bot.isBot || !bot.connected) return;

    // ── Branch 1: Bot is the pending-draw victim (stack or accept) ──
    if (this.pendingDraw && this.pendingDraw.victimId === botId) {
      // Always stack a matching +2 or +4 if available; otherwise accept the draw
      const stackCard = bot.hand.find(c => c.type === this.pendingDraw.cardType);
      if (stackCard) {
        // Pre-call UNO if stacking will leave bot with 1 card
        const willHaveOneCard = bot.hand.length === 2;
        if (willHaveOneCard) bot.calledUno = true;
        const chosenColor = stackCard.type === 'wild4' ? this.pickBestColor(bot) : null;
        try { this.stackDraw(botId, stackCard.id, chosenColor); }
        catch (e) {
          if (willHaveOneCard) bot.calledUno = false;
          console.error('[Bot] stackDraw error:', e.message);
        }
      } else {
        try { this.acceptDraw(botId); }
        catch (e) { console.error('[Bot] acceptDraw error:', e.message); }
      }
      return;
    }

    // ── Ensure it's still this bot's turn ───────────────────────────
    if (!this.cur() || this.cur().id !== botId) return;

    // ── Branch 2: Bot already drew a card this turn ─────────────────
    // drawCard() only keeps drawnCard set when the card IS playable,
    // so we can always attempt to play it here.
    if (this.drawnCard) {
      const card = this.drawnCard;
      const chosenColor = (card.type === 'wild' || card.type === 'wild4')
        ? this.pickBestColor(bot) : null;
      const willHaveOneCard = bot.hand.length === 2;
      if (willHaveOneCard) bot.calledUno = true;
      try {
        this.playDrawnCard(botId, chosenColor);
      } catch (e) {
        bot.calledUno = false;
        try { this.keepDrawnCard(botId); }
        catch (e2) { console.error('[Bot] keepDrawnCard error:', e2.message); }
      }
      return;
    }

    // ── Branch 3: Normal turn – pick the best card or draw ──────────
    const playable = bot.hand.filter(c => this.isValidPlay(c));
    if (playable.length === 0) {
      try { this.drawCard(botId); }
      catch (e) { console.error('[Bot] drawCard error:', e.message); }
      return;
    }

    const card = this.pickBestCard(bot, playable);
    const chosenColor = (card.type === 'wild' || card.type === 'wild4')
      ? this.pickBestColor(bot) : null;

    // Pre-mark UNO before the play so unoCatchablePlayerId is never set for bots
    const willHaveOneCard = bot.hand.length === 2;
    if (willHaveOneCard) bot.calledUno = true;

    try {
      this.playCard(botId, card.id, chosenColor);
    } catch (e) {
      bot.calledUno = false; // revert on failure
      console.error('[Bot] playCard error:', e.message);
    }
  }

  // Choose the best playable card based on game situation
  pickBestCard(bot, playable) {
    const numbers  = playable.filter(c => c.type === 'number');
    const skips    = playable.filter(c => c.type === 'skip');
    const reverses = playable.filter(c => c.type === 'reverse');
    const draw2s   = playable.filter(c => c.type === 'draw2');
    const wilds    = playable.filter(c => c.type === 'wild');
    const wild4s   = playable.filter(c => c.type === 'wild4');

    // Aggressive mode: an opponent has ≤2 cards — go for the kill
    const someoneWinning = this.players.some(
      p => p.id !== bot.id && p.connected && p.hand.length <= 2
    );
    if (someoneWinning) {
      if (wild4s.length)   return wild4s[0];
      if (draw2s.length)   return draw2s[0];
      if (skips.length)    return skips[0];
      if (reverses.length) return reverses[0];
      if (wilds.length)    return wilds[0];
      if (numbers.length)  return numbers[Math.floor(Math.random() * numbers.length)];
    }

    // Conservative mode: burn numbers/actions first, save wilds for later
    if (numbers.length)  return numbers[Math.floor(Math.random() * numbers.length)];
    if (skips.length)    return skips[0];
    if (reverses.length) return reverses[0];
    if (draw2s.length)   return draw2s[0];
    if (wilds.length)    return wilds[0];
    return wild4s[0]; // last resort
  }

  // Return the color the bot has the most of (greedy strategy)
  pickBestColor(bot) {
    const counts = { red: 0, blue: 0, green: 0, yellow: 0 };
    for (const c of bot.hand) {
      if (c.color && counts[c.color] !== undefined) counts[c.color]++;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] || 'red';
  }

  // Schedule a bot to catch a human player who forgot to call UNO
  scheduleBotCatch() {
    if (this.botCatchTimer) { clearTimeout(this.botCatchTimer); this.botCatchTimer = null; }
    if (!this.unoCatchablePlayerId) return;

    // Only attempt to catch human players (bots never forget UNO)
    const target = this.players.find(
      p => p.id === this.unoCatchablePlayerId && !p.isBot
    );
    if (!target) return;

    const bots = this.players.filter(p => p.isBot && p.connected);
    if (bots.length === 0) return;

    const catcher = bots[Math.floor(Math.random() * bots.length)];
    const delay = 2000 + Math.random() * 2500; // 2–4.5 second reaction window

    this.botCatchTimer = setTimeout(() => {
      this.botCatchTimer = null;
      if (this.unoCatchablePlayerId !== target.id) return; // window already closed
      try { this.catchUno(catcher.id, target.id); } catch (e) { /* window closed */ }
    }, delay);
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
          g.addPlayer(pid, (msg.playerName || 'Player').substring(0, 20), ws, msg.pfp || null);
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
          g.addPlayer(pid, (msg.playerName || 'Player').substring(0, 20), ws, msg.pfp || null);
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

        case 'acceptDraw':
          if (!game) return;
          game.acceptDraw(playerId);
          break;

        case 'stackDraw':
          if (!game) return;
          game.stackDraw(playerId, msg.cardId, msg.chosenColor || null);
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

        case 'kickPlayer':
          if (!game) return;
          if (playerId !== game.hostId) return send(ws, { type: 'error', message: 'Only the host can kick players' });
          game.kickPlayer(msg.targetId);
          break;

        case 'changeTheme':
          if (!game) return;
          if (playerId !== game.hostId) return send(ws, { type: 'error', message: 'Only the host can change the theme' });
          game.currentTheme = msg.theme;
          if (game.state === 'lobby') game.broadcastLobby();
          else game.broadcastState();
          break;

        case 'addBot':
          if (!game) return;
          if (playerId !== game.hostId) return send(ws, { type: 'error', message: 'Only the host can add bots' });
          game.addBot();
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
