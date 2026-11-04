# PWA manual checklist

Playwright (`tests/e2e/pwa.spec.ts`) covers the manifest, service-worker registration, and the offline shell in Chromium. It cannot install the app, keep an iOS cookie across a force-quit, or show a notched status bar. Do these on a real device over HTTPS (the dev ngrok host in `crm_frontend/next.config.mjs` `allowedDevOrigins` is enough).

## iOS Safari

1. Open `/login` in Safari (not an in-app browser).
2. Confirm the hint says Share → Add to Home Screen. Dismiss it and reload: it should stay dismissed.
3. Add to Home Screen. The icon should be the orange product mark (`apple-touch-icon.png`), not a company logo.
4. Open the installed app, sign in, then force-quit and relaunch. The session should still be signed in (httpOnly `access_token`).
5. On a notched iPhone, the status bar should not cover the top bar, and the home indicator should not cover the bottom nav.

## Android Chrome

1. Open the staff app (not `/public/...`).
2. Install from the browser menu, or from Settings → Install app if Chrome fires the prompt.
3. The launcher icon should be the product mark. Maskable cropping should not clip the glyph.
4. Turn on airplane mode and reopen the installed app. You should see “Can't reach the CRM” with Retry, not a browser error page.
5. Turn the network back on and Retry. Data should load again. The offline banner should clear.

## Desktop Chromium

1. Install from the address bar or Settings → Install app.
2. The window should not be locked to portrait.
3. Shortcuts, if the OS shows them, should open Dashboard, Leads, Jobs, and Tasks.
