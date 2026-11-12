/*
 * Copyright (c) 2026 MirraNET, Niklas Linz. All rights reserved.
 *
 * This file is part of the MirraNET project and is licensed under the
 * GNU Lesser General Public License v3.0 (LGPLv3).
 *
 * You may use, distribute and modify this code under the terms
 * of the LGPLv3 license. You should have received a copy of the
 * license along with this file. If not, see <https://www.gnu.org/licenses/lgpl-3.0.html>
 * or contact: niklas.linz@mirranet.de
 */

package de.mirranet.freex.mobile

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.app.PictureInPictureParams
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.ApplicationInfo
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Rational
import android.view.HapticFeedbackConstants
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.window.OnBackInvokedDispatcher
import android.widget.FrameLayout
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import org.json.JSONObject
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * FreeX for Android phones and tablets.
 *
 * The interface is the shared mobile client (assets/web, the same as on iOS) in a WebView. Videos
 * play in ExoPlayer ([NativePlayer]), which draws behind the transparent WebView; the page talks
 * to the app through the JavaScript bridge `FreeXNative` ([Bridge]) and hears back through
 * `window.FreeXHostEvent`.
 *
 * The app draws behind the system bars; their size goes to the page as insets (CSS variables).
 */
class MainActivity : Activity() {

    private lateinit var root: FrameLayout
    private lateinit var webView: WebView
    private lateinit var player: NativePlayer
    private var pageReady = false
    private var insets = JSONObject().put("type", "insets")
    private var videoMode = false
    private var inPip = false

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        root = FrameLayout(this)
        root.setBackgroundColor(Color.BLACK)
        player = NativePlayer(this, ::sendEvent)
        root.addView(player.view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        if ((applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true)
        }
        webView = WebView(this)
        webView.setBackgroundColor(Color.TRANSPARENT)
        webView.overScrollMode = View.OVER_SCROLL_NEVER
        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            // The page comes from the app (https), the server is usually plain HTTP in the home network.
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            allowFileAccess = false
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            textZoom = 100
            userAgentString = "$userAgentString FreeXMobile/${packageManager.getPackageInfo(packageName, 0).versionName}"
        }

