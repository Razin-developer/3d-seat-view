# 3D Seat View for BookMyShow / District

See the view from your seat before you pay. Pick a seat on BookMyShow or District and a side panel opens next to the seat map with a 3D view from that seat, a score out of 100, and the numbers behind it: distance to the screen, offset from centre, screen fill angle, neck tilt and row.

**Website:** https://seats.movie/  
**Video (1 min):** https://youtu.be/BZO4ZHF7kJk
**Chrome Web Store:** https://chromewebstore.google.com/detail/flckkbgpbfplbiljniohphhmaogainnl  

## Install

Install from the [Chrome Web Store](https://chromewebstore.google.com/detail/flckkbgpbfplbiljniohphhmaogainnl) and press **Add to Chrome**. Then open a seat-selection page on BookMyShow or District, click the 3D Seat View icon and pick a seat.

Works in Chrome and other Chromium browsers (Edge, Brave, Arc) on a computer.

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
