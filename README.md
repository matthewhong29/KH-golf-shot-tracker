# Golf Shot Tracker

A phone-friendly tracker for Dad's launch monitor sessions. It reads `data/dad_golf_data.json` and shows, club by club, how far and where the ball goes and how that changes over time.

**Live site:** https://matthewhong29.github.io/KH-golf-shot-tracker/ (on an iPhone, open it in Safari and use Share → Add to Home Screen)

Static HTML, CSS and JavaScript with no build step and no dependencies, served by GitHub Pages from `main`.

## Adding a range session

1. Dad takes photos of the Toptracer (or Rapsodo) screen and texts them to Matthew.
2. Matthew opens a Claude Code session on this repo, attaches the photos and says, for example, "Add these shots from Nov 15 and push to main."
3. Claude follows `CLAUDE.md`: it reads the rows, adds them to `data/dad_golf_data.json`, runs the checks and pushes to `main`. The site updates about a minute later, and Claude writes a short summary to forward to Dad.

Shots can also be typed or pasted into the page itself (see [Pasting rows](#pasting-rows)). Those stay on that device until exported.

## What it shows

- **Stats** for one session, or all sessions pooled:
  - Highlights: shot count, thin or topped shots, average miss per club, and change since the baseline.
  - Averages and ranges for every metric per club, with "3 of 9" when only some shots have a number.
  - A carry gapping chart.
  - Dispersion: offline vs. carry, all clubs as small multiples or one club at a time.
  - Average miss by club.
  - The session's coaching notes.
- **Progress**: pick a club and a metric to see each session's range and average, then a baseline-vs-latest table. The baseline is the Aug 2026 Rapsodo session (`baseline_session_id`). A club that session doesn't include uses its own first session.
- **Sessions**: list, details, coaching notes, screen averages and recorded ranges. Add shots by hand or by pasting rows, delete shots, create or delete sessions.
- **Data**: player name and level, baseline session, export JSON and CSV, import JSON, reset local changes.

## Files

```
index.html               page and styles
js/core.js               stats, formatting, club names, paste parser (no DOM; runs in node too)
js/app.js                the interface
data/dad_golf_data.json  every session so far
tests/core.test.js       node tests; run: node tests/core.test.js
scripts/check-data.js    data file check; run: node scripts/check-data.js
CLAUDE.md                how Claude adds shots from screen photos
favicon.svg, apple-touch-icon.png
```

## Data and local edits

`data/dad_golf_data.json` is the shared copy. On load, the app draws from the last downloaded copy, then fetches a fresh one, so it also works offline at the range.

Anything added or changed in the app is saved in that browser's localStorage, under `golfTracker.v2`:

- New sessions show **Added on this device**.
- Editing a session from the file copies it locally and shows **Edited on this device**, with a **Revert to file version** button.
- Deleting a session from the file only hides it on that device.
- **Reset local changes** on the Data tab drops all of this.

To share new sessions with every device, use **Export JSON** on the Data tab. It writes the same format as the data file. Replace `data/dad_golf_data.json` in the repo with it and push. **Import JSON** merges a file into the current device by session id.

## Data format

Units match the screen. Carry and total are in yards. Apex, curve and offline are in feet, where negative means left and positive means right. Ball and club speed are in mph, launch and landing in degrees, and hang time in seconds. Any metric can be `null`.

```json
{
  "id": "2026-11-01-001", "time": "11:52", "club": "PW",
  "carry_yds": 81, "total_yds": 87, "ball_speed_mph": 72, "launch_deg": 26,
  "apex_ft": 44, "landing_deg": 41, "hang_time_s": null, "curve_ft": 24, "offline_ft": 15
}
```

A shot can also have `club_speed_mph`, `spin_rpm`, `smash_factor` (derived from ball and club speed when missing) and `note`.

A session has `id`, `date` (YYYY-MM-DD), `device`, optional `bay` or `location`, `notes` (data caveats), `coaching_notes`, optional `screen_averages`, and `shots`. A session with only ranges, like the Aug Rapsodo one, uses `"summary": { "PW": { "carry_yds": { "min": 9, "max": 95 } } }` and an empty `shots` array.

Club names: `Driver`, `3w`, `5w`, `5hy`, `4i`–`9i`, `PW`, `GW`, `SW`, `LW`. They are ordered short to long everywhere.

## Pasting rows

On a session, open **Add shots → Paste rows** and paste one shot per line.

- **Toptracer rows** without a header are read in screen order: carry, total, ball speed, launch, apex, landing, hang time, curve, offline. Hang time is dropped when rows have 8 numbers. One number per line is carry; two are carry and offline.
  - Times (including `01:00 PM`) and clubs (`Sw`, `9i`, `7 iron`, `Pitching Wedge`, `5 Hybrid`, `5w`…) are picked out by pattern.
  - A line with only a club sets the club for the lines below it.
  - Lists shown newest first are put back in chronological order.
  - Direction: `◀ 17` or `17L` or `L 17` or `-17` all mean 17 left, and `11 ▶` or `11R` mean 11 right.
- **Rapsodo CSV exports** (or any CSV, TSV or spreadsheet copy with a header row) are matched by column name. Examples: Carry Distance, Flat carry, Side Total (preferred over Side Carry), Descent Angle, Club Speed, Spin Rate. Units in the header such as `(yds)`, `(ft)`, `(m)` or `(km/h)` are converted. Average and Std. Dev. rows are skipped.

The preview shows how every value was read:

- Change a column's meaning from its dropdown.
- Untick rows you don't want.
- Tap a curve or offline value to flip L/R, for when OCR drops the arrows.
- Rows with odd counts or out-of-range values are flagged.

The preview works from parsed rows (`GolfCore.parsedFromRows`), so a future importer, such as photo OCR, can feed it the same way.

## How numbers are worked out

- Averages are rounded half to even. An exact 147.25 shows as 147.2, matching the numbers checked from the Toptracer screen.
- A **likely thin or topped shot** has launch under 10° (5° for woods), or carry under 60% of that club's upper-quartile carry. The upper quartile still works when most of a club's shots were mis-hit. Mis-hits show as hollow dots and are named in the highlights, but they stay in the averages.
- The dispersion plots convert offline from feet to yards, so both axes share one scale.

## Tests

```
node tests/core.test.js
node scripts/check-data.js
```

`check-data.js` checks the data file itself: duplicate ids, club names, times in order, and numbers outside plausible ranges (those come up as warnings to compare against the photo).

The tests check:
- every average and range in the hand-checked table, for all 6 clubs;
- the mis-hit rule and the highlight text;
- the progress baseline;
- the paste parser, against the Toptracer screenshot rows (both whitespace and tab-separated) and a Rapsodo CSV.

## Publish with GitHub Pages

In the repo on GitHub, go to **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, then pick **main** and **/ (root)** and save. The site appears at `https://<user>.github.io/<repo>/` within a minute or two. `.nojekyll` makes Pages serve the files as they are.

To try it locally, run `python3 -m http.server` in this folder and open http://localhost:8000. Opening `index.html` directly from disk can't load the data file; use Import JSON in that case.
