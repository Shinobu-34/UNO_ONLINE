# 🎴 UNO Online Multiplayer Card Game

A premium, real-time multiplayer UNO card game built with Node.js, Express, and WebSockets. Designed for 2 to 8 players to play together across different devices with responsive layouts and beautifully styled themes.

## 🚀 Key Features

- **Real-Time Multiplayer**: Join with 2-8 friends on any device via WebSocket connection rooms.
- **Server-Authoritative Game Engine**: Standard UNO rules (Draw 2 / Wild Draw 4 penalty stacks and challenges, valid card checks, turn progression, automatic deck reshuffling).
- **Custom Player Profile Avatars**:
  - Crop and Zoom custom image uploads using an interactive Canvas-based Profile Crop Modal.
  - Fallbacks to retro emojis and avatar colors for players without custom profile photos.
- **Balanced 3-Column Lobby UI**:
  - Clean CSS Grid layout neatly separating Game Action Controls (left), Room Code & Player Roster (center), and Theme Customization (right).
  - **Scrollable Player & Bot Roster**: Dedicated vertical scroll container with custom glassmorphic scrollbars supporting up to 8 players/bots without layout shifting.
- **AI Bot Players**: Host-controlled addition of AI bots directly from the lobby action panel.
- **6 Premium Pure-CSS Themes**: Host-controlled themes synchronized across all players dynamically:
  1. **Classic Felt (Default)**: Traditional blue mat with a wooden rim and standard card gradients.
  2. **Neon Cyberpunk**: Cyber grid table, glowing cyan-magenta frames, and pitch-black cards with self-glowing neon elements.
  3. **Royal Casino**: Luxurious crimson velvet table, thick golden metallic rim, and off-white casino playing cards with gold trims and custom-colored values.
  4. **Retro Arcade**: Flat high-contrast pixel colors, thick block borders, pixelated values, and snappy, step-based transitions.
  5. **Ethereal Glass**: Frosted glass tablemat over a lavender pastel gradient, translucent cards, and a slow, floating hover animation.
  6. **Dark Matter Void**: Starry border, deep purple radial gradient void table, and matte-black cards with glowing laser borders.
- **Dynamic Lobby Previews**: Swatch previews showing a mini 3D table and card illustration for each theme before selection in the lobby.
- **Active Theme outlines**: Bright outline ring styled on the selected theme preview swatch to identify which style is in active use.
- **Interactive Action Log**: Visual activity feed logging card plays, challenges, stacking events, and penalties.
- **Stack & Decline Penalty Dialogs**: Visual modal tracking Draw 2/4 stack status, showing a countdown timer to stack matching cards or decline to draw.
- **Winner Celebration**: Confetti animations and scoring summaries when a player discards their final card.

---

## 🛠️ Local Setup

To run the game on your local machine:

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the server:**
   ```bash
   npm run dev
   ```
   or
   ```bash
   node server.js
   ```

3. **Play the game:**
   - Open your browser and navigate to `http://localhost:3000`.
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

---
## 🤖 WORKING UNO:- 
   https://uno-online-oao9.onrender.com
   
---

&copy; 2026 Shinobu-34. All Rights Reserved
