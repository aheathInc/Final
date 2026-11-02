package com.example.a_health_patient

import android.Manifest
import android.app.*
import android.content.*
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

/** Stores opaque IDs/times and generic copy only; never medicine/patient names. */
object MedicationAlarmStore {
    private const val STORE = "ah_medication_alarms"
    private const val CHANNEL = "ah_medication_reminders"
    private fun prefs(c: Context) = c.getSharedPreferences(STORE, Context.MODE_PRIVATE)
    private fun owner(value: String) = MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }
    private fun manager(c: Context) = c.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    private fun pending(c: Context, id: String): PendingIntent = PendingIntent.getBroadcast(c, 0,
        Intent(c, MedicationReminderReceiver::class.java).setAction("ahealth.MEDICATION").setData(Uri.parse("ahealth://reminder/$id")).putExtra("id", id),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    private fun events(c: Context) = JSONArray(prefs(c).getString("events", "[]") ?: "[]")
    fun notificationsAllowed(c: Context): Boolean = (Build.VERSION.SDK_INT < 33 || c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
        (c.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).areNotificationsEnabled()
    fun exactAllowed(c: Context) = Build.VERSION.SDK_INT < 31 || manager(c).canScheduleExactAlarms()
    fun status(c: Context): Map<String, Any> {
        val rows=events(c);val future=(0 until rows.length()).map{rows.getJSONObject(it).getLong("at")}.filter{it>System.currentTimeMillis()}
        return mapOf("enabled" to prefs(c).getBoolean("enabled", false), "notifications_allowed" to notificationsAllowed(c),
            "exact_allowed" to exactAllowed(c), "scheduled_count" to future.size, "coverage_end" to (future.maxOrNull()?:0))
    }
    fun clear(c: Context) {
        val rows=events(c)
        for(i in 0 until rows.length()) manager(c).cancel(pending(c, rows.getJSONObject(i).getString("id")))
        (c.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancelAll()
        prefs(c).edit().putString("events", "[]").putString("owner", "").putBoolean("enabled", false).apply()
    }
    fun setOwner(c: Context, user: String) {
        val hash=owner(user)
        if(prefs(c).getString("owner", "")!=hash) { clear(c); prefs(c).edit().putString("owner",hash).putBoolean("enabled",prefs(c).getBoolean("opt_$hash",false)).apply() }
    }
    fun enable(c: Context, enabled: Boolean) {
        val hash=prefs(c).getString("owner", "") ?: ""
        if(hash.isEmpty()) return
        prefs(c).edit().putBoolean("enabled",enabled).putBoolean("opt_$hash",enabled).apply()
        if(!enabled) { val saved=hash; clear(c); prefs(c).edit().putString("owner",saved).apply() }
    }
    private fun schedule(c:Context, e:JSONObject) {
        val at=e.getLong("at")
        if(at<=System.currentTimeMillis() || at>System.currentTimeMillis()+366L*86400000) return
        val p=pending(c,e.getString("id"))
        if(exactAllowed(c)) manager(c).setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,at,p)
        else manager(c).setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,at,p)
    }
    fun replace(c:Context,user:String,rows:List<Map<String,Any?>>) {
        val hash=owner(user)
        if(prefs(c).getString("owner", "")!=hash || !prefs(c).getBoolean("enabled",false)) return
        val old=events(c);for(i in 0 until old.length()) manager(c).cancel(pending(c,old.getJSONObject(i).getString("id")))
        val result=JSONArray()
        for(row in rows.take(400)) {
            val id=row["id"] as? String ?: continue
            val at=(row["at"] as? Number)?.toLong() ?: continue
            if(!id.matches(Regex("[A-Za-z0-9_-]{1,100}")) || at<=System.currentTimeMillis()) continue
            val e=JSONObject().put("id",id).put("at",at).put("owner",hash)
                .put("title",(row["title"] as? String ?: "A-Health").take(100)).put("body",(row["body"] as? String ?: "Open A-Health").take(250))
            schedule(c,e);result.put(e)
        }
        prefs(c).edit().putString("events",result.toString()).apply()
    }
    fun restore(c:Context) { if(prefs(c).getBoolean("enabled",false)) { val rows=events(c);for(i in 0 until rows.length())schedule(c,rows.getJSONObject(i)) } }
    fun notify(c:Context,id:String) {
        if(!notificationsAllowed(c)||!prefs(c).getBoolean("enabled",false))return
        val rows=events(c);val row=(0 until rows.length()).map{rows.getJSONObject(it)}.find{it.getString("id")==id}?:return
        if(row.optString("owner")!=prefs(c).getString("owner", ""))return
        showNotification(c,id,row.getString("title"),row.getString("body"))
    }
    fun refill(c:Context,user:String,key:String,title:String,body:String) {
        val hash=owner(user)
        if(!notificationsAllowed(c)||!prefs(c).getBoolean("enabled",false)||prefs(c).getString("owner","")!=hash||key.isEmpty())return
        val seen="refill_${hash}_${owner(key)}"
        if(prefs(c).getBoolean(seen,false))return
        showNotification(c,seen,title.take(100),body.take(250))
        prefs(c).edit().putBoolean(seen,true).apply()
    }
    private fun showNotification(c:Context,id:String,title:String,body:String) {
        val nm=c.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if(Build.VERSION.SDK_INT>=26) nm.createNotificationChannel(NotificationChannel(CHANNEL,"A-Health",NotificationManager.IMPORTANCE_HIGH).apply { description="Medication reminders"; lockscreenVisibility=Notification.VISIBILITY_PRIVATE })
        val intent=Intent(c,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP).putExtra("openMedication",true)
        val open=PendingIntent.getActivity(c,0,intent,PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val builder=if(Build.VERSION.SDK_INT>=26)Notification.Builder(c,CHANNEL) else Notification.Builder(c).setPriority(Notification.PRIORITY_HIGH).setDefaults(Notification.DEFAULT_ALL)
        nm.notify(id.hashCode(),builder.setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle(title)
            .setContentText(body).setContentIntent(open).setAutoCancel(true).setVisibility(Notification.VISIBILITY_PRIVATE).setCategory(Notification.CATEGORY_REMINDER).build())
    }
}
class MedicationReminderReceiver:BroadcastReceiver() {
    override fun onReceive(context:Context,intent:Intent) {
        try {
            if(intent.action==Intent.ACTION_BOOT_COMPLETED || intent.action==Intent.ACTION_TIME_CHANGED || intent.action==Intent.ACTION_TIMEZONE_CHANGED || intent.action==AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED) MedicationAlarmStore.restore(context)
            else intent.getStringExtra("id")?.let{MedicationAlarmStore.notify(context,it)}
        } catch(_:Exception) { /* No notification is preferable to an unsafe report. */ }
    }
}
