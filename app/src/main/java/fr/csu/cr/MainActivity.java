package fr.csu.cr;

import android.Manifest;
import android.app.Activity;
import android.app.Dialog;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.os.CancellationSignal;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.Display;
import android.view.WindowManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.content.FileProvider;
import androidx.webkit.WebViewAssetLoader;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {
    private static final int REQ_FILE = 10;
    private static final int REQ_PERM = 11;
    private WebView web;
    private ValueCallback<Uri[]> fileCb;
    private Uri cameraUri;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        web = new WebView(this);
        setContentView(web);
        pleinEcran();
        enableHighRefreshRate();

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setGeolocationEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);

        web.addJavascriptInterface(new Bridge(), "Android");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                return loader.shouldInterceptRequest(r.getUrl());
            }
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if ("appassets.androidplatform.net".equals(u.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) {}
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb) {
                ensurePerms(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION);
                cb.invoke(origin, true, true);
            }
            @Override
            public void onPermissionRequest(PermissionRequest req) {
                ensurePerms(Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA);
                runOnUiThread(() -> req.grant(req.getResources()));
            }
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = cb;
                String accept = p.getAcceptTypes().length > 0 ? String.join(",", p.getAcceptTypes()) : "";
                Intent intent;
                cameraUri = null;
                if (p.isCaptureEnabled() && accept.startsWith("image")) {
                    ensurePerms(Manifest.permission.CAMERA);
                    try {
                        File f = new File(getCacheDir(), "photo_" + System.currentTimeMillis() + ".jpg");
                        cameraUri = FileProvider.getUriForFile(MainActivity.this, "fr.csu.cr.files", f);
                        intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                        intent.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
                        intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    } catch (Exception e) { intent = p.createIntent(); }
                } else if (p.isCaptureEnabled() && accept.startsWith("video")) {
                    ensurePerms(Manifest.permission.CAMERA);
                    intent = new Intent(MediaStore.ACTION_VIDEO_CAPTURE);
                } else if (accept.contains("image") || accept.contains("video")) {
                    intent = new Intent(Intent.ACTION_GET_CONTENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("*/*");
                    intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/*", "video/*"});
                } else {
                    intent = new Intent(Intent.ACTION_GET_CONTENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("*/*");
                }
                try { startActivityForResult(intent, REQ_FILE); }
                catch (Exception e) { fileCb.onReceiveValue(null); fileCb = null; return false; }
                return true;
            }
        });

        ensurePerms(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.CAMERA,
                Manifest.permission.RECORD_AUDIO,
                Build.VERSION.SDK_INT >= 33 ? Manifest.permission.POST_NOTIFICATIONS : Manifest.permission.CAMERA);
        ReminderReceiver.createChannel(this);

        web.loadUrl("https://appassets.androidplatform.net/assets/www/index.html");
    }

    /** Demande le taux de rafraîchissement le plus élevé (120 Hz si l'écran le permet). */
    private void enableHighRefreshRate() {
        try {
            Display d = Build.VERSION.SDK_INT >= 30 ? getDisplay() : getWindowManager().getDefaultDisplay();
            if (d == null) return;
            Display.Mode cur = d.getMode(), best = cur;
            for (Display.Mode m : d.getSupportedModes()) {
                if (m.getPhysicalWidth() == cur.getPhysicalWidth() && m.getPhysicalHeight() == cur.getPhysicalHeight()
                        && m.getRefreshRate() > best.getRefreshRate()) best = m;
            }
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.preferredDisplayModeId = best.getModeId();
            lp.preferredRefreshRate = best.getRefreshRate();
            getWindow().setAttributes(lp);
        } catch (Exception ignored) {}
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) { enableHighRefreshRate(); pleinEcran(); }
    }

    private void ensurePerms(String... perms) {
        List<String> need = new ArrayList<>();
        for (String p : perms) if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED && !need.contains(p)) need.add(p);
        if (!need.isEmpty()) runOnUiThread(() -> { ext = true; requestPermissions(need.toArray(new String[0]), REQ_PERM); });
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req != REQ_FILE || fileCb == null) return;
        Uri[] out = null;
        if (res == RESULT_OK) {
            if (data != null && data.getData() != null) out = new Uri[]{data.getData()};
            else if (data != null && data.getClipData() != null) {
                ClipData c = data.getClipData();
                out = new Uri[c.getItemCount()];
                for (int i = 0; i < c.getItemCount(); i++) out[i] = c.getItemAt(i).getUri();
            } else if (cameraUri != null) out = new Uri[]{cameraUri};
        }
        fileCb.onReceiveValue(out);
        fileCb = null;
    }

    /** Vrai quand l'appli ouvre elle-même une autre fenêtre (appareil photo, partage, impression…) :
     *  au retour, on ne reverrouille pas. */
    private boolean ext = false;

    @Override
    public void startActivityForResult(Intent intent, int requestCode, Bundle options) {
        ext = true;
        super.startActivityForResult(intent, requestCode, options);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.evaluateJavascript("window.__pause && window.__pause()", null);
    }

    @Override
    protected void onResume() {
        super.onResume();
        final boolean skip = ext; ext = false;
        if (web != null) web.evaluateJavascript("window.__resume && window.__resume(" + skip + ")", null);
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.__back && window.__back()", v -> {
            if (!"true".equals(v)) MainActivity.super.onBackPressed();
        });
    }

    private class Bridge {
        @JavascriptInterface
        public void shareFile(String name, String mime, String b64, String subject, String text, String email) {
            try {
                File dir = new File(getCacheDir(), "export");
                dir.mkdirs();
                File f = new File(dir, name);
                try (FileOutputStream o = new FileOutputStream(f)) { o.write(Base64.decode(b64, Base64.DEFAULT)); }
                Uri u = FileProvider.getUriForFile(MainActivity.this, "fr.csu.cr.files", f);
                Intent i = new Intent(Intent.ACTION_SEND);
                i.setType(mime);
                i.putExtra(Intent.EXTRA_STREAM, u);
                i.putExtra(Intent.EXTRA_SUBJECT, subject);
                if (text != null && !text.isEmpty()) i.putExtra(Intent.EXTRA_TEXT, text);
                if (email != null && !email.isEmpty()) i.putExtra(Intent.EXTRA_EMAIL, new String[]{email});
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                startActivity(Intent.createChooser(i, "Partager / enregistrer"));
            } catch (Exception e) { e.printStackTrace(); }
        }

        @JavascriptInterface
        public void sendEmail(String to, String subject, String body) {
            Intent i = new Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:"));
            if (to != null && !to.isEmpty()) i.putExtra(Intent.EXTRA_EMAIL, new String[]{to});
            i.putExtra(Intent.EXTRA_SUBJECT, subject);
            i.putExtra(Intent.EXTRA_TEXT, body);
            try { startActivity(i); } catch (Exception e) {
                Intent s = new Intent(Intent.ACTION_SEND);
                s.setType("text/plain");
                s.putExtra(Intent.EXTRA_SUBJECT, subject);
                s.putExtra(Intent.EXTRA_TEXT, body);
                startActivity(Intent.createChooser(s, "Envoyer"));
            }
        }

        @JavascriptInterface
        public void ocr(String id, String b64) {
            try {
                byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
                Bitmap bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
                if (bmp == null) { ocrResult(id, ""); return; }
                if (recognizer == null) recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
                recognizer.process(InputImage.fromBitmap(bmp, 0))
                        .addOnSuccessListener(t -> ocrResult(id, t.getText()))
                        .addOnFailureListener(e -> ocrResult(id, ""));
            } catch (Exception e) { ocrResult(id, ""); }
        }

        @JavascriptInterface
        public void setSecure(boolean on) {
            runOnUiThread(() -> {
                if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
            });
        }

        @JavascriptInterface
        public boolean canBiometric() {
            if (Build.VERSION.SDK_INT >= 29) {
                BiometricManager bm = getSystemService(BiometricManager.class);
                return bm != null && bm.canAuthenticate() == BiometricManager.BIOMETRIC_SUCCESS;
            }
            return Build.VERSION.SDK_INT >= 28 && getPackageManager().hasSystemFeature(PackageManager.FEATURE_FINGERPRINT);
        }

        @JavascriptInterface
        public void biometric(String title) {
            if (Build.VERSION.SDK_INT < 28) { bioResult(false); return; }
            ext = true;
            runOnUiThread(() -> {
                try {
                    BiometricPrompt bp = new BiometricPrompt.Builder(MainActivity.this)
                            .setTitle(title)
                            .setSubtitle("Touchez le capteur d'empreinte")
                            .setNegativeButton("Utiliser le code", getMainExecutor(), (d, w) -> bioResult(false))
                            .build();
                    bp.authenticate(new CancellationSignal(), getMainExecutor(), new BiometricPrompt.AuthenticationCallback() {
                        @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult r) { bioResult(true); }
                        @Override public void onAuthenticationError(int code, CharSequence msg) { bioResult(false); }
                    });
                } catch (Exception e) { bioResult(false); }
            });
        }

        @JavascriptInterface
        public void previewPdf(String html, String jobName) {
            runOnUiThread(() -> showPreview(html, jobName));
        }

        @JavascriptInterface
        public void printPdf(String html, String jobName) {
            runOnUiThread(() -> {
                WebView pv = new WebView(MainActivity.this);
                pv.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView v, String url) {
                        PrintManager pm = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                        ext = true; pm.print(jobName, v.createPrintDocumentAdapter(jobName),
                                new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build());
                    }
                });
                pv.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
                printViews.add(pv);
            });
        }

        @JavascriptInterface
        public void scheduleReminder(String id, double at, String title, String text) {
            SharedPreferences sp = getSharedPreferences("reminders", MODE_PRIVATE);
            sp.edit().putString(id, (long) at + "|" + title + "|" + text).apply();
            ReminderReceiver.schedule(MainActivity.this, id, (long) at, title, text);
        }

        @JavascriptInterface
        public void cancelReminder(String id) {
            getSharedPreferences("reminders", MODE_PRIVATE).edit().remove(id).apply();
            AlarmManager am = (AlarmManager) getSystemService(ALARM_SERVICE);
            am.cancel(ReminderReceiver.pending(MainActivity.this, id, "", ""));
        }
    }

    private TextRecognizer recognizer;

    private void bioResult(boolean ok) {
        runOnUiThread(() -> web.evaluateJavascript("window.__bio && window.__bio(" + ok + ")", null));
    }

    private int dp(float v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    private Button barBtn(String txt, int bg) {
        Button b = new Button(this);
        b.setText(txt); b.setAllCaps(false); b.setTextColor(Color.WHITE); b.setTextSize(15);
        GradientDrawable d = new GradientDrawable(); d.setColor(bg); d.setCornerRadius(dp(10));
        b.setBackground(d); b.setMinWidth(0); b.setMinimumWidth(0); b.setMinHeight(0); b.setMinimumHeight(0);
        b.setPadding(dp(12), dp(8), dp(12), dp(8));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(dp(4), 0, dp(4), 0); b.setLayoutParams(lp);
        return b;
    }

    /** Aperçu du PDF dans l'appli, avec zoom (pincer ou boutons − / +), avant enregistrement. */
    private void showPreview(String html, String jobName) {
        Dialog dlg = new Dialog(this, android.R.style.Theme_Black_NoTitleBar_Fullscreen);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.parseColor("#2a2c2e"));

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(8), dp(10), dp(8), dp(10));

        Button close = barBtn("✕", Color.parseColor("#48484a"));
        TextView title = new TextView(this);
        title.setText("Aperçu"); title.setTextColor(Color.WHITE); title.setTextSize(17);
        title.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        title.setPadding(dp(8), 0, 0, 0);
        Button minus = barBtn("−", Color.parseColor("#48484a"));
        Button plus = barBtn("+", Color.parseColor("#48484a"));
        Button save = barBtn("Enregistrer PDF", Color.parseColor("#2f7cf6"));
        bar.addView(close); bar.addView(title); bar.addView(minus); bar.addView(plus); bar.addView(save);

        WebView pv = new WebView(this);
        WebSettings ws = pv.getSettings();
        ws.setSupportZoom(true);
        ws.setBuiltInZoomControls(true);
        ws.setDisplayZoomControls(false);
        ws.setUseWideViewPort(true);
        ws.setLoadWithOverviewMode(true);
        pv.setBackgroundColor(Color.parseColor("#8a8f96"));
        pv.setLayoutParams(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        pv.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);

        root.addView(bar); root.addView(pv);
        dlg.setContentView(root);

        close.setOnClickListener(v -> dlg.dismiss());
        minus.setOnClickListener(v -> pv.zoomOut());
        plus.setOnClickListener(v -> pv.zoomIn());
        save.setOnClickListener(v -> {
            PrintManager pm = (PrintManager) getSystemService(Context.PRINT_SERVICE);
            ext = true; pm.print(jobName, pv.createPrintDocumentAdapter(jobName),
                    new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build());
        });
        dlg.setOnDismissListener(d -> pv.destroy());
        dlg.show();
    }

    private void ocrResult(String id, String text) {
        final String js = "window.__ocr && window.__ocr(" + JSONObject.quote(id) + "," + JSONObject.quote(text == null ? "" : text) + ")";
        runOnUiThread(() -> web.evaluateJavascript(js, null));
    }

    private final List<WebView> printViews = new ArrayList<>();

    // Plein écran immersif : barres d'état et de navigation masquées (glisser depuis le bord pour les afficher).
    private void pleinEcran() {
        android.view.Window w = getWindow();
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            android.view.WindowInsetsController c = w.getInsetsController();
            if (c != null) {
                c.hide(android.view.WindowInsets.Type.statusBars() | android.view.WindowInsets.Type.navigationBars());
                c.setSystemBarsBehavior(android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            w.getDecorView().setSystemUiVisibility(android.view.View.SYSTEM_UI_FLAG_FULLSCREEN
                    | android.view.View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | android.view.View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        }
    }
}
