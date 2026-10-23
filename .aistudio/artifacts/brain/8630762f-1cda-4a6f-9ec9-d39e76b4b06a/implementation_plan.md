# Implementation Plan: Prerecorded Deep Male Voice Clips for Power Cards

Replace Text-to-Speech (TTS) synthesis with the five user-provided, prerecorded deep male voice audio clips for all power card announcements, while keeping normal numbered cards completely silent.

## User Review & Critical Decisions

> [!IMPORTANT]
> The playback mechanism and interruption rules are confirmed with user preferences:

- **Confirmed Playback Engine**: HTML5 `Audio` elements in JavaScript referencing local asset paths (`audio/voice/*.mp3`).
- **Confirmed Interruption Rule**: Immediate cutoff (`currentAudio.pause(); currentAudio.currentTime = 0;`) when a new power card is played so fast moves never lag.
- **Power Cards Only**: Spoken voice triggers exclusively on accepted power card plays:
  - Skip (`skip.mp3`)
  - Reverse (`reverse.mp3`)
  - Draw Two (`draw_two.mp3`)
  - Wild (`wild.mp3`)
  - Wild Draw Four (`wild_draw_four.mp3`)
- **Normal Cards Silent**: Standard numbered cards (0–9) trigger only Web Audio discard sounds with zero voice playback.

---

## 1. File & Event Architecture

```
┌────────────────────────────────────────────────────────┐
│                   Card Discard Event                   │
│   (finishDiscardFlight / animateRemoteDiscard)          │
└──────────────────────────┬─────────────────────────────┘
                           │ passes card
                           ▼
┌────────────────────────────────────────────────────────┐
│               UnoVoice.playPowerCardVoice(card)        │
│   - Identifies card: skip, reverse, draw2, wild,       │
│     wild_draw4                                         │
│   - If normal card: returns early (SILENT)             │
│   - Checks voiceEnabled & master mute                  │
└──────────────────────────┬─────────────────────────────┘
                           │ if power card & unmuted
                           ▼
┌────────────────────────────────────────────────────────┐
│                   HTML5 Audio Pool                     │
│   - Stops any currently playing voice clip             │
│   - Plays corresponding audio/voice/<clip>.mp3         │
│   - Catches & handles any playback exceptions safely   │
└────────────────────────────────────────────────────────┘
```

---

## 2. Implementation Steps

1. **Configure Audio Clip Mapping in `app/src/main/assets/js/game.js`**:
   - Define local asset map:
     - `skip`: `'audio/voice/skip.mp3'`
     - `reverse`: `'audio/voice/reverse.mp3'`
     - `draw2`: `'audio/voice/draw_two.mp3'`
     - `wild`: `'audio/voice/wild.mp3'`
     - `wild_draw4`: `'audio/voice/wild_draw_four.mp3'`
   - Pre-instantiate and pool `new Audio(...)` instances with `preload = 'auto'` for instantaneous playback.
   - On playback: stop current active clip, rewind, and play selected clip asynchronously with error suppression (`.catch(() => {})`).
   - Normal numbered cards produce no voice.
   - Wire `cancelAll()` to pause and rewind any playing voice clip on match end, reset, or mute.
   - Update `testVoice` to play `'draw2'`, `'skip'`, and `'wild'` from the prerecorded MP3 clips.
2. **WebView Asset Permissions in `MainActivity.kt`**:
   - Ensure `settings.allowFileAccess = true`, `settings.allowFileAccessFromFileURLs = true`, and `settings.mediaPlaybackRequiresUserGesture = false` so local audio assets can play without browser gesture or CORS blocks.
3. **Automated Testing & Verification**:
   - Verify that all five MP3 files exist in `app/src/main/assets/audio/voice/`.
   - Update `VoiceCalloutRobolectricTest.kt` to verify that assets exist, can be opened from Context assets, and `UnoVoice` points to local MP3 paths.
   - Run `gradle :app:testDebugUnitTest` and `compile_applet`.
