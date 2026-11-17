package uz.chronix.alarm

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityLifecycleListener

// Qulflangan ekran ustida ko'rinish FAQAT budilnik ochganda (chronix://alarm).
// Oyna yaratilayotganda (birinchi kadrdan oldin) va yangi havola kelganda tekshiriladi: telefon qulflangan
// bo'lsa ham budilnik darhol ko'rinadi, oddiy ochilishda esa ilova qulfni ochmasdan ko'rinmaydi.
class ChronixAlarmPackage : Package {
  override fun createReactActivityLifecycleListeners(activityContext: Context?): List<ReactActivityLifecycleListener> =
    listOf(AlarmLockScreenListener)
}

object AlarmLockScreenListener : ReactActivityLifecycleListener {
  fun isAlarm(intent: Intent?): Boolean =
    intent?.data?.let { it.scheme == "chronix" && it.host == "alarm" } == true

  fun apply(activity: Activity, on: Boolean) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      activity.setShowWhenLocked(on)
      activity.setTurnScreenOn(on)
    } else {
      @Suppress("DEPRECATION")
      val flags = WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
      if (on) activity.window.addFlags(flags) else activity.window.clearFlags(flags)
    }
  }

  override fun onCreate(activity: Activity, savedInstanceState: Bundle?) {
    apply(activity, isAlarm(activity.intent))
  }

  override fun onNewIntent(intent: Intent?): Boolean {
    // Faol oyna shu yerda ma'lum emas — modul (ChronixAlarmModule.OnNewIntent) qo'llaydi
    return false
  }
}
