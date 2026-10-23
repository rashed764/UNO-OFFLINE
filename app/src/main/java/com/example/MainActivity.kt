package com.example

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.speech.tts.TextToSpeech
import android.view.ViewGroup
import android.util.Log
import java.util.Locale
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.example.ui.theme.MyApplicationTheme

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.insetsController?.let { controller ->
                controller.hide(android.view.WindowInsets.Type.systemBars())
                controller.systemBarsBehavior = android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                android.view.View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or android.view.View.SYSTEM_UI_FLAG_FULLSCREEN
                or android.view.View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or android.view.View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or android.view.View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            )
        }

        setContent {
            MyApplicationTheme {
                UnoGameScreen()
            }
        }
    }
}

class AndroidBridge(
    private val context: Context,
    private val webView: WebView? = null
) : TextToSpeech.OnInitListener {

    private var tts: TextToSpeech? = null

    @Volatile
    private var isTtsReady = false

    init {
        try {
            tts = TextToSpeech(context.applicationContext, this)
        } catch (e: Exception) {
            Log.e("AndroidBridge", "Failed to initialize TextToSpeech", e)
        }
    }

    override fun onInit(status: Int) {
        if (status == TextToSpeech.SUCCESS) {
            val result = tts?.setLanguage(Locale.US)
            if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
                val defaultResult = tts?.setLanguage(Locale.getDefault())
                isTtsReady = (defaultResult != TextToSpeech.LANG_MISSING_DATA && defaultResult != TextToSpeech.LANG_NOT_SUPPORTED)
            } else {
                isTtsReady = true
            }

            // Inspect available voices and select a natural English male voice if available
            try {
                val voices = tts?.voices
                if (!voices.isNullOrEmpty()) {
                    val maleVoice = voices.firstOrNull { voice ->
                        val isEnglish = voice.locale?.language.equals("en", ignoreCase = true)
                        val name = voice.name.lowercase(Locale.ROOT)
                        isEnglish && (
                            (name.contains("male") && !name.contains("female")) ||
                            name.contains("-sfg") ||
                            name.contains("-tpd") ||
                            name.contains("-iom") ||
                            name.contains("-iol")
                        )
                    } ?: voices.firstOrNull { voice ->
                        val isEnglish = voice.locale?.language.equals("en", ignoreCase = true)
                        val name = voice.name.lowercase(Locale.ROOT)
                        isEnglish && !name.contains("female")
                    } ?: voices.firstOrNull { voice ->
                        voice.locale?.language.equals("en", ignoreCase = true)
                    }

                    if (maleVoice != null) {
                        tts?.voice = maleVoice
                        Log.d("AndroidBridge", "Selected deep male voice: ${maleVoice.name} (locale=${maleVoice.locale})")
                    }
                }
            } catch (e: Exception) {
                Log.w("AndroidBridge", "Could not filter male voices: ${e.message}")
            }

            Log.d("AndroidBridge", "TextToSpeech initialized successfully, isReady: $isTtsReady")
        } else {
            Log.e("AndroidBridge", "TextToSpeech initialization failed with status: $status")
            isTtsReady = false
        }
    }

    @JavascriptInterface
    fun speak(text: String?, pitch: Float, speechRate: Float) {
        val message = text?.trim() ?: return
        if (message.isEmpty() || message.length > 120) return
        if (!isTtsReady || tts == null) {
            Log.w("AndroidBridge", "speak called but TTS is not ready yet: $message")
            return
        }

        try {
            val safePitch = pitch.coerceIn(0.5f, 2.0f)
            val safeRate = speechRate.coerceIn(0.5f, 2.5f)
            tts?.setPitch(safePitch)
            tts?.setSpeechRate(safeRate)
            // QUEUE_FLUSH interrupts previous callouts for snappy, immediate responses
            tts?.speak(message, TextToSpeech.QUEUE_FLUSH, null, "uno_voice_${System.currentTimeMillis()}")
            Log.d("AndroidBridge", "Speaking utterance: \"$message\" (pitch=$safePitch, rate=$safeRate)")
        } catch (e: Exception) {
            Log.e("AndroidBridge", "Error speaking utterance: $message", e)
        }
    }

    @JavascriptInterface
    fun stopSpeech() {
        try {
            tts?.stop()
        } catch (e: Exception) {
            Log.e("AndroidBridge", "Error stopping speech", e)
        }
    }

    @JavascriptInterface
    fun isTtsReady(): Boolean {
        return isTtsReady
    }

    fun shutdown() {
        try {
            tts?.stop()
            tts?.shutdown()
        } catch (_: Exception) {}
        tts = null
        isTtsReady = false
    }

    @JavascriptInterface
    fun vibrate(durationMillis: Long) {
        try {
            val duration = durationMillis.coerceIn(10L, 500L)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vibratorManager = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
                vibratorManager?.defaultVibrator?.vibrate(
                    VibrationEffect.createOneShot(duration, VibrationEffect.DEFAULT_AMPLITUDE)
                )
            } else {
                @Suppress("DEPRECATION")
                val vibrator = context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator?.vibrate(
                        VibrationEffect.createOneShot(duration, VibrationEffect.DEFAULT_AMPLITUDE)
                    )
                } else {
                    @Suppress("DEPRECATION")
                    vibrator?.vibrate(duration)
                }
            }
        } catch (_: Exception) {}
    }

    @JavascriptInterface
    fun showToast(message: String) {
        Toast.makeText(context, message, Toast.LENGTH_SHORT).show()
    }

    @JavascriptInterface
    fun getAppVersion(): String {
        return "1.0.0"
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun UnoGameScreen() {
    val context = LocalContext.current
    var webViewInstance: WebView? = remember { null }
    var bridgeInstance by remember { mutableStateOf<AndroidBridge?>(null) }
    var pendingPermissionRequest by remember { mutableStateOf<PermissionRequest?>(null) }

    val cameraPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        val request = pendingPermissionRequest
        if (request != null) {
            if (isGranted) {
                request.grant(request.resources)
            } else {
                request.deny()
                Toast.makeText(context, "Camera permission needed for QR code scanner", Toast.LENGTH_SHORT).show()
            }
            pendingPermissionRequest = null
        }
    }

    BackHandler {
        webViewInstance?.evaluateJavascript(
            "if (document.getElementById('game-screen')?.classList.contains('active')) { document.getElementById('btn-menu-trigger')?.click(); } else if (document.getElementById('lobby-screen')?.classList.contains('active')) { document.getElementById('btn-leave-lobby')?.click(); } else if (document.getElementById('custom-layout-modal')?.classList.contains('active')) { document.getElementById('btn-layout-save')?.click(); } else if (document.getElementById('theme-shop-modal')?.classList.contains('active')) { document.getElementById('btn-shop-close')?.click(); }",
            null
        )
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF071B18))
    ) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { ctx ->
                WebView(ctx).apply {
                    layoutParams = ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                    )
                    setBackgroundColor(android.graphics.Color.TRANSPARENT)

                    settings.apply {
                        javaScriptEnabled = true
                        domStorageEnabled = true
                        allowFileAccess = true
                        allowContentAccess = true
                        allowFileAccessFromFileURLs = true
                        allowUniversalAccessFromFileURLs = true
                        mediaPlaybackRequiresUserGesture = false
                        cacheMode = WebSettings.LOAD_DEFAULT
                        useWideViewPort = true
                        loadWithOverviewMode = true
                    }

                    val bridge = AndroidBridge(ctx, this)
                    bridgeInstance = bridge
                    addJavascriptInterface(bridge, "AndroidBridge")

                    webChromeClient = object : WebChromeClient() {
                        override fun onPermissionRequest(request: PermissionRequest?) {
                            if (request == null) return
                            val needsCamera = request.resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)
                            if (needsCamera) {
                                if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                                    request.grant(request.resources)
                                } else {
                                    pendingPermissionRequest = request
                                    cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
                                }
                            } else {
                                request.grant(request.resources)
                            }
                        }

                        override fun onPermissionRequestCanceled(request: PermissionRequest?) {
                            if (pendingPermissionRequest == request) {
                                pendingPermissionRequest = null
                            }
                        }

                        override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                            if (consoleMessage != null) {
                                Log.d("UnoWebView", "[JS] ${consoleMessage.message()} -- line ${consoleMessage.lineNumber()} (${consoleMessage.sourceId()})")
                            }
                            return true
                        }
                    }

                    webViewClient = object : WebViewClient() {
                        override fun onPageFinished(view: WebView?, url: String?) {
                            super.onPageFinished(view, url)
                            Log.d("UnoWebView", "WebView loaded: $url")
                        }

                        override fun onReceivedError(
                            view: WebView?,
                            request: WebResourceRequest?,
                            error: WebResourceError?
                        ) {
                            super.onReceivedError(view, request, error)
                            if (request?.isForMainFrame == true) {
                                Log.e("UnoWebView", "Main frame load error: ${error?.description}")
                            }
                        }
                    }

                    loadUrl("file:///android_asset/index.html")
                    webViewInstance = this
                }
            },
            update = { webView ->
                webViewInstance = webView
            }
        )
    }

    DisposableEffect(Unit) {
        onDispose {
            pendingPermissionRequest = null
            bridgeInstance?.shutdown()
            webViewInstance?.destroy()
        }
    }
}
