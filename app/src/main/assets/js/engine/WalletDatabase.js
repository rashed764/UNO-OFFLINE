/**
 * Client & Server Universal Wallet Database
 * Persists coin balances, match rewards, and unlocked cosmetics.
 * In browser: uses localStorage ('uno.profile.v1' / 'uno.wallets.v1').
 * In Node.js: falls back to data/wallets.json if localStorage is unavailable.
 */
'use strict';

class WalletDatabase {
  constructor(storageKey = 'uno.wallets.v1') {
    this.storageKey = storageKey;
    this.data = { version: 1, wallets: {} };
    this.isBrowser = typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
    this.load();
  }

  load() {
    if (this.isBrowser) {
      try {
        // Read directly from uno.wallets.v1 or uno.profile.v1
        const raw = window.localStorage.getItem(this.storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed.wallets === 'object') {
            this.data = parsed;
          }
        }
        // Mirror from uno.profile.v1 if wallet empty
        const profileRaw = window.localStorage.getItem('uno.profile.v1');
        const walletKey = 'uno.wallet.id.v1';
        const currentWalletId = window.localStorage.getItem(walletKey) || 'local-player-wallet';
        if (profileRaw && (!this.data.wallets || !this.data.wallets[currentWalletId])) {
          try {
            const prof = JSON.parse(profileRaw);
            const coins = Number.isInteger(prof.coins) ? prof.coins : 100;
            const unlocked = Array.isArray(prof.unlocked?.decks) && Array.isArray(prof.unlocked?.tables)
              ? [...prof.unlocked.decks, ...prof.unlocked.tables]
              : [];
            this.data.wallets[currentWalletId] = {
              coins,
              unlocked,
              createdAt: new Date().toISOString()
            };
            this.save();
          } catch (_) {}
        }
      } catch (e) {
        console.warn('Could not read wallet from localStorage:', e);
      }
    } else {
      try {
        const fs = require('fs');
        const path = require('path');
        const filePath = path.join(__dirname, '..', '..', 'data', 'wallets.json');
        if (fs.existsSync(filePath)) {
          const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          if (saved && saved.wallets) this.data = saved;
        }
      } catch (_) {}
    }
  }

  save() {
    if (this.isBrowser) {
      try {
        window.localStorage.setItem(this.storageKey, JSON.stringify(this.data));
      } catch (e) {
        console.warn('Could not save wallet to localStorage:', e);
      }
    } else {
      try {
        const fs = require('fs');
        const path = require('path');
        const filePath = path.join(__dirname, '..', '..', 'data', 'wallets.json');
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(this.data, null, 2), 'utf8');
      } catch (_) {}
    }
  }

  isValidId(walletId) {
    return typeof walletId === 'string' && walletId.length >= 4;
  }

  getOrCreate(walletId) {
    const id = String(walletId || 'local-player-wallet');
    if (!this.data.wallets[id]) {
      // If UnoEconomy exists, initialize with profile coins
      let initialCoins = 100;
      let initialUnlocked = ['classic', 'felt-green'];
      if (this.isBrowser && window.UnoEconomy) {
        const prof = window.UnoEconomy.getProfile();
        if (Number.isInteger(prof?.coins)) initialCoins = prof.coins;
        if (prof?.unlocked) {
          initialUnlocked = [...(prof.unlocked.decks || []), ...(prof.unlocked.tables || [])];
        }
      }
      this.data.wallets[id] = {
        coins: initialCoins,
        unlocked: initialUnlocked,
        createdAt: new Date().toISOString()
      };
      this.save();
    } else if (!Array.isArray(this.data.wallets[id].unlocked)) {
      this.data.wallets[id].unlocked = [];
      this.save();
    }
    return { ...this.data.wallets[id] };
  }

  getBalance(walletId) {
    return this.getOrCreate(walletId).coins;
  }

  debit(walletId, amount) {
    if (!Number.isInteger(amount) || amount < 0) return false;
    const wallet = this.getOrCreate(walletId);
    if (wallet.coins < amount) return false;
    this.data.wallets[walletId].coins -= amount;
    this.save();
    if (this.isBrowser && window.UnoEconomy) {
      window.UnoEconomy.setCoins(this.data.wallets[walletId].coins);
    }
    return this.data.wallets[walletId].coins;
  }

  credit(walletId, amount) {
    if (!Number.isInteger(amount) || amount < 0) return false;
    this.getOrCreate(walletId);
    this.data.wallets[walletId].coins += amount;
    this.save();
    if (this.isBrowser && window.UnoEconomy) {
      window.UnoEconomy.setCoins(this.data.wallets[walletId].coins);
    }
    return this.data.wallets[walletId].coins;
  }

  purchase(walletId, itemId, cost) {
    if (typeof itemId !== 'string' || !Number.isInteger(cost) || cost < 0) return { ok: false };
    const wallet = this.getOrCreate(walletId);
    if (wallet.unlocked.includes(itemId)) {
      return { ok: true, alreadyOwned: true, coins: wallet.coins };
    }
    if (wallet.coins < cost) {
      return { ok: false, coins: wallet.coins };
    }
    const stored = this.data.wallets[walletId];
    stored.coins -= cost;
    stored.unlocked.push(itemId);
    this.save();
    if (this.isBrowser && window.UnoEconomy) {
      window.UnoEconomy.setCoins(stored.coins);
      // grant purchase in profile
      const category = window.UnoEconomy.catalog?.decks?.some(d => d.id === itemId) ? 'decks' : 'tables';
      window.UnoEconomy.grantPurchase(category, itemId);
    }
    return { ok: true, coins: stored.coins };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = WalletDatabase;
} else if (typeof window !== 'undefined') {
  window.WalletDatabase = WalletDatabase;
}
