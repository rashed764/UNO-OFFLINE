/**
 * Offline QR Code Camera Scanner & Video Capture Controller
 * Uses pure JavaScript jsQR engine for reliable, 100% offline scanning on all devices.
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof exports === 'object') {
    module.exports = factory();
  } else {
    root.QRScanner = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  let activeStream = null;
  let activeAnimationId = null;

  async function start(options) {
    stop();

    const video = options.video;
    const canvas = options.canvas || document.createElement('canvas');
    const onScan = options.onScan;
    const onError = options.onError || console.warn;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      onError(new Error('Camera API (getUserMedia) not supported in this browser. Please use manual code paste.'));
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false
      });
      activeStream = stream;
      video.srcObject = stream;
      video.setAttribute('playsinline', 'true');
      await video.play();

      let isScanning = true;
      let lastScanTimestamp = 0;
      const SCAN_INTERVAL_MS = 120; // Scan ~8 times per second for smooth performance and low CPU

      const scanLoop = (timestamp) => {
        if (!isScanning || !activeStream) return;

        if (video.readyState >= video.HAVE_CURRENT_DATA && (timestamp - lastScanTimestamp >= SCAN_INTERVAL_MS)) {
          lastScanTimestamp = timestamp;

          if (video.videoWidth > 0 && video.videoHeight > 0) {
            const qrFn = window.jsQR || (typeof jsQR === 'function' ? jsQR : null);
            if (qrFn) {
              try {
                // Downscale slightly if needed for ultra-fast processing
                const width = Math.min(video.videoWidth, 480);
                const height = Math.round(video.videoHeight * (width / video.videoWidth));

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                ctx.drawImage(video, 0, 0, width, height);

                const imageData = ctx.getImageData(0, 0, width, height);
                const code = qrFn(imageData.data, imageData.width, imageData.height, {
                  inversionAttempts: 'dontInvert'
                });

                if (code && code.data) {
                  isScanning = false;
                  stop();
                  onScan(code.data);
                  return;
                }
              } catch (e) {
                console.warn('Frame scan error:', e);
              }
            }
          }
        }

        activeAnimationId = requestAnimationFrame(scanLoop);
      };

      activeAnimationId = requestAnimationFrame(scanLoop);
      return true;
    } catch (err) {
      console.warn('Camera access error:', err);
      onError(err);
      return false;
    }
  }

  function stop() {
    if (activeAnimationId) {
      cancelAnimationFrame(activeAnimationId);
      activeAnimationId = null;
    }
    if (activeStream) {
      activeStream.getTracks().forEach(track => {
        try { track.stop(); } catch (_) {}
      });
      activeStream = null;
    }
  }

  return {
    start,
    stop,
    isCameraSupported: function () {
      return Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    }
  };
});
