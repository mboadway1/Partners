# Peggy

Organize and edit photos from Google Photos, post them to Facebook from an iPhone or iPad, and enjoy them on the TV with Peggy for Fire TV.

Peggy is a web app you add to your home screen. It runs entirely on your device: photos you import are stored in the app's private storage on that iPhone/iPad, and nothing is uploaded anywhere except Facebook, when you choose to post.

## What it does

- **Import** from Google Photos (Google's own picker opens; you choose the photos) or from the device's camera roll.
- **Organize** with albums, ★ favorites, and automatic *Not posted* / *Posted* views. Select many at once to tag, move, or delete.
- **Edit** non-destructively: crop to Facebook-friendly shapes (Square, Portrait 4:5, Wide 16:9, Story 9:16), zoom and drag to reframe, rotate, flip, brightness, contrast, saturation, warmth, and eight filters. *Revert* always gets the original back.
- **Fire TV:** show photos on the TV instantly, or copy them (with albums and edits) into the TV's own library to browse, slideshow, and edit with the remote. See [Peggy on Fire TV](#peggy-on-fire-tv).
- **Words** (🎙 in the header): counts the words each person says and who interrupts whom, with an optional **turn timer**, and shows a live scoreboard on the TV. See [Words](#words).
- **Post** one or many photos, in the order you choose. Peggy copies your caption, opens the iOS share sheet, you tap **Facebook**, paste the caption, and post. Posted photos get a ✓.

## Two limits worth knowing

1. **Facebook doesn't let any app post to a personal profile on its own.** Meta removed that in 2018. Peggy hands the finished photos to the Facebook app through the share sheet, and you tap *Post*. Facebook also ignores captions passed in by other apps, which is why Peggy puts the caption on your clipboard for you to paste.
2. **Google Photos only shares the photos you pick.** Since March 2025, apps can't browse your whole library; they get exactly what you select in Google's picker. Each import is a new pick. Peggy never changes or deletes anything in Google Photos.

---

## One-time setup (about 20 minutes)

You'll set up three free things: GitHub Pages (hosts the app), a Google Cloud OAuth client (lets the app sign in to Google Photos), and a Cloudflare Worker (a small relay — Google blocks browsers from calling Google Photos directly).

> Only want to import from the camera roll? Skip steps 2 and 3. Device import, editing, and posting work without them.

### 1. Put the app on GitHub Pages

1. Create a new repository named **Peggy** at https://github.com/new (Public is required for free GitHub Pages; the repo holds only code, never photos).
2. Push this folder:
   ```bash
   cd Peggy
   git remote add origin https://github.com/mboadway1/Peggy.git
   git push -u origin main
   ```
3. In the repo: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `(root)` → Save**.
4. After a minute the app is live at **https://mboadway1.github.io/Peggy/**

### 2. Create the Google OAuth client

1. Go to https://console.cloud.google.com/ and create a project (e.g. *Peggy*).
2. **APIs & Services → Library →** search **Google Photos Picker API → Enable**.
3. **APIs & Services → OAuth consent screen** (also called *Google Auth Platform*):
   - User type **External**, app name *Peggy*, your Gmail as support and developer contact.
   - **Data access / Scopes:** add `https://www.googleapis.com/auth/photospicker.mediaitems.readonly`.
   - **Audience / Test users:** add your Gmail address. Leave the app in **Testing** — it's just for you, so no Google review is needed.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type **Web application**
   - Authorized JavaScript origins: `https://mboadway1.github.io`
   - Authorized redirect URIs: `https://mboadway1.github.io/Peggy/`  ← trailing slash matters
5. Copy the **Client ID** (ends in `.apps.googleusercontent.com`). No client secret is used.

### 3. Deploy the relay to Cloudflare (free)

On any computer with Node.js:

```bash
cd Peggy/relay
npx wrangler login        # opens a browser to sign in / create a free Cloudflare account
npx wrangler deploy
```

It prints a URL like `https://peggy-relay.<your-subdomain>.workers.dev`. Opening it in a browser should say *Peggy relay is running.*

The relay only forwards to Google Photos hosts, only accepts requests from the origin in `wrangler.toml`, and stores nothing. Free tier: 100,000 requests/day — far more than you'll use.

*No computer handy?* In the Cloudflare dashboard: **Workers & Pages → Create → Worker**, paste `relay/worker.js` into the editor, deploy, then under **Settings → Variables** add `ALLOWED_ORIGINS` = `https://mboadway1.github.io`.

### 4. Install on iPhone / iPad

1. Open **https://mboadway1.github.io/Peggy/** in **Safari**.
2. Tap **Share → Add to Home Screen → Add**.
3. Open Peggy from the home screen, tap **⚙︎**, paste the **Client ID** and **Relay URL**, tap **Save**.
4. Tap **＋ Import → Google Photos**. Sign in to Google; since the app is in Testing, Google shows a "hasn't verified this app" notice — tap **Continue**.

Do step 3 on each device you use. Each device keeps its own library.

---

### 5. Install Peggy on the Fire TV (optional)

Same as your Words and Photos apps: Downloader and developer mode are already set up.

1. Every push that changes the TV app builds it automatically (**Actions → Build APK**) and publishes
   `https://github.com/mboadway1/Peggy/releases/download/latest/Peggy.apk`
2. Make a TinyURL for that address.
3. On the Fire TV, open **Downloader**, enter the TinyURL, then **Install → Done → Delete**. **Peggy** appears in your apps.

The TV app loads its screen from GitHub Pages each time, so updates arrive without reinstalling.

---

## Peggy on Fire TV

**Pair once.** Peggy on the TV shows a 4-letter code. In Peggy on the iPhone/iPad, tap **📺** and enter it. The phone remembers the TV and reconnects whenever you send photos. (The TV's QR code opens Peggy in Safari already paired. That's handy for a quick show, but Safari keeps a separate library from the home-screen app.)

**From the phone:** Select photos → **📺 TV**:
- **Show on TV now** — an instant slideshow of the edited photos; the phone becomes a remote (⏮ ⏯ ⏭ ⏹). Nothing is saved on the TV.
- **Copy to TV** — saves the photos in the TV's library with their albums, favorites, and edits. Copying the same photo again updates it instead of making a duplicate.

**On the TV, with the remote:**

| Button | Does |
|---|---|
| ◀ ▶ ▲ ▼ / OK | Move and select |
| Back | Close what's open; on the home screen, exit Peggy |
| ⏯ Play/Pause | Start a slideshow from the photo you're viewing, or pause one |
| ⏪ ⏩ | Previous / next photo |

- **Home:** ▶ Slideshow, filters for All, ★ Favorites and each album (select an album twice for rename, delete, or album slideshow), 📱 Connect phone, ⚙ Settings.
- **Photo:** ◀ ▶ to browse; OK for Slideshow from here, Favorite, Edit, Albums, Delete.
- **Edit:** rotate, flip, shape, zoom, *Reframe crop* (arrows move the crop), filter, brightness, contrast, saturation, warmth. Use ◀ ▶ on a setting to change it, then **Save**.
- **Settings:** slideshow speed (5–60 s), Newest first or Shuffle, gentle zoom on/off, storage used, delete everything on the TV.

Importing from Google Photos happens on the phone, because Google doesn't allow its sign-in inside TV apps. Import there, then **Copy to TV**. Photos copied to the TV stay viewable even if the Wi-Fi drops; the phone link reconnects on its own.

---

## Words

Tap **🎙** in Peggy's header (‹ Photos goes back). The iPhone listens and transcribes; you tap who's talking (or press ◀ ▶ on the Fire remote). Speaker names, language and timer choices are remembered.

**Turn timer.** Choose how long each turn gets (30 s – 5 min) and what happens when time is up:
- Each change of speaker starts that person's countdown, on the phone and on the TV. The clock runs only while listening.
- Switching speakers before their time is up always counts as an interruption, tallied as **on the clock**. The TV flashes who cut in and how much time was left, and the phone offers **↩ Give the floor back**, which returns the turn with the remaining time.
- When time runs out the TV chimes. **Keep going** shows overtime (+0:12); **Pass to next person** moves to the next speaker automatically, without counting an interruption.
- **↺ Restart turn** resets the current speaker's clock.

Without the timer, a switch counts as an interruption when someone is mid-sentence or spoke within the last second (adjustable in Settings).

**On the TV**, Peggy switches to the scoreboard as soon as you start listening. Back returns to photos (it won't pop up again until you stop and start listening), and **🎙 Words** on the TV's home screen brings it back. Words uses the same TV code as photos.

Transcript: **Copy** or **Save .txt** (includes the per-person totals and timer setting).

---

## Everyday use

| To… | Do this |
|---|---|
| Import | **＋ Import → Google Photos**, tap **Open Google Photos**, select, tap **Done**, switch back to Peggy |
| Edit | Tap a photo. **Crop / Adjust / Filters** tabs; drag the photo to reframe. **Save** |
| Organize | **Select**, tap photos, then **★**, **Album**, or **More** (remove from album, mark posted, delete) |
| Album options | Tap an album's chip while it's already selected → rename / delete |
| Post | **Select** photos → **Post** → reorder with ◀, type a caption → **Share to Facebook** → pick **Facebook** → long-press the text box → **Paste** → **Post** |
| Save an edited copy to Camera Roll | Select → **More → Save to device / share…** → **Save Images** |

## Good to know

- **Storage:** photos live in the app's storage on the device (imported at up to 2560px on the long edge). iOS keeps home-screen web apps' data, but it isn't backed up by iCloud — your originals stay safe in Google Photos. Settings shows how much space Peggy uses.
- **Exports** are JPEGs up to 2048px on the long edge, which is Facebook's own maximum for photos.
- **Videos** in a Google Photos selection are skipped; Peggy handles photos only.
- **Google sign-in** lasts about an hour; after that, Import just asks you to sign in again.

## Files

```
index.html      the phone/tablet app (UI, editor, storage, Google + share + TV logic)
tv.html         the Fire TV screen (library, slideshow, remote-control editor)
core.js         shared photo editing engine and storage used by both
words.html      Words: listener, speaker pad, turn timer, transcript
words-version.js  Words message version shared by words.html and tv.html (bump when they change how they talk)
sw.js           lets the app open offline
manifest.json   home-screen app settings
icon-*.png      app icons
relay/          Cloudflare Worker relay (worker.js + wrangler.toml)
app/            Fire TV app shell (Android, com.peggy.tv); built by .github/workflows/build.yml
```
