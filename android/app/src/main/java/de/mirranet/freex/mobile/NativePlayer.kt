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

import android.graphics.Color
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.View
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import androidx.media3.session.MediaSession
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import org.json.JSONObject

/**
 * ExoPlayer for the page: plays one URL (the file itself or the server's HLS conversion), draws
 * into a [PlayerView] behind the WebView and reports its state as JSON events. A [MediaSession]
 * gives the lock screen, headsets and picture in picture their play and pause buttons. All calls
 * must come on the main thread.
 */
@OptIn(UnstableApi::class)
class NativePlayer(private val activity: MainActivity, private val emit: (JSONObject) -> Unit) {

    val view: PlayerView = PlayerView(activity).apply {
        useController = false
        resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
        setShutterBackgroundColor(Color.BLACK)
        setKeepContentOnPlayerReset(false)
        isFocusable = false
        visibility = View.GONE
    }

    private var exo: ExoPlayer? = null
    private var session: MediaSession? = null
    private var readySent = false
    private val handler = Handler(Looper.getMainLooper())
    private val ticker = object : Runnable {
        override fun run() {
            val p = exo ?: return
            emit(state("time", p))
            handler.postDelayed(this, 500)
        }
    }

    /** Whether a title is open (also while paused). */
    val active: Boolean get() = exo?.currentMediaItem != null

    val playing: Boolean get() = exo?.isPlaying == true

    /** Size of the picture, for the shape of the picture-in-picture window. */
    var videoSize: VideoSize = VideoSize.UNKNOWN
        private set

    private fun create(): ExoPlayer {
        exo?.let { return it }
        // Segments of a conversion are made on request: allow time for them, and retry.
        val http = DefaultHttpDataSource.Factory()
            .setUserAgent("FreeX Mobile (Android)")
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(30_000)
            .setReadTimeoutMs(75_000)
        val sources = DefaultMediaSourceFactory(http)
            .setLoadErrorHandlingPolicy(DefaultLoadErrorHandlingPolicy(6))
        val renderers = DefaultRenderersFactory(activity)
            .setEnableDecoderFallback(true)
            .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON)
        val player = ExoPlayer.Builder(activity, renderers)
            .setMediaSourceFactory(sources)
            .setHandleAudioBecomingNoisy(true)
            .build()
        player.setAudioAttributes(
            AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(),
            true,
        )
        player.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) {
                when (playbackState) {
                    Player.STATE_BUFFERING -> emit(JSONObject().put("type", "buffering").put("on", true))
                    Player.STATE_READY -> {
                        if (!readySent) {
                            readySent = true
                            emit(state("ready", player))
                        }
                        emit(JSONObject().put("type", "buffering").put("on", false))
                    }
                    Player.STATE_ENDED -> emit(state("ended", player))
                    else -> Unit
                }
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) {
                activity.keepScreenOn(isPlaying)
                activity.updatePip()
                emit(state("state", player))
            }

            override fun onVideoSizeChanged(size: VideoSize) {
                videoSize = size
                activity.updatePip()
            }

            override fun onPlayerError(error: PlaybackException) {
                emit(JSONObject().put("type", "error").put("message", "${error.errorCodeName}: ${error.message ?: ""}"))
            }
        })
        view.player = player
        exo = player
        session = try {
            MediaSession.Builder(activity, player).setId("freex").build()
        } catch (e: Exception) {
            null
        }
        return player
    }

    private fun state(type: String, p: Player): JSONObject {
        val duration = if (p.duration == C.TIME_UNSET) 0 else p.duration
        return JSONObject()
            .put("type", type)
            .put("position", p.currentPosition)
            .put("duration", duration)
            .put("playing", p.isPlaying || (p.playWhenReady && p.playbackState == Player.STATE_BUFFERING))
    }

    /** `{url, hls, startMs, title, subtitle, artwork}` from the page. */
    fun open(o: JSONObject) {
        val player = create()
        readySent = false
        val meta = MediaMetadata.Builder()
            .setTitle(o.optString("title"))
            .setArtist(o.optString("subtitle"))
        o.optString("artwork").takeIf { it.isNotEmpty() }?.let { meta.setArtworkUri(Uri.parse(it)) }
        val item = MediaItem.Builder()
            .setUri(o.getString("url"))
            .setMediaMetadata(meta.build())
        if (o.optBoolean("hls")) item.setMimeType(MimeTypes.APPLICATION_M3U8)
        view.visibility = View.VISIBLE
        player.playWhenReady = false
        player.setMediaItem(item.build(), o.optLong("startMs", 0))
        player.prepare()
        handler.removeCallbacks(ticker)
        handler.post(ticker)
    }

    fun play() {
        exo?.play()
    }

    fun pause() {
        exo?.pause()
    }

    fun seek(ms: Long) {
        exo?.seekTo(ms.coerceAtLeast(0))
    }

    fun rate(value: Float) {
        exo?.playbackParameters = PlaybackParameters(value.coerceIn(0.25f, 4f))
    }

    fun stop() {
        handler.removeCallbacks(ticker)
        exo?.let {
            it.stop()
            it.clearMediaItems()
        }
        videoSize = VideoSize.UNKNOWN
        activity.keepScreenOn(false)
        activity.updatePip()
        view.visibility = View.GONE
    }

    fun release() {
        stop()
        view.player = null
        session?.release()
        session = null
        exo?.release()
        exo = null
    }
}
