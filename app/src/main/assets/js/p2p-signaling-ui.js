/**
 * Offline QR Code WebRTC Signaling UI Controller
 * Manages Host & Client QR presentation, Camera Scanner, and Copy/Paste Fallback.
 */
(function (root) {
  'use strict';

  class P2PSignalingUI {
    constructor() {
      this.modal = null;
      this.currentHostPeerId = null;
      this.isHost = false;
    }

    init() {
      this.modal = document.getElementById('p2p-signaling-modal');
      this.bindElements();
    }

    bindElements() {
      if (!this.modal) return;

      // Close button
      const closeBtn = document.getElementById('btn-p2p-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => this.hide());
      }

      // Host Tab: Copy Offer button
      const btnCopyOffer = document.getElementById('btn-copy-host-offer');
      if (btnCopyOffer) {
        btnCopyOffer.addEventListener('click', () => {
          const text = document.getElementById('p2p-host-offer-text')?.value || '';
          this.copyToClipboard(text, btnCopyOffer);
        });
      }

      // Host Tab: Scan Answer Camera Trigger
      const btnStartScanAnswer = document.getElementById('btn-start-scan-answer');
      if (btnStartScanAnswer) {
        btnStartScanAnswer.addEventListener('click', () => {
          this.startScannerForAnswer();
        });
      }

      // Host Tab: Submit Manual Answer
      const btnSubmitAnswer = document.getElementById('btn-submit-host-answer');
      if (btnSubmitAnswer) {
        btnSubmitAnswer.addEventListener('click', () => {
          const answerText = document.getElementById('p2p-host-answer-input')?.value || '';
          this.handleAnswerReceived(answerText);
        });
      }

      // Client Tab: Start Scan Host Offer Camera
      const btnStartScanOffer = document.getElementById('btn-client-scan-offer');
      if (btnStartScanOffer) {
        btnStartScanOffer.addEventListener('click', () => {
          this.startScannerForOffer();
        });
      }

      // Client Tab: Submit Manual Host Offer
      const btnSubmitOffer = document.getElementById('btn-submit-client-offer');
      if (btnSubmitOffer) {
        btnSubmitOffer.addEventListener('click', () => {
          const offerText = document.getElementById('p2p-client-offer-input')?.value || '';
          this.handleOfferReceived(offerText);
        });
      }

      // Client Tab: Copy Answer button
      const btnCopyAnswer = document.getElementById('btn-copy-client-answer');
      if (btnCopyAnswer) {
        btnCopyAnswer.addEventListener('click', () => {
          const text = document.getElementById('p2p-client-answer-text')?.value || '';
          this.copyToClipboard(text, btnCopyAnswer);
        });
      }

      // Stop camera when closing
      this.modal.addEventListener('click', (e) => {
        if (e.target === this.modal) this.hide();
      });
    }

    show() {
      if (this.modal) {
        this.modal.classList.remove('hidden');
      }
    }

    hide() {
      if (root.QRScanner) {
        root.QRScanner.stop();
      }
      if (this.modal) {
        this.modal.classList.add('hidden');
      }
    }

    /**
     * Launch Host Signaling Flow
     */
    async openHostFlow() {
      this.isHost = true;
      this.show();
      this.setStep('host-step-1');
      this.setStatus('Generating Host Room & WebRTC QR Code…');

      const hostOfferContainer = document.getElementById('host-qr-container');
      const hostOfferText = document.getElementById('p2p-host-offer-text');

      try {
        const { peerId, compactOffer } = await root.LocalP2P.createHostOffer();
        this.currentHostPeerId = peerId;

        // Render QR Code
        if (hostOfferContainer && root.QRCode) {
          hostOfferContainer.innerHTML = root.QRCode.generateSVG(compactOffer, { cellSize: 4, margin: 2 });
        }
        if (hostOfferText) {
          hostOfferText.value = compactOffer;
        }

        this.setStatus('Ready! Ask your friend to scan this QR code on their device.');
      } catch (err) {
        console.error('Error generating host offer:', err);
        this.setStatus('Error generating host offer: ' + err.message, true);
      }
    }

    /**
     * Launch Client (Join) Signaling Flow
     */
    openClientFlow() {
      this.isHost = false;
      this.show();
      this.setStep('client-step-1');
      this.setStatus('Scan the Host’s QR Code or paste the code below.');

      // Automatically try camera scan
      this.startScannerForOffer();
    }

    startScannerForOffer() {
      const video = document.getElementById('client-scanner-video');
      const scannerBox = document.getElementById('client-scanner-box');
      if (scannerBox) scannerBox.classList.remove('hidden');

      if (!root.QRScanner || !video) return;

      this.setStatus('Camera active: Point lens at the Host’s QR code.');

      root.QRScanner.start({
        video: video,
        onScan: (scannedText) => {
          this.handleOfferReceived(scannedText);
        },
        onError: (err) => {
          this.setStatus('Camera unavailable. You can paste the code manually below.', false);
        }
      });
    }

    async handleOfferReceived(compactOffer) {
      if (!compactOffer || !compactOffer.trim()) {
        if (root.showToast) root.showToast('Please provide a valid Host offer code.');
        return;
      }

      compactOffer = compactOffer.trim();
      root.QRScanner?.stop();

      this.setStatus('Host offer recognized! Generating your response answer…');

      try {
        const playerName = document.getElementById('player-name')?.value.trim() || 'Player 2';
        const compactAnswer = await root.LocalP2P.createClientAnswer(compactOffer, playerName);

        // Move to step 2: Display Client's Answer QR
        this.setStep('client-step-2');

        const answerQrContainer = document.getElementById('client-answer-qr-container');
        const answerText = document.getElementById('p2p-client-answer-text');

        if (answerQrContainer && root.QRCode) {
          answerQrContainer.innerHTML = root.QRCode.generateSVG(compactAnswer, { cellSize: 4, margin: 2 });
        }
        if (answerText) {
          answerText.value = compactAnswer;
        }

        this.setStatus('Show this Answer QR Code to the Host to complete handshake!');

        // Listen for connection open to auto-close modal
        root.LocalP2P.on('room_created', () => {
          this.setStatus('Connected to Host! Entering game room…');
          setTimeout(() => this.hide(), 700);
        });
      } catch (err) {
        console.error('Failed to create answer:', err);
        this.setStatus('Error creating answer: ' + err.message, true);
        if (root.showToast) root.showToast('Invalid QR Code. Please try again.');
      }
    }

    startScannerForAnswer() {
      const video = document.getElementById('host-scanner-video');
      const scannerBox = document.getElementById('host-scanner-box');
      if (scannerBox) scannerBox.classList.remove('hidden');

      if (!root.QRScanner || !video) return;

      this.setStatus('Camera active: Point lens at your friend’s Answer QR code.');

      root.QRScanner.start({
        video: video,
        onScan: (scannedAnswer) => {
          this.handleAnswerReceived(scannedAnswer);
        },
        onError: (err) => {
          this.setStatus('Camera unavailable. Paste friend’s code manually below.');
        }
      });
    }

    async handleAnswerReceived(compactAnswer) {
      if (!compactAnswer || !compactAnswer.trim()) {
        if (root.showToast) root.showToast('Please provide a valid Answer code.');
        return;
      }

      compactAnswer = compactAnswer.trim();
      root.QRScanner?.stop();

      this.setStatus('Connecting to peer…');

      try {
        await root.LocalP2P.acceptHostAnswer(this.currentHostPeerId, compactAnswer);
        this.setStatus('Connection established! Entering lobby…');
        setTimeout(() => this.hide(), 800);
      } catch (err) {
        console.error('Failed to accept answer:', err);
        this.setStatus('Connection error: ' + err.message, true);
        if (root.showToast) root.showToast('Could not connect with this code: ' + err.message);
      }
    }

    setStep(stepId) {
      document.querySelectorAll('.p2p-step-panel').forEach(el => el.classList.add('hidden'));
      const activePanel = document.getElementById(stepId);
      if (activePanel) activePanel.classList.remove('hidden');
    }

    setStatus(msg, isError = false) {
      const statusEl = document.getElementById('p2p-status-message');
      if (statusEl) {
        statusEl.textContent = msg;
        statusEl.className = 'p2p-status-badge ' + (isError ? 'status-error' : 'status-info');
      }
    }

    copyToClipboard(text, btnElement) {
      if (!text) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          this.showCopiedState(btnElement);
        }).catch(() => {
          this.fallbackCopy(text, btnElement);
        });
      } else {
        this.fallbackCopy(text, btnElement);
      }
    }

    fallbackCopy(text, btnElement) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        this.showCopiedState(btnElement);
      } catch (_) {}
      document.body.removeChild(textarea);
    }

    showCopiedState(btnElement) {
      if (!btnElement) return;
      const originalHtml = btnElement.innerHTML;
      btnElement.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
      btnElement.classList.add('btn-copied');
      setTimeout(() => {
        btnElement.innerHTML = originalHtml;
        btnElement.classList.remove('btn-copied');
      }, 2000);
    }
  }

  root.P2PSignalingUI = new P2PSignalingUI();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => root.P2PSignalingUI.init());
  } else {
    root.P2PSignalingUI.init();
  }
})(typeof window !== 'undefined' ? window : global);
