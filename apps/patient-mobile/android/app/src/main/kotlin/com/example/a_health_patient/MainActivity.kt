package com.example.a_health_patient

import io.flutter.embedding.android.FlutterFragmentActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import android.app.Activity
import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.hardware.biometrics.BiometricManager

class MainActivity : FlutterFragmentActivity() {
    private var reminderChannel: MethodChannel? = null
    private var reminderPermission: MethodChannel.Result? = null
    private var pendingSave: MethodChannel.Result? = null
    private var receiptBytes: ByteArray? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        reminderChannel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger,"ahealth/medication_reminders").also { channel ->
            channel.setMethodCallHandler { call,result ->
                try { when(call.method) {
                    "owner" -> { MedicationAlarmStore.setOwner(this,call.argument<String>("id") ?: ""); result.success(null) }
                    "clear" -> { MedicationAlarmStore.clear(this); result.success(null) }
                    "status" -> result.success(MedicationAlarmStore.status(this))
                    "refill" -> { MedicationAlarmStore.refill(this,call.argument<String>("owner") ?: "",call.argument<String>("key") ?: "",call.argument<String>("title") ?: "A-Health",call.argument<String>("body") ?: "Open A-Health");result.success(null) }
                    "enable" -> { MedicationAlarmStore.enable(this,call.argument<Boolean>("enabled")==true);result.success(MedicationAlarmStore.status(this)) }
                    "replace" -> { MedicationAlarmStore.replace(this,call.argument<String>("owner") ?: "",call.argument<List<Map<String,Any?>>>("events") ?: emptyList());result.success(MedicationAlarmStore.status(this)) }
                    "permission" -> {
                        if(android.os.Build.VERSION.SDK_INT>=33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)!=android.content.pm.PackageManager.PERMISSION_GRANTED) {
                            if(reminderPermission!=null)result.error("BUSY","Permission request active",null)
                            else { reminderPermission=result; requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS),7402) }
                        } else result.success(MedicationAlarmStore.status(this))
                    }
                    "exactSettings" -> { if(android.os.Build.VERSION.SDK_INT>=31)startActivity(Intent(android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,android.net.Uri.parse("package:$packageName")));result.success(null) }
                    "consumeOpen" -> { val open=intent.getBooleanExtra("openMedication",false);intent.removeExtra("openMedication");result.success(open) }
                    else -> result.notImplemented()
                }} catch(_:Exception) { result.error("REMINDER_UNAVAILABLE","Medication reminders unavailable",null) }
            }
        }
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "ahealth/device_actions")
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "biometricSettings" -> {
                        try {
                            val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                                Intent(Settings.ACTION_BIOMETRIC_ENROLL).putExtra(
                                    Settings.EXTRA_BIOMETRIC_AUTHENTICATORS_ALLOWED,
                                    BiometricManager.Authenticators.BIOMETRIC_WEAK
                                )
                            } else Intent(Settings.ACTION_SECURITY_SETTINGS)
                            try { startActivity(intent) }
                            catch (_: Exception) { startActivity(Intent(Settings.ACTION_SECURITY_SETTINGS)) }
                            result.success(true)
                        } catch (_: Exception) { result.error("SETTINGS_UNAVAILABLE", "Fungua Settings za simu kisha Security / Biometrics.", null) }
                    }
                    "saveReceipt" -> {
                        val bytes = call.argument<ByteArray>("bytes")
                        val name = call.argument<String>("name") ?: "A-Health-risiti.pdf"
                        if (pendingSave != null) { result.error("SAVE_BUSY", "Kamilisha kuhifadhi risiti ya kwanza.", null) }
                        else if (bytes == null || bytes.size !in 5..2_000_000 || String(bytes.copyOfRange(0, 5), Charsets.US_ASCII) != "%PDF-" || !name.matches(Regex("[A-Za-z0-9_-]{1,90}\\.pdf"))) {
                            result.error("INVALID_RECEIPT", "Risiti si PDF sahihi.", null)
                        } else {
                            pendingSave = result
                            receiptBytes = bytes
                            try {
                                startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                                    addCategory(Intent.CATEGORY_OPENABLE)
                                    type = "application/pdf"
                                    putExtra(Intent.EXTRA_TITLE, name)
                                }, 7401)
                            } catch (_: Exception) {
                                pendingSave = null; receiptBytes = null
                                result.error("SAVE_UNAVAILABLE", "Programu ya kuhifadhi faili haipatikani.", null)
                            }
                        }
                    }
                    else -> result.notImplemented()
                }
            }
    }

    override fun onRequestPermissionsResult(requestCode:Int,permissions:Array<out String>,grantResults:IntArray) {
        super.onRequestPermissionsResult(requestCode,permissions,grantResults)
        if(requestCode==7402) { reminderPermission?.success(MedicationAlarmStore.status(this));reminderPermission=null }
    }
    override fun onNewIntent(intent:Intent) {
        super.onNewIntent(intent);setIntent(intent)
        if(intent.getBooleanExtra("openMedication",false)) reminderChannel?.invokeMethod("openMedication",null)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != 7401) return
        val result = pendingSave ?: return
        val bytes = receiptBytes
        pendingSave = null; receiptBytes = null
        val uri = data?.data
        if (resultCode != Activity.RESULT_OK || uri == null || bytes == null) { result.success(false); return }
        Thread {
            try {
                val stream = contentResolver.openOutputStream(uri, "wt") ?: throw IllegalStateException()
                stream.use { it.write(bytes) }
                runOnUiThread { result.success(true) }
            } catch (_: Exception) {
                runOnUiThread { result.error("SAVE_FAILED", "Risiti haijahifadhiwa. Jaribu tena.", null) }
            }
        }.start()
    }
}
