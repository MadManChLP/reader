package app.tauri.systemvolume

import android.app.Activity
import android.content.Context
import android.database.ContentObserver
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Channel
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import kotlin.math.roundToInt

@InvokeArg
class SetVolumeArgs {
    var volume: Float = 0f
}

@InvokeArg
class WatchVolumeArgs {
    lateinit var channel: Channel
}

@InvokeArg
class SetBrightnessArgs {
    var brightness: Float = 0f
}

@TauriPlugin
class SystemVolumePlugin(private val activity: Activity) : Plugin(activity) {
    private val audioManager =
        activity.applicationContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val watchers = mutableListOf<Channel>()
    private var observer: ContentObserver? = null
    private var lastSent = -1f
    private val pollHandler = Handler(Looper.getMainLooper())
    private var pollRunnable: Runnable? = null

    private fun currentVolume(): Float {
        val max = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        if (max <= 0) return 0f
        return audioManager.getStreamVolume(AudioManager.STREAM_MUSIC).toFloat() / max
    }

    @Command
    fun getVolume(invoke: Invoke) {
        val ret = JSObject()
        ret.put("volume", currentVolume())
        invoke.resolve(ret)
    }

    @Command
    fun setVolume(invoke: Invoke) {
        val args = invoke.parseArgs(SetVolumeArgs::class.java)
        val max = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        val index = (args.volume.coerceIn(0f, 1f) * max).roundToInt()
        try {
            audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, index, 0)
        } catch (_: SecurityException) {
            // Do-Not-Disturb restrictions can block volume changes — ignore.
        }
        pollHandler.post { notifyWatchers() }
        invoke.resolve()
    }

    @Command
    fun watchVolume(invoke: Invoke) {
        val args = invoke.parseArgs(WatchVolumeArgs::class.java)
        // Watcher list is mutated and iterated on the main thread only
        // (observer + poll both fire there).
        pollHandler.post { watchers.add(args.channel) }
        if (observer == null) {
            // There is no dedicated volume broadcast for third-party apps;
            // observing system settings changes catches SOME volume panel
            // changes, but hardware buttons often bypass Settings.System on
            // modern Android — the poll below is the reliable path.
            val obs = object : ContentObserver(Handler(Looper.getMainLooper())) {
                override fun onChange(selfChange: Boolean) {
                    notifyWatchers()
                }
            }
            activity.applicationContext.contentResolver.registerContentObserver(
                Settings.System.CONTENT_URI, true, obs
            )
            observer = obs
        }
        if (pollRunnable == null) {
            // Reading a stream volume twice a second is effectively free;
            // notifyWatchers deduplicates before sending.
            val runnable = object : Runnable {
                override fun run() {
                    notifyWatchers()
                    pollHandler.postDelayed(this, 500)
                }
            }
            pollHandler.postDelayed(runnable, 500)
            pollRunnable = runnable
        }
        invoke.resolve()
    }

    private fun notifyWatchers() {
        val v = currentVolume()
        if (v == lastSent) return
        lastSent = v
        val data = JSObject()
        data.put("volume", v)
        for (channel in watchers) {
            channel.send(data)
        }
    }

    // ---- Screen brightness -------------------------------------------------
    // Window-level override: only affects this app and reverts to system
    // control automatically (or via restoreBrightness → BRIGHTNESS_OVERRIDE_NONE).

    @Command
    fun getBrightness(invoke: Invoke) {
        activity.runOnUiThread {
            var value = activity.window.attributes.screenBrightness
            if (value < 0) {
                // No window override — read the system setting (0..255; newer
                // devices use wider/log scales, close enough for a slider start).
                value = try {
                    Settings.System.getInt(
                        activity.contentResolver, Settings.System.SCREEN_BRIGHTNESS
                    ) / 255f
                } catch (_: Exception) {
                    0.5f
                }
            }
            val ret = JSObject()
            ret.put("brightness", value.coerceIn(0f, 1f))
            invoke.resolve(ret)
        }
    }

    @Command
    fun setBrightness(invoke: Invoke) {
        val args = invoke.parseArgs(SetBrightnessArgs::class.java)
        activity.runOnUiThread {
            val lp = activity.window.attributes
            // Floor at 0.01: 0.0 turns the backlight fully off on some devices.
            lp.screenBrightness = args.brightness.coerceIn(0.01f, 1f)
            activity.window.attributes = lp
        }
        invoke.resolve()
    }

    @Command
    fun restoreBrightness(invoke: Invoke) {
        activity.runOnUiThread {
            val lp = activity.window.attributes
            lp.screenBrightness = android.view.WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
            activity.window.attributes = lp
        }
        invoke.resolve()
    }
}
