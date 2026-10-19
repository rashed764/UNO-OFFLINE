/**
 * WebRTC SDP Compact Serializer & Compressor for Offline QR Signaling
 * Compresses WebRTC SDP descriptions into ultra-compact payloads suitable for small QR codes.
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof exports === 'object') {
    module.exports = factory();
  } else {
    root.SdpCompact = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Lightweight LZW dictionary compressor
  function lzCompress(uncompressed) {
    if (!uncompressed) return '';
    const dict = {};
    const data = (uncompressed + '').split('');
    const out = [];
    let currChar;
    let phrase = data[0];
    let code = 256;
    for (let i = 1; i < data.length; i++) {
      currChar = data[i];
      if (dict[phrase + currChar] != null) {
        phrase += currChar;
      } else {
        out.push(phrase.length > 1 ? dict[phrase] : phrase.charCodeAt(0));
        dict[phrase + currChar] = code;
        code++;
        phrase = currChar;
      }
    }
    out.push(phrase.length > 1 ? dict[phrase] : phrase.charCodeAt(0));
    return out.map(c => String.fromCharCode(c)).join('');
  }

  function lzDecompress(compressed) {
    if (!compressed) return '';
    const dict = {};
    const data = (compressed + '').split('');
    let currChar = data[0];
    let oldPhrase = currChar;
    const out = [currChar];
    let code = 256;
    let phrase;
    for (let i = 1; i < data.length; i++) {
      const currCode = data[i].charCodeAt(0);
      if (currCode < 256) {
        phrase = data[i];
      } else {
        phrase = dict[currCode] ? dict[currCode] : (oldPhrase + currChar);
      }
      out.push(phrase);
      currChar = phrase.charAt(0);
      dict[code] = oldPhrase + currChar;
      code++;
      oldPhrase = phrase;
    }
    return out.join('');
  }

  function toSafeBase64(str) {
    try {
      const bytes = new TextEncoder().encode(str);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    } catch (_) {
      return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
  }

  function fromSafeBase64(str) {
    try {
      let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return new TextDecoder().decode(bytes);
    } catch (_) {
      let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      return decodeURIComponent(escape(atob(b64)));
    }
  }

  /**
   * Serializes a WebRTC RTCSessionDescription (offer or answer)
   * Produces delimiter-separated, ultra-compact string:
   * UNO3:<type>~<ufrag>~<pwd>~<cleanFp>~<setup>~<mid>~<cand1;cand2...>
   */
  function serializeSessionDescription(desc) {
    if (!desc || !desc.sdp) return '';
    const type = desc.type; // 'offer' or 'answer'
    const sdp = desc.sdp;

    const ufragMatch = sdp.match(/a=ice-ufrag:([^\r\n]+)/);
    const pwdMatch = sdp.match(/a=ice-pwd:([^\r\n]+)/);
    const fpMatch = sdp.match(/a=fingerprint:sha-256 ([^\r\n]+)/);
    const setupMatch = sdp.match(/a=setup:([^\r\n]+)/);
    const midMatch = sdp.match(/a=mid:([^\r\n]+)/);

    // Extract all candidate lines
    const candidateMatches = [...sdp.matchAll(/a=candidate:([^\r\n]+)/g)].map(m => m[1].trim());

    if (ufragMatch && pwdMatch && fpMatch) {
      const typeCode = type === 'offer' ? 'o' : 'a';
      const ufrag = ufragMatch[1].trim();
      const pwd = pwdMatch[1].trim();
      // Remove colons from fingerprint to save ~32 chars
      const cleanFp = fpMatch[1].replace(/:/g, '').trim();
      const setup = setupMatch ? setupMatch[1].trim() : (type === 'offer' ? 'actpass' : 'active');
      const mid = midMatch ? midMatch[1].trim() : '0';
      const joinedCands = candidateMatches.join(';');

      const rawCompact = `${typeCode}~${ufrag}~${pwd}~${cleanFp}~${setup}~${mid}~${joinedCands}`;
      return 'UNO3:' + toSafeBase64(rawCompact);
    }

    // Fallback: full compressed
    const fullObj = { _v: 1, type: desc.type, sdp: desc.sdp };
    return 'UNOF:' + toSafeBase64(lzCompress(JSON.stringify(fullObj)));
  }

  /**
   * Deserializes compact string back into standard RTCSessionDescriptionInit { type, sdp }
   */
  function deserializeSessionDescription(str) {
    if (!str || typeof str !== 'string') return null;
    str = str.trim();

    try {
      if (str.startsWith('UNO3:')) {
        const raw = fromSafeBase64(str.substring(5));
        const parts = raw.split('~');
        const typeCode = parts[0];
        const ufrag = parts[1];
        const pwd = parts[2];
        let rawFp = parts[3];
        const setup = parts[4] || (typeCode === 'o' ? 'actpass' : 'active');
        const mid = parts[5] || '0';
        const candStr = parts.slice(6).join('~'); // Rest are candidates

        // Restore colons into fingerprint if missing
        if (!rawFp.includes(':') && rawFp.length === 64) {
          rawFp = rawFp.match(/.{1,2}/g).join(':');
        }

        const type = (typeCode === 'o' || typeCode === 'offer') ? 'offer' : 'answer';
        const sessionId = Math.floor(Math.random() * 1000000000000);

        const reconstructedSdp = [
          'v=0',
          `o=- ${sessionId} 2 IN IP4 127.0.0.1`,
          's=-',
          't=0 0',
          'a=group:BUNDLE ' + mid,
          'a=extmap-allow-mixed',
          'a=msid-semantic: WMS',
          'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
          'c=IN IP4 0.0.0.0',
          'a=setup:' + setup,
          'a=mid:' + mid,
          'a=sctp-port:5000',
          'a=max-message-size:262144',
          'a=ice-ufrag:' + ufrag,
          'a=ice-pwd:' + pwd,
          'a=ice-options:trickle',
          'a=fingerprint:sha-256 ' + rawFp
        ];

        if (candStr) {
          candStr.split(';').forEach(c => {
            if (c.trim()) reconstructedSdp.push('a=candidate:' + c.trim());
          });
        }
        reconstructedSdp.push('');

        return {
          type: type,
          sdp: reconstructedSdp.join('\r\n')
        };
      }

      if (str.startsWith('UNO:')) {
        const rawJson = fromSafeBase64(str.substring(4));
        const obj = JSON.parse(rawJson);
        const type = obj.t === 'o' ? 'offer' : 'answer';
        const setup = obj.s || (type === 'offer' ? 'actpass' : 'active');
        const mid = obj.m || '0';
        const sessionId = Math.floor(Math.random() * 1000000000000);

        let reconstructedSdp = [
          'v=0',
          `o=- ${sessionId} 2 IN IP4 127.0.0.1`,
          's=-',
          't=0 0',
          'a=group:BUNDLE ' + mid,
          'a=extmap-allow-mixed',
          'a=msid-semantic: WMS',
          'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
          'c=IN IP4 0.0.0.0',
          'a=setup:' + setup,
          'a=mid:' + mid,
          'a=sctp-port:5000',
          'a=max-message-size:262144',
          'a=ice-ufrag:' + obj.u,
          'a=ice-pwd:' + obj.p,
          'a=ice-options:trickle',
          'a=fingerprint:sha-256 ' + obj.f
        ];

        if (Array.isArray(obj.c)) {
          obj.c.forEach(cand => {
            reconstructedSdp.push('a=candidate:' + cand);
          });
        }
        reconstructedSdp.push('');

        return {
          type: type,
          sdp: reconstructedSdp.join('\r\n')
        };
      }

      if (str.startsWith('UNOF:')) {
        const decompressed = lzDecompress(fromSafeBase64(str.substring(5)));
        const obj = JSON.parse(decompressed);
        return { type: obj.type, sdp: obj.sdp };
      }

      if (str.startsWith('{') && str.endsWith('}')) {
        const parsed = JSON.parse(str);
        if (parsed.sdp && parsed.type) {
          return { type: parsed.type, sdp: parsed.sdp };
        }
      }
    } catch (e) {
      console.error('Failed to deserialize SDP payload:', e);
      return null;
    }

    return null;
  }

  return {
    serialize: serializeSessionDescription,
    deserialize: deserializeSessionDescription,
    toSafeBase64,
    fromSafeBase64,
    lzCompress,
    lzDecompress
  };
});
