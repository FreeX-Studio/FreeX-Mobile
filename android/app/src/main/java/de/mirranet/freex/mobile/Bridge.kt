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

import android.content.Context
import android.content.pm.PackageManager
import android.media.MediaCodecList
import android.os.Build
import android.provider.Settings
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject

/**
 * `window.FreeXNative` in the page (see web/js/host.js). JavaScript calls these methods on a
 * background thread; everything that touches views runs on the main thread.
 */
class Bridge(private val activity: MainActivity) {

    private val prefs = activity.getSharedPreferences("freex", Context.MODE_PRIVATE)

    /** Everything the page needs at its start: version, device, what it plays, the saved state. */
    @JavascriptInterface
    fun info(): String = JSONObject()
        .put("platform", "android")
        .put("version", versionName())
        .put("deviceName", deviceName())
        .put("caps", capabilities)
        .put("stored", prefs.getString(STATE, "{}"))
        .put("pip", Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            activity.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE))
        .toString()

    /** A command `{cmd, …}` from the page. */
    @JavascriptInterface
    fun post(json: String) {
        val o = try {
            JSONObject(json)
        } catch (e: Exception) {
            return
        }
        // The saved state is written right away, so it is there even if the app is closed next.
        if (o.optString("cmd") == "save") {
            prefs.edit().putString(STATE, o.optString("data", "{}")).apply()
            return
        }
        activity.runOnUiThread { activity.command(o) }
    }

    private fun versionName(): String = try {
        activity.packageManager.getPackageInfo(activity.packageName, 0).versionName ?: ""
    } catch (e: Exception) {
        ""
    }

    /** The name the user gave the phone, otherwise maker and model. */
    private fun deviceName(): String {
        val named = try {
            Settings.Global.getString(activity.contentResolver, "device_name")
        } catch (e: Exception) {
            null
        }
        if (!named.isNullOrBlank()) return named
        val maker = Build.MANUFACTURER.replaceFirstChar { it.uppercase() }
        return if (Build.MODEL.startsWith(maker, ignoreCase = true)) Build.MODEL else "$maker ${Build.MODEL}"
    }

    private val capabilities: JSONObject by lazy { probe() }

    /** What ExoPlayer can play on this device, as the server's playback decision expects it. */
    private fun probe(): JSONObject {
        val types = HashSet<String>()
        for (info in MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos) {
            if (info.isEncoder) continue
            info.supportedTypes.forEach { types.add(it.lowercase()) }
        }
        val video = linkedSetOf("h264")
        mapOf(
            "video/hevc" to "hevc", "video/x-vnd.on2.vp9" to "vp9", "video/av01" to "av1",
            "video/mpeg2" to "mpeg2video", "video/mp4v-es" to "mpeg4", "video/x-vnd.on2.vp8" to "vp8",
        ).forEach { (mime, name) -> if (mime in types) video.add(name) }

        // ExoPlayer brings its own decoders for these; the rest only where the phone has one.
        val audio = linkedSetOf("aac", "mp3", "flac", "opus", "vorbis")
        mapOf(
            "audio/ac3" to "ac3", "audio/eac3" to "eac3", "audio/vnd.dts" to "dts", "audio/true-hd" to "truehd",
        ).forEach { (mime, name) -> if (mime in types) audio.add(name) }
        audio.addAll(listOf("pcm_s16le", "pcm_s24le"))

        val hlsVideo = video.filter { it == "h264" || it == "hevc" || it == "av1" }
        val hlsAudio = audio.filter { it in setOf("aac", "mp3", "ac3", "eac3", "flac", "opus") }
        return JSONObject()
            .put("containers", JSONArray(listOf("mp4", "mkv", "webm", "mpegts", "ts", "avi", "mov", "flv", "ogg")))
            .put("video", JSONArray(video.toList()))
            .put("audio", JSONArray(audio.toList()))
            .put("mseVideo", JSONArray(hlsVideo))
            .put("mseAudio", JSONArray(hlsAudio))
    }

    companion object {
        private const val STATE = "state"
    }
}
