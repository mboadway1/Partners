package com.partners.tv;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * Partners for Fire TV. The TV screen itself lives on GitHub Pages so it updates
 * without reinstalling; this shell runs it full screen, keeps the screen on,
 * and hands remote-control buttons (Back, Play/Pause, Rewind, Fast-forward,
 * Menu) to the page. Photos are stored in the page's own storage on the TV.
 */
public class MainActivity extends Activity {

    private static final String TV_URL = "https://mboadway1.github.io/Partners/tv.html";

    private WebView web;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean showingError = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(42, 18, 48));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);

        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showOffline();
            }
        });

        setContentView(web);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        web.requestFocus();
        load();
    }

    private void load() {
        showingError = false;
        web.loadUrl(TV_URL);
    }

    private void showOffline() {
        showingError = true;
        String html = "<html><body style='margin:0;background:#2A1230;color:#FFEAF3;font-family:sans-serif;"
                + "display:flex;align-items:center;justify-content:center;height:100vh;text-align:center'>"
                + "<div><h1 style='font-size:3vw'>Partners can't reach the internet</h1>"
                + "<p style='font-size:1.8vw;color:#D9AECB'>Check the Fire TV's Wi-Fi. Retrying in 10 seconds.</p></div></body></html>";
        web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
        handler.postDelayed(() -> { if (showingError) load(); }, 10000);
    }

    private void sendKey(String name) {
        web.evaluateJavascript("window.partnersKey && window.partnersKey('" + name + "')", null);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int code = event.getKeyCode();
        String media = null;
        switch (code) {
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
            case KeyEvent.KEYCODE_MEDIA_PLAY:
            case KeyEvent.KEYCODE_MEDIA_PAUSE: media = "play"; break;
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD:
            case KeyEvent.KEYCODE_MEDIA_NEXT: media = "ff"; break;
            case KeyEvent.KEYCODE_MEDIA_REWIND:
            case KeyEvent.KEYCODE_MEDIA_PREVIOUS: media = "rew"; break;
            case KeyEvent.KEYCODE_MENU: media = "menu"; break;
        }
        if (media != null) {
            if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) sendKey(media);
            return true;
        }
        if (code == KeyEvent.KEYCODE_BACK) {
            if (event.getAction() == KeyEvent.ACTION_UP) {
                if (showingError) { finish(); return true; }
                // Let the page close whatever is open; leave the app only from the home screen.
                web.evaluateJavascript("(window.partnersBack && window.partnersBack()) ? 'y' : 'n'", value -> {
                    if (value == null || !value.contains("y")) finish();
                });
            }
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
