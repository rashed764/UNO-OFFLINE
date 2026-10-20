/**
 * LocalP2PManager & Offline Event Bus for UNO! 3D
 * Replaces Node.js & Socket.io runtime with 100% client-side execution:
 * 1. Single-player (Vs AI): Runs local authoritative GameEngine & BotPlayer instances in browser.
 * 2. Local P2P Multiplayer: Uses WebRTC RTCDataChannel with QR Code signaling for zero-data LAN play.
 */
'use strict';

(function (root) {
  // Simple UUID / ID generator
  function generateId(prefix = 'id') {
    return prefix + '_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
  }

  class LocalP2PManager {
    constructor() {
      this.id = 'client_' + Math.random().toString(36).substring(2, 8);
      this.events = new Map();
      this.mode = null; // 'ai', 'p2p_host', 'p2p_client'
      this.roomId = null;
      this.isHost = false;
      this.walletId = null;
      this.adminMode = false;

      // In-Memory Authoritative Engine (For AI mode and P2P Host mode)
      this.engine = null;
      this.aiTimeout = null;
      this.aiTurnToken = 0;

      // WebRTC Peer Connections
      // Host: Map of peerId -> { pc, channel, name }
      this.hostPeers = new Map();
      // Client: single peer connection & channel to Host
      this.clientPc = null;
      this.clientChannel = null;

      // Wallet & Economy
      this.walletDatabase = null;
    }

    init() {
      if (root.WalletDatabase) {
        this.walletDatabase = new root.WalletDatabase();
      }
      this.connected = true;
      // Auto-trigger connect event for socket compatibility
      setTimeout(() => {
        this.trigger('connect');
      }, 50);
    }

    // =========================================================================
    // EVENT EMITTER API (100% Compatible with Socket.io)
    // =========================================================================

    on(event, handler) {
      if (!this.events.has(event)) {
        this.events.set(event, []);
      }
      this.events.get(event).push(handler);
      if (event === 'connect' && this.connected) {
        setTimeout(() => {
          try { handler(); } catch (e) { console.error(e); }
        }, 10);
      }
    }

    off(event, handler) {
      if (!this.events.has(event)) return;
      if (!handler) {
        this.events.delete(event);
      } else {
        const filtered = this.events.get(event).filter(h => h !== handler);
        this.events.set(event, filtered);
      }
    }

    trigger(event, data) {
      const handlers = this.events.get(event);
      if (handlers && handlers.length > 0) {
        handlers.forEach(h => {
          try {
            h(data);
          } catch (err) {
            console.error(`Error in event listener for [${event}]:`, err);
          }
        });
      }
    }

    emit(event, data, ack) {
      // Route commands based on event name and active mode
      switch (event) {
        case 'wallet_login':
          this.handleWalletLogin(data, ack);
          break;
        case 'shop_purchase':
          this.handleShopPurchase(data, ack);
          break;
        case 'create_room':
          this.handleCreateRoom(data);
          break;
        case 'join_room':
          this.handleJoinRoom(data);
          break;
        case 'start_game':
          this.handleStartGame(data);
          break;
        case 'play_card':
          this.handlePlayCard(data);
          break;
        case 'draw_card':
          this.handleDrawCard(data);
          break;
        case 'pass_turn':
          this.handlePassTurn(data);
          break;
        case 'call_uno':
          this.handleCallUno(data);
          break;
        case 'leave_room':
          this.handleLeaveRoom(data);
          break;
        default:
          console.warn(`[LocalP2P] Unhandled emit event: ${event}`);
      }
    }

    // =========================================================================
    // WALLET & ECONOMY HANDLERS
    // =========================================================================

    handleWalletLogin(data = {}, ack = () => {}) {
      this.walletId = data.walletId || (root.UnoEconomy?.getWalletId?.()) || 'local-player-wallet';
      this.adminMode = Boolean(data.adminMode);

      if (!this.walletDatabase && root.WalletDatabase) {
        this.walletDatabase = new root.WalletDatabase();
      }

      let balance = 100;
      if (this.walletDatabase) {
        balance = this.walletDatabase.getBalance(this.walletId);
      } else if (root.UnoEconomy) {
        balance = root.UnoEconomy.getProfile().coins;
      }

      if (typeof ack === 'function') {
        ack({ ok: true, coins: balance, adminMode: this.adminMode });
      }

      this.trigger('wallet_balance', { coins: balance });
    }

    handleShopPurchase(data = {}, ack = () => {}) {
      const itemId = data.itemId;
      const economy = root.UnoEconomy;
      let cost = 0;

      if (!this.walletId) {
        this.walletId = data.walletId || (root.UnoEconomy?.getWalletId?.()) || 'local-player-wallet';
      }

      if (economy && economy.catalog) {
        const item = [...(economy.catalog.decks || []), ...(economy.catalog.tables || [])].find(i => i.id === itemId);
        if (item) cost = item.cost;
      }

      if (!this.walletDatabase && root.WalletDatabase) {
        this.walletDatabase = new root.WalletDatabase();
      }

      if (this.walletDatabase) {
        const result = this.walletDatabase.purchase(this.walletId, itemId, cost);
        if (typeof ack === 'function') ack(result);
        if (result.ok) {
          this.trigger('wallet_balance', { coins: result.coins });
        }
      } else if (economy) {
        const profile = economy.getProfile();
        if (profile.coins < cost) {
          if (typeof ack === 'function') ack({ ok: false, error: 'Not enough coins' });
        } else {
          const newBalance = profile.coins - cost;
          economy.setCoins(newBalance);
          const cat = economy.catalog?.decks?.some(d => d.id === itemId) ? 'decks' : 'tables';
          economy.grantPurchase(cat, itemId);
          if (typeof ack === 'function') ack({ ok: true, coins: newBalance });
          this.trigger('wallet_balance', { coins: newBalance });
        }
      }
    }

    // =========================================================================
    // MATCH & ROOM CREATION
    // =========================================================================

    handleCreateRoom({ playerName, mode, stake = 50, targetPlayers = 2, walletId } = {}) {
      this.walletId = walletId || this.walletId;
      const safeName = (playerName && playerName.trim()) ? playerName.trim().substring(0, 15) : 'Player 1';
      const wager = this.adminMode ? 0 : Number(stake);
      const playerCount = Number(targetPlayers) || 2;
      const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();

      this.roomId = roomId;
      this.isHost = true;

      if (mode === 'ai') {
        this.mode = 'ai';
        this.initAiRoom(roomId, safeName, wager, playerCount);
      } else {
        // LAN WebRTC Mode
        this.mode = 'p2p_host';
        this.initP2PHostRoom(roomId, safeName, wager, playerCount);
      }
    }

    handleJoinRoom({ roomId, playerName, walletId } = {}) {
      this.mode = 'p2p_client';
      this.isHost = false;
      this.roomId = (roomId || '').trim().toUpperCase();
      this.playerName = playerName || 'Player 2';
      this.walletId = walletId || this.walletId;

      // In WebRTC mode, connection is initiated via QR handshake modal
      console.log(`[LocalP2P] Joining P2P room ${this.roomId}`);
    }

    // =========================================================================
    // 1. SINGLE-PLAYER (VS AI) ENGINE LOGIC
    // =========================================================================

    initAiRoom(roomId, playerName, stake, playerCount) {
      if (!root.GameEngine || !root.BotPlayer) {
        console.error('GameEngine or BotPlayer script not loaded!');
        return;
      }

      this.engine = new root.GameEngine(roomId, 'ai');
      this.engine.stake = stake;
      this.engine.targetPlayers = playerCount;

      // Add human player
      const humanPlayer = {
        id: this.id,
        name: playerName,
        isHost: true,
        isBot: false,
        walletId: this.walletId,
        hand: []
      };
      this.engine.addPlayer(humanPlayer);

      // Add AI Bot players (1-3 bots depending on playerCount)
      const botNames = ['Bot Alpha', 'Bot Beta', 'Bot Gamma'];
      for (let i = 0; i < playerCount - 1; i++) {
        const botId = `bot_${i + 1}`;
        const botName = botNames[i] || `Bot ${i + 1}`;
        const bot = new root.BotPlayer(botId, botName);
        bot.isHost = false;
        this.engine.addPlayer(bot);
      }

      // Emit room_created
      this.trigger('room_created', {
        roomId: roomId,
        player: { id: this.id, name: playerName, isHost: true },
        mode: 'ai',
        players: this.engine.players.map(p => ({
          id: p.id,
          name: p.name,
          isHost: Boolean(p.isHost),
          isBot: Boolean(p.isBot)
        })),
        stake: stake,
        targetPlayers: playerCount
      });
    }

    handleStartGame({ roomId } = {}) {
      if (this.mode === 'ai' && this.engine) {
        this.startAiMatch();
      } else if (this.mode === 'p2p_host' && this.engine) {
        this.startP2PHostMatch();
      } else if (this.mode === 'p2p_client' && this.clientChannel) {
        // Send start intent to host
        this.sendToHost('start_game', { roomId });
      }
    }

    clearAiTurn() {
      if (this.aiTimeout) {
        clearTimeout(this.aiTimeout);
        this.aiTimeout = null;
      }
      this.aiTurnToken = (this.aiTurnToken || 0) + 1;
    }

    startAiMatch() {
      this.clearAiTurn();

      this.engine.startGame();

      const statePayload = this.engine.getGameState(this.id);
      this.trigger('game_started', {
        gameState: statePayload,
        matchId: 'ai_match_' + Date.now(),
        wager: { stake: this.engine.stake, playerCount: this.engine.targetPlayers }
      });
      this.trigger('update_game', { gameState: statePayload });
      this.trigger('game_state', { gameState: statePayload });

      // Run AI turn loop if first player is a bot
      this.scheduleAiTurn();
    }

    scheduleAiTurn() {
      if (!this.engine || !this.engine.isGameStarted || this.engine.winner) return;

      const activePlayer = this.engine.getActivePlayer();
      if (!activePlayer || !activePlayer.isBot) return;

      // Invalidate any previously scheduled action and track this turn attempt
      this.clearAiTurn();
      const currentToken = this.aiTurnToken;
      const botId = activePlayer.id;

      // Natural thinking delay (~3 seconds) before AI makes its decision
      const thinkingDelay = Math.floor(Math.random() * 400) + 2800;

      this.aiTimeout = setTimeout(() => {
        this.aiTimeout = null;
        // Verify that this action still belongs to the current match, turn token, and active bot
        if (currentToken !== this.aiTurnToken) return;
        if (!this.engine || !this.engine.isGameStarted || this.engine.winner) return;

        const currentTurn = this.engine.getActivePlayer();
        if (!currentTurn || currentTurn.id !== botId || !currentTurn.isBot) return;

        const topCard = this.engine.discardPile[this.engine.discardPile.length - 1];
        let cardToPlay = currentTurn.chooseCardToPlay(topCard, this.engine.currentColor);

        // Heuristic: occasional bluff draw
        if (cardToPlay && currentTurn.hasOnlyWeakCards?.() && Math.random() < 0.12) {
          cardToPlay = null;
        }

        if (cardToPlay) {
          // Play chosen card directly after the thinking delay
          this.executeBotPlayCard(currentTurn, cardToPlay);
        } else {
          // Bot must draw a card: execute draw and broadcast state so the draw animation runs smoothly
          const drawResult = this.engine.drawCardForPlayer(currentTurn.id);
          this.broadcastAiState();

          if (!drawResult.success) {
            this.engine.passTurn(currentTurn.id);
            this.broadcastAiState();
            this.scheduleAiTurn();
            return;
          }

          // Natural evaluation delay after drawing (~1.5 seconds)
          // Simulates checking the newly drawn card and allows the draw animation to finish
          const evaluationDelay = Math.floor(Math.random() * 400) + 1200;
          this.aiTimeout = setTimeout(() => {
            this.aiTimeout = null;
            if (currentToken !== this.aiTurnToken) return;
            if (!this.engine || !this.engine.isGameStarted || this.engine.winner) return;

            const turnAfterDraw = this.engine.getActivePlayer();
            if (!turnAfterDraw || turnAfterDraw.id !== botId || !turnAfterDraw.isBot) return;

            // If drawn card is legally playable, play it; otherwise pass
            if (drawResult.isPlayable && drawResult.drawnCard && this.engine.canPlayCard(drawResult.drawnCard)) {
              this.executeBotPlayCard(turnAfterDraw, drawResult.drawnCard);
            } else {
              this.engine.passTurn(turnAfterDraw.id);
              this.broadcastAiState();
              this.scheduleAiTurn();
            }
          }, evaluationDelay);
        }
      }, thinkingDelay);
    }

    executeBotPlayCard(botPlayer, cardToPlay) {
      if (!this.engine || !this.engine.isGameStarted || this.engine.winner) return;

      // Call UNO if bot will have 1 card remaining
      if (botPlayer.hand.length === 2) {
        this.engine.callUno(botPlayer.id);
        this.trigger('uno_called', {
          playerId: botPlayer.id,
          playerName: botPlayer.name,
          message: `📣 Bot ${botPlayer.name} called UNO!`
        });
      }

      const isWild = (cardToPlay.color === 'wild' || cardToPlay.color === 'wild_draw4');
      const chosenColor = isWild ? botPlayer.chooseBestColor() : null;

      const playResult = this.engine.playCard(botPlayer.id, cardToPlay.id, chosenColor);
      if (!playResult.success) {
        if (!this.engine.hasDrawnThisTurn) this.engine.drawCardForPlayer(botPlayer.id);
        if (this.engine.canPass) this.engine.passTurn(botPlayer.id);
        else this.engine.advanceTurn(1);
      }

      this.broadcastAiState();

      if (this.engine.winner) {
        this.finalizeAiGameOver();
        return;
      }

      this.scheduleAiTurn();
    }

    broadcastAiState() {
      if (!this.engine) return;
      const statePayload = this.engine.getGameState(this.id);
      this.trigger('update_game', { gameState: statePayload });
      this.trigger('game_state', { gameState: statePayload });
    }

    finalizeAiGameOver() {
      this.clearAiTurn();
      if (!this.engine || !this.engine.winner) return;

      const winner = this.engine.winner;
      const isHumanWinner = (winner.id === this.id);
      const stake = this.engine.stake || 0;
      const pot = stake * (this.engine.targetPlayers || 2);

      // Settle coins in localStorage
      if (isHumanWinner && stake > 0 && this.walletDatabase) {
        this.walletDatabase.credit(this.walletId, pot);
        this.trigger('wallet_balance', { coins: this.walletDatabase.getBalance(this.walletId) });
      }

      this.broadcastAiState();

      this.trigger('game_over', {
        winnerId: winner.id,
        winnerName: winner.name,
        message: isHumanWinner
          ? `🏆 Congratulations ${winner.name}! You won the ${pot > 0 ? pot.toLocaleString() + ' coin pot' : 'match'}!`
          : `🤖 Bot ${winner.name} cleared their hand and won the match!`
      });
    }

    // =========================================================================
    // IN-GAME PLAYER ACTION ROUTER
    // =========================================================================

    handlePlayCard({ roomId, cardId, chosenColor, cardIndex }) {
      if (this.mode === 'ai' && this.engine) {
        const result = this.engine.playCard(this.id, cardId, chosenColor, cardIndex);
        if (result && result.success) {
          this.broadcastAiState();
          if (this.engine.winner) {
            this.finalizeAiGameOver();
          } else {
            this.scheduleAiTurn();
          }
        } else {
          this.trigger('error_message', result?.reason || 'Illegal move!');
          this.broadcastAiState();
        }
      } else if ((this.isHost || this.mode === 'p2p_host') && this.engine) {
        this.executeHostPlayCard(this.id, cardId, chosenColor, cardIndex);
      } else if (this.clientChannel || this.mode === 'p2p_client') {
        this.sendToHost('play_card', { cardId, chosenColor, cardIndex, playerId: this.id });
      }
    }

    handleDrawCard({ roomId }) {
      if (this.mode === 'ai' && this.engine) {
        const result = this.engine.drawCardForPlayer(this.id);
        if (!result.success) {
          this.trigger('error_message', result.reason || 'Cannot draw card.');
        }
        this.broadcastAiState();
      } else if ((this.isHost || this.mode === 'p2p_host') && this.engine) {
        this.executeHostDrawCard(this.id);
      } else if (this.clientChannel || this.mode === 'p2p_client') {
        this.sendToHost('draw_card', { playerId: this.id });
      }
    }

    handlePassTurn({ roomId }) {
      if (this.mode === 'ai' && this.engine) {
        const success = this.engine.passTurn(this.id);
        if (success) {
          this.broadcastAiState();
          this.scheduleAiTurn();
        } else {
          this.trigger('error_message', 'You cannot pass right now.');
        }
      } else if ((this.isHost || this.mode === 'p2p_host') && this.engine) {
        this.executeHostPassTurn(this.id);
      } else if (this.clientChannel || this.mode === 'p2p_client') {
        this.sendToHost('pass_turn', { playerId: this.id });
      }
    }

    handleCallUno({ roomId }) {
      if (this.mode === 'ai' && this.engine) {
        this.engine.callUno(this.id);
        this.trigger('uno_called', {
          playerId: this.id,
          playerName: 'You',
          message: '📣 You called UNO!'
        });
      } else if ((this.isHost || this.mode === 'p2p_host') && this.engine) {
        this.executeHostCallUno(this.id);
      } else if (this.clientChannel || this.mode === 'p2p_client') {
        this.sendToHost('call_uno', { playerId: this.id });
      }
    }

    handleLeaveRoom({ roomId }) {
      this.clearAiTurn();
      this.closeAllP2P();
      this.engine = null;
    }

    // =========================================================================
    // 2. WEBRTC P2P LOCAL MULTIPLAYER (HOST & CLIENT)
    // =========================================================================

    initP2PHostRoom(roomId, playerName, stake, playerCount) {
      this.engine = new root.GameEngine(roomId, 'lan');
      this.engine.stake = stake;
      this.engine.targetPlayers = playerCount;

      const hostPlayer = {
        id: this.id,
        name: playerName,
        isHost: true,
        isBot: false,
        walletId: this.walletId,
        hand: []
      };
      this.engine.addPlayer(hostPlayer);

      this.trigger('room_created', {
        roomId: roomId,
        player: { id: this.id, name: playerName, isHost: true },
        mode: 'lan',
        players: [{ id: this.id, name: playerName, isHost: true }],
        stake: stake,
        targetPlayers: playerCount
      });
    }

    /**
     * WebRTC Host: Creates an Offer for an incoming peer
     */
    async createHostOffer() {
      const peerId = generateId('peer');
      const pc = new RTCPeerConnection({ iceServers: [] });
      const channel = pc.createDataChannel('uno_channel', { ordered: true });

      const peerRecord = { peerId, pc, channel, name: 'Guest' };
      this.hostPeers.set(peerId, peerRecord);

      this.setupHostDataChannel(peerRecord);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Wait for ICE gathering to complete so all candidate lines are in SDP
      await this.waitForIceGathering(pc);

      const compactOffer = root.SdpCompact.serialize(pc.localDescription);
      return { peerId, compactOffer };
    }

    /**
     * WebRTC Host: Accepts Answer from joining peer
     */
    async acceptHostAnswer(peerId, compactAnswer) {
      let peerRecord = this.hostPeers.get(peerId);
      if (!peerRecord) {
        // Fallback to the latest peer connection if single peer
        const first = this.hostPeers.values().next().value;
        if (first) peerRecord = first;
      }

      if (!peerRecord) {
        throw new Error('Peer connection session not found. Please regenerate Host QR.');
      }

      const desc = root.SdpCompact.deserialize(compactAnswer);
      if (!desc || desc.type !== 'answer') {
        throw new Error('Invalid WebRTC Answer payload.');
      }

      await peerRecord.pc.setRemoteDescription(desc);
      console.log(`[Host] WebRTC Answer set for peer: ${peerRecord.peerId}`);
      return true;
    }

    setupHostDataChannel(peerRecord) {
      const { peerId, channel, pc } = peerRecord;

      channel.onopen = () => {
        console.log(`[Host] DataChannel OPEN for peer: ${peerId}`);
      };

      channel.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleHostReceivedMessage(peerRecord, msg);
        } catch (e) {
          console.warn('[Host] Invalid channel message:', e);
        }
      };

      channel.onclose = () => {
        console.log(`[Host] DataChannel CLOSED for peer: ${peerId}`);
        this.handlePeerDisconnected(peerRecord);
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
          this.handlePeerDisconnected(peerRecord);
        }
      };
    }

    handleHostReceivedMessage(peerRecord, msg) {
      const { event, data } = msg;

      switch (event) {
        case 'join_room': {
          peerRecord.name = (data.playerName || 'Player').substring(0, 15);
          peerRecord.walletId = data.walletId;

          // Add to GameEngine
          if (this.engine) {
            this.engine.addPlayer({
              id: peerRecord.peerId,
              name: peerRecord.name,
              isHost: false,
              isBot: false,
              walletId: peerRecord.walletId,
              hand: []
            });

            // Broadcast player_joined to all
            const playerList = this.engine.players.map(p => ({
              id: p.id,
              name: p.name,
              isHost: Boolean(p.isHost),
              isBot: Boolean(p.isBot)
            }));

            this.trigger('player_joined', { players: playerList });
            this.broadcastToPeers('player_joined', { players: playerList });

            // Notify joining peer of room info
            this.sendToPeer(peerRecord, 'room_created', {
              roomId: this.roomId,
              player: { id: peerRecord.peerId, name: peerRecord.name, isHost: false },
              mode: 'lan',
              players: playerList,
              stake: this.engine.stake,
              targetPlayers: this.engine.targetPlayers
            });
          }
          break;
        }

        case 'play_card':
          this.executeHostPlayCard(peerRecord.peerId, data.cardId, data.chosenColor, data.cardIndex);
          break;

        case 'draw_card':
          this.executeHostDrawCard(peerRecord.peerId);
          break;

        case 'pass_turn':
          this.executeHostPassTurn(peerRecord.peerId);
          break;

        case 'call_uno':
          this.executeHostCallUno(peerRecord.peerId);
          break;

        case 'leave_room':
          this.handlePeerDisconnected(peerRecord);
          break;
      }
    }

    executeHostPlayCard(playerId, cardId, chosenColor, cardIndex) {
      if (!this.engine) return;
      const result = this.engine.playCard(playerId, cardId, chosenColor, cardIndex);

      if (result && result.success) {
        this.broadcastHostGameState();

        if (this.engine.winner) {
          this.finalizeHostGameOver();
        }
      } else {
        const errorMsg = result?.reason || 'Illegal move!';
        if (playerId === this.id) {
          this.trigger('error_message', errorMsg);
        } else {
          const peer = this.hostPeers.get(playerId);
          if (peer) this.sendToPeer(peer, 'error_message', errorMsg);
        }
        this.broadcastHostGameState();
      }
    }

    executeHostDrawCard(playerId) {
      if (!this.engine) return;
      const result = this.engine.drawCardForPlayer(playerId);
      if (!result.success) {
        const errorMsg = result.reason || 'Cannot draw card.';
        if (playerId === this.id) this.trigger('error_message', errorMsg);
        else {
          const peer = this.hostPeers.get(playerId);
          if (peer) this.sendToPeer(peer, 'error_message', errorMsg);
        }
      }
      this.broadcastHostGameState();
    }

    executeHostPassTurn(playerId) {
      if (!this.engine) return;
      const ok = this.engine.passTurn(playerId);
      if (!ok) {
        if (playerId === this.id) this.trigger('error_message', 'You cannot pass right now.');
        else {
          const peer = this.hostPeers.get(playerId);
          if (peer) this.sendToPeer(peer, 'error_message', 'You cannot pass right now.');
        }
      }
      this.broadcastHostGameState();
    }

    executeHostCallUno(playerId) {
      if (!this.engine) return;
      this.engine.callUno(playerId);
      const player = this.engine.players.find(p => p.id === playerId);
      const name = player ? player.name : 'A player';

      const payload = { playerId, playerName: name, message: `📣 ${name} called UNO!` };
      this.trigger('uno_called', payload);
      this.broadcastToPeers('uno_called', payload);
    }

    startP2PHostMatch() {
      if (!this.engine) return;
      this.engine.startGame();

      // Send personalized game_started to host and each peer
      const hostState = this.engine.getGameState(this.id);
      this.trigger('game_started', {
        gameState: hostState,
        matchId: 'p2p_match_' + Date.now(),
        wager: { stake: this.engine.stake, playerCount: this.engine.targetPlayers }
      });
      this.trigger('update_game', { gameState: hostState });
      this.trigger('game_state', { gameState: hostState });

      this.hostPeers.forEach(peer => {
        const peerState = this.engine.getGameState(peer.peerId);
        this.sendToPeer(peer, 'game_started', {
          gameState: peerState,
          matchId: 'p2p_match_' + Date.now(),
          wager: { stake: this.engine.stake, playerCount: this.engine.targetPlayers }
        });
        this.sendToPeer(peer, 'update_game', { gameState: peerState });
        this.sendToPeer(peer, 'game_state', { gameState: peerState });
      });
    }

    broadcastHostGameState() {
      if (!this.engine) return;

      // Host state
      const hostState = this.engine.getGameState(this.id);
      this.trigger('update_game', { gameState: hostState });
      this.trigger('game_state', { gameState: hostState });

      // Peers personalized state
      this.hostPeers.forEach(peer => {
        const peerState = this.engine.getGameState(peer.peerId);
        this.sendToPeer(peer, 'update_game', { gameState: peerState });
        this.sendToPeer(peer, 'game_state', { gameState: peerState });
      });
    }

    finalizeHostGameOver() {
      if (!this.engine || !this.engine.winner) return;

      const winner = this.engine.winner;
      const stake = this.engine.stake || 0;
      const pot = stake * (this.engine.targetPlayers || 2);

      // Settle wager
      if (winner.walletId && stake > 0 && this.walletDatabase) {
        this.walletDatabase.credit(winner.walletId, pot);
      }

      const gameOverPayload = {
        winnerId: winner.id,
        winnerName: winner.name,
        message: `🏆 ${winner.name} won the match!`
      };

      this.trigger('game_over', gameOverPayload);
      this.broadcastToPeers('game_over', gameOverPayload);

      // Settle balances
      if (this.walletDatabase) {
        this.trigger('wallet_balance', { coins: this.walletDatabase.getBalance(this.walletId) });
        this.hostPeers.forEach(peer => {
          if (peer.walletId) {
            this.sendToPeer(peer, 'wallet_balance', { coins: this.walletDatabase.getBalance(peer.walletId) });
          }
        });
      }
    }

    handlePeerDisconnected(peerRecord) {
      if (!peerRecord) return;
      this.hostPeers.delete(peerRecord.peerId);

      if (this.engine) {
        this.engine.removePlayer(peerRecord.peerId);
        const playerList = this.engine.players.map(p => ({
          id: p.id,
          name: p.name,
          isHost: Boolean(p.isHost),
          isBot: Boolean(p.isBot)
        }));

        this.trigger('player_left', { players: playerList });
        this.broadcastToPeers('player_left', { players: playerList });

        if (this.engine.isGameStarted) {
          this.broadcastHostGameState();
        }
      }
    }

    sendToPeer(peerRecord, event, data) {
      if (peerRecord?.channel && peerRecord.channel.readyState === 'open') {
        try {
          peerRecord.channel.send(JSON.stringify({ event, data }));
        } catch (e) {
          console.warn('[Host] Peer send error:', e);
        }
      }
    }

    broadcastToPeers(event, data) {
      this.hostPeers.forEach(peer => {
        this.sendToPeer(peer, event, data);
      });
    }

    // =========================================================================
    // WEBRTC CLIENT / JOINING PEER
    // =========================================================================

    /**
     * WebRTC Client: Processes Host Offer and generates Answer
     */
    async createClientAnswer(compactOffer, clientPlayerName) {
      this.closeClientP2P();

      const desc = root.SdpCompact.deserialize(compactOffer);
      if (!desc || desc.type !== 'offer') {
        throw new Error('Invalid Host Offer QR payload.');
      }

      this.playerName = clientPlayerName || this.playerName || 'Player 2';
      const pc = new RTCPeerConnection({ iceServers: [] });
      this.clientPc = pc;

      // Listen for incoming DataChannel from Host
      pc.ondatachannel = (e) => {
        this.clientChannel = e.channel;
        this.setupClientDataChannel();
      };

      await pc.setRemoteDescription(desc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      await this.waitForIceGathering(pc);

      const compactAnswer = root.SdpCompact.serialize(pc.localDescription);
      return compactAnswer;
    }

    setupClientDataChannel() {
      const channel = this.clientChannel;
      if (!channel) return;

      channel.onopen = () => {
        console.log('[Client] Connected to Host DataChannel!');
        // Automatically send join_room to Host
        this.sendToHost('join_room', {
          playerName: this.playerName,
          walletId: this.walletId
        });
      };

      channel.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          // Pass event directly to client listeners (socket.on)
          this.trigger(msg.event, msg.data);
        } catch (e) {
          console.warn('[Client] Invalid message from Host:', e);
        }
      };

      channel.onclose = () => {
        console.log('[Client] Disconnected from Host DataChannel');
        this.trigger('disconnect');
      };

      if (this.clientPc) {
        this.clientPc.oniceconnectionstatechange = () => {
          if (this.clientPc.iceConnectionState === 'disconnected' || this.clientPc.iceConnectionState === 'failed') {
            this.trigger('disconnect');
          }
        };
      }
    }

    sendToHost(event, data) {
      if (this.clientChannel && this.clientChannel.readyState === 'open') {
        try {
          this.clientChannel.send(JSON.stringify({ event, data }));
        } catch (e) {
          console.warn('[Client] Host send error:', e);
        }
      }
    }

    waitForIceGathering(pc) {
      return new Promise(resolve => {
        if (pc.iceGatheringState === 'complete') {
          resolve();
          return;
        }

        const check = () => {
          if (pc.iceGatheringState === 'complete') {
            pc.removeEventListener('icegatheringstatechange', check);
            resolve();
          }
        };
        pc.addEventListener('icegatheringstatechange', check);

        // Fallback timeout after 1.2s to prevent hanging
        setTimeout(() => {
          pc.removeEventListener('icegatheringstatechange', check);
          resolve();
        }, 1200);
      });
    }

    closeAllP2P() {
      this.hostPeers.forEach(p => {
        try { p.channel?.close(); } catch (_) {}
        try { p.pc?.close(); } catch (_) {}
      });
      this.hostPeers.clear();
      this.closeClientP2P();
    }

    closeClientP2P() {
      try { this.clientChannel?.close(); } catch (_) {}
      try { this.clientPc?.close(); } catch (_) {}
      this.clientChannel = null;
      this.clientPc = null;
    }
  }

  // Create singleton instance
  const localP2P = new LocalP2PManager();
  localP2P.init();

  // Expose as global socket mock and LocalP2P
  root.LocalP2PManager = LocalP2PManager;
  root.LocalP2P = localP2P;
  root.localSocket = localP2P;

  // Polyfill or override window.io() so any existing code returns localP2P
  root.io = function () {
    return localP2P;
  };

  // If window.socket is accessed
  if (!root.socket) {
    root.socket = localP2P;
  }
})(typeof window !== 'undefined' ? window : global);
