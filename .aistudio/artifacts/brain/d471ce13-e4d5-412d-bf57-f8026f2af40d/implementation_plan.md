# Implementation Plan: Gameplay Sound Effects (Task 2)

Enhance the UNO gameplay experience by implementing a cohesive, lightweight, crisp arcade Web Audio synthesis sound system that covers all gameplay actions without adding heavy third-party libraries or risking audio context exhaustion.

## 1. Existing System Analysis & Gaps

### What Currently Exists:
- **Audio Context Usage**: Ad-hoc `new AudioContextClass()` created inside individual functions (`playReverseSynthSound`, `playWildColorChord`) and closed after timeouts. This can exhaust browser `AudioContext` limits in Android WebView.
- **Mute Control**: Existing toggle `#btn-drawer-sound` with `#sound-status` (`ON`/`OFF`) in the slide-out menu drawer.
- **Existing Sounds**:
  - `playReverseSynthSound`: Sawtooth pitch drop with sine sub-bass.
  - `playWildColorChord`: 3-oscillator chord played when picking a wild color.

### Missing Gameplay Sounds:
1. **Card Play / Discard**: No sound on normal card play.
2. **Card Draw**: No sound when drawing cards from the draw deck.
3. **Deck Shuffle**: No sound when the engine shuffles cards on match start or deck replenishment.
4. **Skip Card**: No sound (only visual stamp and shockwave).
5. **Draw Two**: No sound (only missile animation).
6. **Wild Card Play**: No entrance sound before color selection.
7. **Wild Draw Four**: No distinct high-impact sound (currently shares visual with Draw Two).

---

## 2. Audio Engine Architecture

A unified, resilient Web Audio synthesizer (`UnoAudio`) integrated into `app/src/main/assets/js/game.js` (or `game-effects.js`):
- **Singleton `AudioContext`**: Created lazily on first user interaction or resumed when suspended (handling browser autoplay policies).
- **Master Gain & Mute Sync**: Checks existing `#sound-status` (`ON`/`OFF`) before playing any sound; zero overhead when muted.
- **Tone Palette**: Crisp arcade synth tones with balanced medium volume (`gain` between 0.08 and 0.18), avoiding harsh clipping or distortion.
- **Concurrency & Throttle**: Throttles rapid identical sounds (< 80ms) and prevents duplicate sound triggers from network state re-broadcasts or re-renders.

---

## 3. Implementation of the 8 Required Sounds

| Sound Effect | Synth Recipe (Crisp Arcade Style) | Trigger Location |
| :--- | :--- | :--- |
| **1. Card Play** | Short percussive sine chirp + high pass pop (480Hz → 240Hz, 55ms) | Triggered when player plays card or remote discard ghost launches |
| **2. Card Draw** | Rapid upward frequency slide (300Hz → 750Hz, 90ms) | Triggered on manual draw click and remote draw animation |
| **3. Deck Shuffle** | Rapid rhythmic triple noise/blip flutter simulating riffle (180ms) | Triggered during `animateDealSequence` and deck reshuffle |
| **4. Skip** | Dual descending buzzer tone (440Hz & 330Hz → low notch, 180ms) | Triggered in `playSkipImpact` |
| **5. Reverse** | Polished orbital phase warp sweep (600Hz → 180Hz → 300Hz, 280ms) | Triggered in `playReverseImpact` |
| **6. Draw Two** | Dual-pulse arcade alert staccato (520Hz + 650Hz, 220ms) | Triggered in `playDrawTwoImpact` when `drawCount === 2` |
| **7. Wild Card** | Upward 4-note ascending arcade chime arpeggio (C5-E5-G5-B5, 240ms) | Triggered when Wild card is played |
| **8. Wild Draw Four**| Heavy multi-tone arcade power slam (sawtooth sweep + bass drop, 380ms) | Triggered in `playDrawTwoImpact` when `drawCount === 4` |

---

## 4. Deduplication & Authoritative Event Flow

- **Single Trigger per Action**:
  - For local player: sound triggers at action dispatch (e.g. `startDiscardFlight`, `startDrawGhost`).
  - For opponents/bots: sound triggers in `animateRemoteDiscard` and `animateRemoteDraw` using unique action signatures (`actorId:cardId:timestamp`) to guarantee zero duplicate sounds across network sync cycles.
  - Rejection safety: If engine rejects an invalid play, discard flight is cancelled and error toast is shown without playing success audio.

---

## 5. Files to Update
- `app/src/main/assets/js/game.js`: Integrate singleton audio synthesizer, implement all 8 sound routines, wire triggers into card play, draw, shuffle, and power impact routines.
- `app/src/main/assets/js/engine/GameEngine.js` or game event bridge: Ensure shuffle event is exposed when discard pile reshuffles.

---

## 6. Verification & Regression Plan
1. **Compilation**: Run `compile_applet` to confirm clean Android build.
2. **Automated Unit Tests**: Execute `gradle :app:testDebugUnitTest`.
3. **Manual Flow Checks**:
   - Verify Mute button toggles all sounds off and on.
   - Verify normal number cards play crisp play sound once.
   - Verify draw deck click plays draw sound once.
   - Verify Skip, Reverse, Draw Two, Wild, and Wild Draw Four each trigger distinct, recognizable arcade sounds.
   - Verify bot moves also trigger the appropriate sounds with no double-triggering.
