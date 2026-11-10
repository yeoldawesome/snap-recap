# 🎞️ Snap Recap

Turn your Snapchat Memories export into a **slideshow** or a **video recap**, sorted by date, with the date shown under every photo and clip.

- **Private.** Everything runs in your browser. Your photos are never uploaded anywhere.
- **Custom run time.** Set seconds per photo, or fit the whole slideshow into a total number of minutes. For videos, cap the length of each clip and/or the total run time.
- **Playback settings.** The ⚙ button in the slideshow and the video recap opens settings for each one separately: transition style (crossfade, fade to black, slide, zoom, none) and length, timing, slow zoom, blurred background, captions, date, progress bar, looping, and for videos the volume and playback speed.
- **Face align.** A separate page that finds the face in every photo and moves, turns and resizes each one so the eyes line up in the same spot, then plays them as a flipbook. Pick a different face in group photos, mark the eyes by hand when none is found, and save the result as MP4, WebM or GIF, choosing the size (480p to 4K), frame rate and quality, with a preview before and after. Set **Who** to **One person** and click a few photos of someone to keep only the photos they're in, lined up on their face.
- **Filter by year**, play oldest or newest first, and press `H` to hide anything you don't want in your recaps.

## Use it

1. In Snapchat: **Settings → My Data**, select **Memories**, and submit the request.
2. When the email arrives, download **all** the zip files.
3. Open Snap Recap and drop all the zips in at once.

Snap Recap remembers your zips, so refreshing or coming back later doesn't mean uploading them again. In Chrome and Edge it keeps a pointer to the files on your disk (you may be asked to click **Reopen my memories** once to allow access again). In other browsers it saves a copy in the browser's storage on your device. **Start over** forgets them.

**Player keys:** `Space` pause · `←` `→` previous/next · `H` hide forever · `F` fullscreen · `S` settings · `Esc` close

## Run it locally

Requires [Node.js](https://nodejs.org) 18 or newer.

```bash
npm install
npm run dev
```

Then open the URL it prints. To make a production build in `dist/`, run `npm run build`.


## How it works

- Zips are read in the browser with [zip.js](https://github.com/gildas-lormeau/zip.js). Files are only unpacked when they're needed. Both the current export format and the older format (one zip per memory, with a caption overlay) are supported, and caption/sticker overlays are drawn on top of the photo or video.
- Dates come from Snapchat's file names (`2023-06-01_…`), with the time of day taken from the zip.
- Face align uses Google's [MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker), running in your browser. The model (`public/models/face_landmarker.task`) is served with the app, so nothing is sent anywhere. Following one person uses the face recognition model from [face-api](https://github.com/vladmandic/face-api) (`public/models/face_recognition_model.bin`), also run on your device.
- Some iPhone videos (HEVC `.mov`) can't play in every browser. Those clips are skipped automatically.

## License

MIT
