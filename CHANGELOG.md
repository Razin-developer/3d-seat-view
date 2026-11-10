# Changelog

## 1.6.0

### Added
- **Seat pill.** While a seat is selected on BookMyShow, District or PVR, a small pill at the bottom of the page says "Check how it views from this seat". Clicking it opens the side panel on that seat. It can be dismissed and comes back when the selection is cleared.
- **Trailer on the 3D screen.** A "Trailer" button appears in the panel when the movie has a trailer (or teaser). Nothing plays until it is pressed. It plays in full HD on the cinema screen in the 3D view, correctly angled for your seat, and "Stop" restores the poster.
  - BookMyShow: trailer address read from the movie page.
  - District: first trailer listed on the movie page.
- **Compare seats.** Pin up to three seats and see score, price, value, distance, screen fill and neck tilt side by side, with the best value in each row highlighted.
- **Value for money.** Shows how a seat ranks on score per rupee, and suggests a cheaper seat that scores within 6 points when there is one.
- **Share view.** Makes a picture of your 3D view with the seat, price, cinema and score on it. Uses the system share sheet, the clipboard, or a download, in that order.
- **Hall types.** IMAX, premium large format, recliner, 4DX and single screen, picked automatically from the show name and changeable under "Adjust hall estimates".
- **PVR INOX** (`pvrcinemas.com`) support: seat map, sold/selected state, category prices, screen above the first row.

### Changed
- `manifest.json`: version 1.6.0; new `declarativeNetRequest` permission; host access for `youtube-nocookie.com`, `youtube.com` and `*.pvrcinemas.com`; PVR added to the content-script matches.
- A session rule gives requests that come from the extension's own pages (never from websites) a Referer, because YouTube refuses embeds that arrive without one (error 153).

### Not changed
- Nothing is sent to any server of ours. Hall settings still stay in local storage.
- The GitHub workflows and the website are untouched, apart from the privacy page text.

### Known gaps
- The PVR adapter was built and checked against a saved copy of a PVR seat page, not a live session. "Find the best seat" on PVR clicks seats on the page and needs a live check.
- INOX's own site was not checked.
- The demo in `docs/demo` is a copy of an older panel and was not updated.

## 1.3.0
- As published on the Chrome Web Store.