        // The app's own files under https://appassets.androidplatform.net/assets/…
        val assets = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assets.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == ASSET_HOST) return false
                openUrl(request.url.toString())
                return true
            }

            override fun onPageFinished(view: WebView, url: String) {
                pageReady = true
                sendEvent(insets)
            }
        }
        webView.addJavascriptInterface(Bridge(this), "FreeXNative")
        root.addView(webView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        setContentView(root)
        edgeToEdge()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT) { back() }
        }
        webView.loadUrl("https://$ASSET_HOST/assets/web/index.html")
        checkWebView()
    }

    /**
     * Devices without updates keep the WebView they came with (Android 8: Chrome 58 to 61); the
     * interface needs a newer one. Offers the update in the Play Store.
     */
    private fun checkWebView() {
        val pkg = try {
            WebViewCompat.getCurrentWebViewPackage(this)
        } catch (e: Exception) {
            null
        } ?: return
        val major = pkg.versionName?.substringBefore('.')?.toIntOrNull() ?: return
        if (major >= MIN_WEBVIEW) return
        AlertDialog.Builder(this)
            .setTitle(R.string.webview_old_title)
            .setMessage(getString(R.string.webview_old_text, pkg.versionName))
            .setPositiveButton(R.string.webview_update) { _, _ ->
                val market = Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=${pkg.packageName}"))
                try {
                    startActivity(market)
                } catch (e: ActivityNotFoundException) {
                    openUrl("https://play.google.com/store/apps/details?id=${pkg.packageName}")
                }
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    // ------------------------------------------------------------------ system bars and insets

    /**
     * From Android 11 on, the app draws behind the status and navigation bar and tells the page
     * their size; the keyboard makes the WebView smaller, as with adjustResize. Older versions
     * keep the bars in the interface's colour.
     */
    @Suppress("DEPRECATION")
    private fun edgeToEdge() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
        window.setDecorFitsSystemWindows(false)
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) window.isNavigationBarContrastEnforced = false
        root.setOnApplyWindowInsetsListener { _, wi ->
            val bars = wi.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
            val ime = wi.getInsets(WindowInsets.Type.ime())
            val d = resources.displayMetrics.density
            // The keyboard takes room from the page (it ends above it); the bars are drawn over it.
            val keyboard = max(0, ime.bottom)
            (webView.layoutParams as FrameLayout.LayoutParams).let {
                if (it.bottomMargin != keyboard) {
                    it.bottomMargin = keyboard
                    webView.layoutParams = it
                }
            }
            insets = JSONObject()
                .put("type", "insets")
                .put("top", (bars.top / d).roundToInt())
                .put("bottom", if (keyboard > 0) 0 else (bars.bottom / d).roundToInt())
                .put("left", (bars.left / d).roundToInt())
                .put("right", (bars.right / d).roundToInt())
            if (pageReady) sendEvent(insets)
            wi
        }
    }

    /** The player: sideways, without system bars. */
    @Suppress("DEPRECATION")
    private fun setVideoMode(on: Boolean) {
        if (videoMode == on) return
        videoMode = on
        requestedOrientation = if (on) ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE else ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.insetsController?.let {
                if (on) {
                    it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                    it.hide(WindowInsets.Type.systemBars())
                } else {
                    it.show(WindowInsets.Type.systemBars())
                }
            }
        } else {
            window.decorView.systemUiVisibility = if (on) {
                View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            } else {
                0
            }
        }
        if (!on) keepScreenOn(false)
        updatePip()
    }

    /** Keeps the screen on while a video plays. */
    fun keepScreenOn(on: Boolean) {
        if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    // ------------------------------------------------------------------ the page

    /** An event for the page (see host.js). */
    fun sendEvent(event: JSONObject) {
        runOnUiThread {
            webView.evaluateJavascript("window.FreeXHostEvent && window.FreeXHostEvent($event)", null)
        }
    }

    /** A command of the page (see [Bridge.post]); on the main thread. */
    fun command(o: JSONObject) {
        when (o.optString("cmd")) {
            "open" -> player.open(o)
            "play" -> player.play()
            "pause" -> player.pause()
            "seek" -> player.seek(o.optLong("ms"))
            "rate" -> player.rate(o.optDouble("value", 1.0).toFloat())
            "stop" -> player.stop()
            "pip" -> enterPip()
            "video" -> setVideoMode(o.optBoolean("on"))
            "exit" -> moveTaskToBack(true)
            "openUrl" -> openUrl(o.optString("url"))
            "haptic" -> webView.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
        }
    }

    private fun openUrl(url: String) {
        if (!url.startsWith("http://") && !url.startsWith("https://")) return
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        } catch (e: ActivityNotFoundException) {
            // no browser
        }
    }

    private fun back() {
        sendEvent(JSONObject().put("type", "back"))
    }

    @Deprecated("Only before Android 13; later the OnBackInvokedCallback gets it.")
    override fun onBackPressed() {
        back()
    }

    // ------------------------------------------------------------------ picture in picture

    private fun pipParams(): PictureInPictureParams? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return null
        val size = player.videoSize
        val ratio = if (size.width > 0 && size.height > 0) {
            // Android allows shapes between 1:2.39 and 2.39:1.
            val r = size.width.toFloat() * size.pixelWidthHeightRatio / size.height
            Rational((r.coerceIn(0.42f, 2.38f) * 1000).roundToInt(), 1000)
        } else {
            Rational(16, 9)
        }
        val b = PictureInPictureParams.Builder().setAspectRatio(ratio)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            b.setAutoEnterEnabled(videoMode && player.playing)
            b.setSeamlessResizeEnabled(true)
        }
        return b.build()
    }

    /** Keeps the picture-in-picture shape and automatic start up to date. */
    fun updatePip() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || !hasPip()) return
        try {
            pipParams()?.let { setPictureInPictureParams(it) }
        } catch (e: Exception) {
            // not allowed in this state
        }
    }

    private fun hasPip(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && packageManager.hasSystemFeature(android.content.pm.PackageManager.FEATURE_PICTURE_IN_PICTURE)

    private fun enterPip() {
        if (!hasPip() || !player.active) return
        try {
            pipParams()?.let { enterPictureInPictureMode(it) }
        } catch (e: Exception) {
            // turned off for the app
        }
    }

    /** Leaving the app while a video plays: picture in picture (Android 12 does it by itself). */
    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (Build.VERSION.SDK_INT in Build.VERSION_CODES.O until Build.VERSION_CODES.S && videoMode && player.playing) enterPip()
    }

    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        inPip = isInPictureInPictureMode
        sendEvent(JSONObject().put("type", "pip").put("on", isInPictureInPictureMode))
    }

    // ------------------------------------------------------------------ life cycle

    override fun onStart() {
        super.onStart()
        if (pageReady) sendEvent(JSONObject().put("type", "app").put("state", "foreground"))
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onPause() {
        // In picture in picture the activity is paused but still on screen: keep playing.
        if (!inPip) webView.onPause()
        super.onPause()
    }

    override fun onStop() {
        // In the background (or picture in picture closed) the video pauses.
        player.pause()
        sendEvent(JSONObject().put("type", "app").put("state", "background"))
        super.onStop()
    }

    override fun onDestroy() {
        player.release()
        webView.destroy()
        super.onDestroy()
    }

    companion object {
        const val ASSET_HOST = "appassets.androidplatform.net"

        /** Oldest WebView (Chromium major version) the interface is made for. */
        const val MIN_WEBVIEW = 84
    }
}
