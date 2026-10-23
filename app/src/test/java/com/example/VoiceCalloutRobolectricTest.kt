package com.example

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class VoiceCalloutRobolectricTest {

  @Test
  fun `verify five prerecorded voice files exist in assets`() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    
    val files = listOf(
      "audio/voice/skip.mp3",
      "audio/voice/reverse.mp3",
      "audio/voice/draw_two.mp3",
      "audio/voice/wild.mp3",
      "audio/voice/wild_draw_four.mp3"
    )

    files.forEach { path ->
      context.assets.open(path).use { stream ->
        val size = stream.available()
        assertTrue("Asset $path must be readable and non-empty (got $size bytes)", size > 0)
      }
    }
  }

  @Test
  fun `verify voice controls and audition buttons exist in index html`() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val html = context.assets.open("index.html").bufferedReader().use { it.readText() }

    assertTrue("Must have drawer voice button", html.contains("btn-drawer-voice"))
    assertTrue("Must have settings voice toggle button", html.contains("btn-toggle-voice"))
    assertTrue("Must have voice status labels", html.contains("label-voice-status"))
    assertTrue("Must have drawer voice status label", html.contains("drawer-voice-status"))
    assertTrue("Must have voice audition test buttons", html.contains("btn-voice-test"))
    assertTrue("Must have draw2 audition button", html.contains("data-voice=\"draw2\""))
    assertTrue("Must have skip audition button", html.contains("data-voice=\"skip\""))
    assertTrue("Must have wild audition button", html.contains("data-voice=\"wild\""))
    assertTrue("Must have reverse audition button", html.contains("data-voice=\"reverse\""))
    assertTrue("Must have draw4 audition button", html.contains("data-voice=\"wild_draw4\""))
  }

  @Test
  fun `verify UnoVoice prerecorded voice clips in game js`() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val js = context.assets.open("js/game.js").bufferedReader().use { it.readText() }

    assertTrue("Must define UnoVoice subsystem", js.contains("const UnoVoice = (function()"))
    assertTrue("Must export window.UnoVoice", js.contains("window.UnoVoice = UnoVoice"))
    assertTrue("Must have VOICE_ASSETS mapping", js.contains("VOICE_ASSETS"))
    assertTrue("Must map skip.mp3", js.contains("audio/voice/skip.mp3"))
    assertTrue("Must map reverse.mp3", js.contains("audio/voice/reverse.mp3"))
    assertTrue("Must map draw_two.mp3", js.contains("audio/voice/draw_two.mp3"))
    assertTrue("Must map wild.mp3", js.contains("audio/voice/wild.mp3"))
    assertTrue("Must map wild_draw_four.mp3", js.contains("audio/voice/wild_draw_four.mp3"))
    assertTrue("Must have playVoiceClip implementation", js.contains("playVoiceClip"))
    assertTrue("Must keep normal cards strictly silent", js.contains("Normal cards: strictly silent"))
    assertTrue("Must wire voice announcements into finishDiscardFlight", js.contains("UnoVoice.announceCard(pending.card, true)"))
    assertTrue("Must wire voice announcements into animateRemoteDiscard", js.contains("UnoVoice.announceCard(nextState.topCard, false)"))
    assertTrue("Must cancel voice on game reset or master mute", js.contains("UnoVoice.cancelAll()"))
  }

  @Test
  fun `verify AndroidBridge TTS methods and voice selection`() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val bridge = AndroidBridge(context)

    assertNotNull(bridge)
    bridge.speak("UNO!", 0.85f, 1.00f)
    bridge.stopSpeech()
    bridge.shutdown()
  }
}
