# 3D Seat View for BookMyShow / District

See the view from your seat before you pay. Pick a seat on BookMyShow or District and a side panel opens next to the seat map with a 3D view from that seat, a score out of 100, and the numbers behind it: distance to the screen, offset from centre, screen fill angle, neck tilt and row.

**Website:** https://seats.movie/  
**Video (1 min):** https://youtu.be/BZO4ZHF7kJk
**Download:** [3d-seat-view.zip](https://seats.movie/download/3d-seat-view.zip) · [install guide](https://seats.movie/install.html)

## Install

The extension isn't on the Chrome Web Store yet, so you load it yourself:

1. Download [`3d-seat-view.zip`](https://seats.movie/download/3d-seat-view.zip) and unzip it. Keep the folder somewhere it won't be deleted.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** (top left).
5. Pick the unzipped folder (the one with `manifest.json` inside).
6. Click the puzzle icon in the toolbar and pin **3D Seat View**.
7. Open BookMyShow or District, go to seat selection and pick a seat. The 3D view opens in the side panel.

**Updating:** download the new zip, replace the folder, then click the reload arrow on the extension's card in `chrome://extensions`.

Works in Chrome and other Chromium browsers (Edge, Brave, Arc).

## Releases

Push a tag starting with `v` (for example `v1.0.1`) and the **Release Extension** workflow zips the extension (everything except `docs/`, `.github/` and git files) into `clens.zip` and publishes a GitHub release with generated notes.

```bash
git tag v1.0.1
git push origin v1.0.1
```

## Website

The site lives in `docs/` and is deployed to GitHub Pages by the **Deploy website** workflow on every push to `main` and after every release. The deploy also builds the same `clens.zip` and bakes in the latest release version.

## License

Copyright (c) 2026 Sunith VS. **All rights reserved.** The source is public for reading and review; you may install the extension from the official releases for personal use. Copying, modifying, redistributing or republishing it needs written permission. See [LICENSE](LICENSE).

Not affiliated with BookMyShow or District.
