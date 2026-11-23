package fr.csu.cr;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;

import java.util.Map;

public class ReminderReceiver extends BroadcastReceiver {
    static final String CH = "rappels";
    static final String ACTION = "fr.csu.cr.REMINDER";

    static void createChannel(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        NotificationChannel ch = new NotificationChannel(CH, "Rappels", NotificationManager.IMPORTANCE_HIGH);
        nm.createNotificationChannel(ch);
    }

    static PendingIntent pending(Context c, String id, String title, String text) {
        Intent i = new Intent(c, ReminderReceiver.class);
        i.setAction(ACTION);
        i.setData(Uri.parse("crcsu://rappel/" + id));
        i.putExtra("id", id);
        i.putExtra("title", title);
        i.putExtra("text", text);
        return PendingIntent.getBroadcast(c, id.hashCode(), i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void schedule(Context c, String id, long at, String title, String text) {
        if (at <= System.currentTimeMillis()) return;
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = pending(c, id, title, text);
        try {
            if (android.os.Build.VERSION.SDK_INT >= 31 && !am.canScheduleExactAlarms())
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            else
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        } catch (SecurityException e) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        }
    }

    @Override
    public void onReceive(Context c, Intent intent) {
        SharedPreferences sp = c.getSharedPreferences("reminders", Context.MODE_PRIVATE);
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            for (Map.Entry<String, ?> e : sp.getAll().entrySet()) {
                String[] p = String.valueOf(e.getValue()).split("\\|", 3);
                if (p.length == 3) schedule(c, e.getKey(), Long.parseLong(p[0]), p[1], p[2]);
            }
            return;
        }
        String id = intent.getStringExtra("id");
        if (id != null) sp.edit().remove(id).apply();
        createChannel(c);
        Intent open = new Intent(c, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(c, 0, open, PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(c, CH)
                .setSmallIcon(android.R.drawable.ic_popup_reminder)
                .setContentTitle(intent.getStringExtra("title"))
                .setContentText(intent.getStringExtra("text"))
                .setAutoCancel(true)
                .setContentIntent(pi)
                .build();
        c.getSystemService(NotificationManager.class).notify(id == null ? 1 : id.hashCode(), n);
    }
}
