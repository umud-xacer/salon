package uz.chronix.alarm

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val CHANNEL = "alarm_fullscreen"

// Bloklangan ekranni egallaydigan bildirishnoma: expo-notifications buni qo'llamaydi.
// Ovozsiz: signalni ochilgan budilnik ekrani chaladi, ekran ochiq bo'lsa oddiy "alarm" push chaladi.
class ChronixAlarmModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val manager: NotificationManager
    get() = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  override fun definition() = ModuleDefinition {
    Name("ChronixAlarm")

    AsyncFunction("show") { title: String, body: String, url: String ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
        return@AsyncFunction
      }
      val channel = NotificationChannel(CHANNEL, "Budilnik ekrani", NotificationManager.IMPORTANCE_HIGH)
      channel.setSound(null, null)
      channel.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      manager.createNotificationChannel(channel)

      val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
        .setPackage(context.packageName)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      val pending = PendingIntent.getActivity(
        context,
        url.hashCode(),
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
      val notification = Notification.Builder(context, CHANNEL)
        .setSmallIcon(context.applicationInfo.icon)
        .setContentTitle(title)
        .setContentText(body)
        .setCategory(Notification.CATEGORY_ALARM)
        .setVisibility(Notification.VISIBILITY_PUBLIC)
        .setAutoCancel(true)
        .setContentIntent(pending)
        .setFullScreenIntent(pending, true)
        .build()
      manager.notify(url.hashCode(), notification)
    }

    // Android 14 dan boshlab ruxsatni foydalanuvchi o'chirib qo'yishi mumkin
    AsyncFunction("canUseFullScreen") {
      Build.VERSION.SDK_INT < 34 || manager.canUseFullScreenIntent()
    }

    AsyncFunction("openFullScreenSettings") {
      if (Build.VERSION.SDK_INT >= 34) {
        val intent = Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:${context.packageName}"))
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
      }
    }
  }
}
