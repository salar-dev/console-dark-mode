# Chrome Web Store listing — paste-ready

Everything the Developer Dashboard asks for, in the order of its tabs.
Repository: https://github.com/salar-dev/console-dark-mode · Website: https://salar-dev.github.io/console-dark-mode/
Chrome Web Store listing (approved 6 November 2026): https://chromewebstore.google.com/detail/dark-mode-for-play-consol/onhgocpclfamcmeemabpammbldjncaae

## Package

- Upload: `dist/console-dark-mode-v1.0.0.zip` (build with `./scripts/build.sh`)

## Store listing tab

**Title** (from the manifest)

    Dark Mode for Play Console & App Store Connect

**Summary** (from the manifest, 124 / 132 characters)

    A carefully crafted dark theme for Google Play Console and App Store Connect. Toggle per site. Never touches other websites.

**Description**

```
A carefully crafted dark theme for the two developer consoles you spend your days in: Google Play Console and App Store Connect. Nothing else is touched.

WHAT YOU GET
• A real dark theme, not an inverted page. Colours are remapped from the consoles' own stylesheets, so tables, charts, dialogs, status chips and illustrations stay readable and on-brand.
• No white flash. The theme is applied before the first paint, including on cold reloads and heavy pages such as statistics, financial reports and App Analytics.
• One switch per console. Turn Play Console or App Store Connect off independently, or everything at once from the toolbar popup.
• Keyboard shortcut. Alt+Shift+D toggles dark mode on the current console and restores the page instantly.
• Follow system appearance. Optionally go dark only while your OS is in dark mode.
• Your settings sync with your Chrome profile.

PRIVACY
• Runs only on play.google.com/console and appstoreconnect.apple.com.
• Collects nothing and sends nothing: no analytics, no remote code, no third-party scripts. The only stored data is your three toggles.
• Open source: https://github.com/salar-dev/console-dark-mode

Not affiliated with or endorsed by Google or Apple. Google Play and App Store Connect are trademarks of their respective owners.
```

**Category**: Developer Tools
**Language**: English

**Store icon**: `extension/icons/icon128.png` (128×128, transparent margin)

**Screenshots** (1280×800, 24-bit PNG, upload in this order) — `assets/store/screenshots/`

| File | What it shows |
|---|---|
| `01-before-after.png` | The same Play Console page, light vs. dark |
| `02-play-console-dashboard.png` | An app dashboard in dark mode |
| `03-app-store-connect-apps.png` | App Store Connect apps list in dark mode |
| `04-popup.png` | The popup: one switch per console |
| `05-play-console-home.png` | Play Console home / all apps |
| `extra-app-store-connect-app.png` | Spare: an App Store Connect app page (the store takes five) |

All console captures show fictional app names, icons, account details and numbers
(see `scripts/store/anon.js`); only the UI is real.

**Small promo tile** (440×280): `assets/store/promo-small.png`
**Marquee promo tile** (1400×560): `assets/store/promo-marquee.png`

**Official URL / Homepage**: `https://salar-dev.github.io/console-dark-mode/`
**Support URL**: `https://github.com/salar-dev/console-dark-mode/issues`

## Privacy practices tab

**Single purpose description**

    Applies a dark colour theme to Google Play Console and App Store Connect, with a switch for each console.

**Permission justification — `storage`**

    Stores the user's three preferences (master switch, per-console switches, "follow system appearance") and keeps them in sync across the user's own Chrome profiles through chrome.storage.sync. Nothing else is stored.

**Host permission justification — `https://play.google.com/console*`, `https://appstoreconnect.apple.com/*`**

    The extension's only function is to restyle these two developer consoles. Host access is needed to inject the dark stylesheet at document_start (so there is no white flash), to read the pages' own stylesheets in order to remap their colours accurately, and to turn the theme on and off from the popup or the keyboard shortcut. No other sites are matched or affected. Page content, form fields and account data are never read or transmitted.

**Are you using remote code?** No. All code ships inside the package; no remote scripts, CSS or eval'd code.

**Data usage**: leave every data type unchecked (the extension collects no user data).
Certify all three statements (no selling of data, no use for unrelated purposes, no use for creditworthiness or lending).

**Privacy policy URL**: `https://salar-dev.github.io/console-dark-mode/privacy.html`

## Distribution tab

- Visibility: Public
- Regions: all
- Pricing: free

## GitHub repository and website

1. Create the public repository `salar-dev/console-dark-mode` and push this project
   (`dist/`, raw captures and e2e output are ignored by `.gitignore`).
2. Enable GitHub Pages: *Settings → Pages → Deploy from a branch → `main` / `/docs`*.
   The site appears at https://salar-dev.github.io/console-dark-mode/ within a minute or two; the privacy policy is
   `https://salar-dev.github.io/console-dark-mode/privacy.html`.
3. The Chrome Web Store URL is set in the `data-store-url` attribute on `<html>` in
   `docs/index.html` and on every "Add to Chrome" button; change it there if the
   listing ever moves.
