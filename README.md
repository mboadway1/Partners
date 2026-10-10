# PhotoPost

Organize and edit photos from Google Photos, then post them to Facebook — from an iPhone or iPad.

PhotoPost is a web app you add to your home screen. It runs entirely on your device: photos you import are stored in the app's private storage on that iPhone/iPad, and nothing is uploaded anywhere except Facebook, when you choose to post.

## What it does

- **Import** from Google Photos (Google's own picker opens; you choose the photos) or from the device's camera roll.
- **Organize** with albums, ★ favorites, and automatic *Not posted* / *Posted* views. Select many at once to tag, move, or delete.
- **Edit** non-destructively: crop to Facebook-friendly shapes (Square, Portrait 4:5, Wide 16:9, Story 9:16), zoom and drag to reframe, rotate, flip, brightness, contrast, saturation, warmth, and eight filters. *Revert* always gets the original back.
- **Post** one or many photos, in the order you choose. PhotoPost copies your caption, opens the iOS share sheet, you tap **Facebook**, paste the caption, and post. Posted photos get a ✓.

## Two limits worth knowing

1. **Facebook doesn't let any app post to a personal profile on its own.** Meta removed that in 2018. PhotoPost hands the finished photos to the Facebook app through the share sheet, and you tap *Post*. Facebook also ignores captions passed in by other apps, which is why PhotoPost puts the caption on your clipboard for you to paste.
2. **Google Photos only shares the photos you pick.** Since March 2025, apps can't browse your whole library; they get exactly what you select in Google's picker. Each import is a new pick. PhotoPost never changes or deletes anything in Google Photos.

---

## One-time setup (about 20 minutes)

You'll set up three free things: GitHub Pages (hosts the app), a Google Cloud OAuth client (lets the app sign in to Google Photos), and a Cloudflare Worker (a small relay — Google blocks browsers from calling Google Photos directly).

> Only want to import from the camera roll? Skip steps 2 and 3. Device import, editing, and posting work without them.

### 1. Put the app on GitHub Pages

1. Create a new repository named **PhotoPost** at https://github.com/new (Public is required for free GitHub Pages; the repo holds only code, never photos).
2. Push this folder:
   ```bash
   cd PhotoPost
   git remote add origin https://github.com/mboadway1/PhotoPost.git
   git push -u origin main
   ```
3. In the repo: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `(root)` → Save**.
4. After a minute the app is live at **https://mboadway1.github.io/PhotoPost/**

### 2. Create the Google OAuth client

1. Go to https://console.cloud.google.com/ and create a project (e.g. *PhotoPost*).
2. **APIs & Services → Library →** search **Google Photos Picker API → Enable**.
3. **APIs & Services → OAuth consent screen** (also called *Google Auth Platform*):
   - User type **External**, app name *PhotoPost*, your Gmail as support and developer contact.
   - **Data access / Scopes:** add `https://www.googleapis.com/auth/photospicker.mediaitems.readonly`.
   - **Audience / Test users:** add your Gmail address. Leave the app in **Testing** — it's just for you, so no Google review is needed.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type **Web application**
   - Authorized JavaScript origins: `https://mboadway1.github.io`
   - Authorized redirect URIs: `https://mboadway1.github.io/PhotoPost/`  ← trailing slash matters
5. Copy the **Client ID** (ends in `.apps.googleusercontent.com`). No client secret is used.

### 3. Deploy the relay to Cloudflare (free)

On any computer with Node.js:

```bash
cd PhotoPost/relay
npx wrangler login        # opens a browser to sign in / create a free Cloudflare account
npx wrangler deploy
```

It prints a URL like `https://photopost-relay.<your-subdomain>.workers.dev`. Opening it in a browser should say *PhotoPost relay is running.*

The relay only forwards to Google Photos hosts, only accepts requests from the origin in `wrangler.toml`, and stores nothing. Free tier: 100,000 requests/day — far more than you'll use.

*No computer handy?* In the Cloudflare dashboard: **Workers & Pages → Create → Worker**, paste `relay/worker.js` into the editor, deploy, then under **Settings → Variables** add `ALLOWED_ORIGINS` = `https://mboadway1.github.io`.

### 4. Install on iPhone / iPad

1. Open **https://mboadway1.github.io/PhotoPost/** in **Safari**.
2. Tap **Share → Add to Home Screen → Add**.
3. Open PhotoPost from the home screen, tap **⚙︎**, paste the **Client ID** and **Relay URL**, tap **Save**.
4. Tap **＋ Import → Google Photos**. Sign in to Google; since the app is in Testing, Google shows a "hasn't verified this app" notice — tap **Continue**.

Do step 3 on each device you use. Each device keeps its own library.

---

## Everyday use

| To… | Do this |
|---|---|
| Import | **＋ Import → Google Photos**, tap **Open Google Photos**, select, tap **Done**, switch back to PhotoPost |
| Edit | Tap a photo. **Crop / Adjust / Filters** tabs; drag the photo to reframe. **Save** |
| Organize | **Select**, tap photos, then **★**, **Album**, or **More** (remove from album, mark posted, delete) |
| Album options | Tap an album's chip while it's already selected → rename / delete |
| Post | **Select** photos → **Post** → reorder with ◀, type a caption → **Share to Facebook** → pick **Facebook** → long-press the text box → **Paste** → **Post** |
| Save an edited copy to Camera Roll | Select → **More → Save to device / share…** → **Save Images** |

## Good to know

- **Storage:** photos live in the app's storage on the device (imported at up to 2560px on the long edge). iOS keeps home-screen web apps' data, but it isn't backed up by iCloud — your originals stay safe in Google Photos. Settings shows how much space PhotoPost uses.
- **Exports** are JPEGs up to 2048px on the long edge, which is Facebook's own maximum for photos.
- **Videos** in a Google Photos selection are skipped; PhotoPost handles photos only.
- **Google sign-in** lasts about an hour; after that, Import just asks you to sign in again.

## Files

```
index.html      the whole app (UI, editor, storage, Google + share logic)
sw.js           lets the app open offline
manifest.json   home-screen app settings
icon-*.png      app icons
relay/          Cloudflare Worker relay (worker.js + wrangler.toml)
```
