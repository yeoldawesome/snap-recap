# 🎞️ Snap Recap

Turn your Snapchat Memories export into a **slideshow** or a **video recap**, sorted by date, with the date shown under every photo and clip.

- **Private.** Everything runs in your browser. Your photos are never uploaded anywhere.
- **Shirtless filter.** Photos and videos where a bare stomach/abs or chest is visible are hidden automatically. You can pick Strict, Balanced or Relaxed, or turn the filter off.
- **Custom run time.** Set seconds per photo, or fit the whole slideshow into a total number of minutes. For videos, cap the length of each clip and/or the total run time.
- **Filter by year**, play oldest or newest first, and press `H` to hide anything the filter missed.

## Use it

1. In Snapchat: **Settings → My Data**, select **Memories**, and submit the request.
2. When the email arrives, download **all** the zip files.
3. Open Snap Recap and drop all the zips in at once.

The first time you load an export, every photo and video is checked by the filter, so large exports take a few minutes. Results are remembered in your browser, so the next time is fast. Anything that hasn't been checked yet stays hidden until it has been.

**Player keys:** `Space` pause · `←` `→` previous/next · `H` hide forever · `F` fullscreen · `Esc` close

## Run it locally

Requires [Node.js](https://nodejs.org) 18 or newer.

```bash
npm install
npm run dev
```

Then open the URL it prints. To make a production build in `dist/`, run `npm run build`.

## Put it on GitHub Pages

1. Push this repo to GitHub.
2. Go to **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Every push to `main` deploys the site to `https://<your-username>.github.io/<repo-name>/`.

## How it works

- Zips are read in the browser with [zip.js](https://github.com/gildas-lormeau/zip.js). Files are only unpacked when they're needed. Both the current export format and the older format (one zip per memory, with a caption overlay) are supported, and caption/sticker overlays are drawn on top of the photo or video.
- Dates come from Snapchat's file names (`2023-06-01_…`), with the time of day taken from the zip.
- The shirtless filter is [NudeNet](https://github.com/notAI-tech/NudeNet) (MIT license, see `public/models/NUDENET_LICENSE.txt`), running through [onnxruntime-web](https://onnxruntime.ai). A memory is hidden when the model detects `BELLY_EXPOSED` or `MALE_BREAST_EXPOSED` above the chosen strictness. Videos are checked at 5 points spread across the clip.
- Some iPhone videos (HEVC `.mov`) can't play in every browser. Those clips are skipped automatically.

## License

MIT
