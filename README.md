# 🎴 UNO Online Multiplayer Card Game

A premium, real-time multiplayer UNO card game built with Node.js, Express, and WebSockets. Designed for 2 to 8 players to play together across different devices.

![UNO Game Preview](public/cards.js) *(Premium CSS-based responsive UI with glassmorphism and neon glows)*

## 🚀 Features

- **Real-Time Multiplayer**: Play with 2-8 friends on any device via WebSocket connections.
- **Server-Authoritative Game Engine**: Standard UNO rule enforcement (no stacking, valid card validation, turn logic, auto-reshuffle).
- **Interactive Action Log**: Visual activity feed keeps track of everyone's moves.
- **Room System**: Host games with simple 4-character room codes.
- **UNO Call & Catch**: Click the "UNO!" button when you have 1 card left, or catch opponents who forgot!
- **Sleek UI**: Dark theme, glassmorphic panels, neon glows, micro-animations, and celebratory confetti for the winner.

---

## 🛠️ Local Setup

To run the game on your local computer:

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the server:**
   ```bash
   npm run dev
   ```

3. **Play the game:**
   - Open your browser and navigate to `http://localhost:3000`
   - To play with friends on the same local network, find your local IP address (e.g., `192.168.x.x`) and have them connect to `http://YOUR_IP:3000`.

---

## ☁️ Deploying to Render.com

This project is pre-configured with a `render.yaml` blueprint.

1. Connect your GitHub repository to **Render.com**.
2. Click **New** > **Web Service**.
3. Select your `UNO_ONLINE` repository.
4. Render will automatically read the configuration:
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
5. Click **Deploy Web Service** and enjoy your online game!
