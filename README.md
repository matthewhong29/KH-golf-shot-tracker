# Golf Shot Tracker

A phone-friendly tracker for the family's range sessions: Dad, and Matthew's brother M3. It reads each player's data file and shows, club by club, how far and where the ball goes, how that changes over time, and what to practise next.

**Live site:** https://matthewhong29.github.io/KH-golf-shot-tracker/ (on an iPhone, open it in Safari and use Share → Add to Home Screen)

Each player has his own page:
- Dad: https://matthewhong29.github.io/KH-golf-shot-tracker/?player=dad
- M3: https://matthewhong29.github.io/KH-golf-shot-tracker/?player=brother

Add your own link to the home screen. Without `?player=`, the page opens on the last player used on that phone.

Static HTML, CSS and JavaScript with no build step and no dependencies, served by GitHub Pages from `main`.

## Adding a range session

1. Dad (or M3) takes photos of the Toptracer (or Rapsodo) screen and texts them to Matthew.
2. Matthew opens a Claude Code session on this repo, attaches the photos and says, for example, "Add these shots from Nov 15 for Dad and push to main."
3. Claude follows `CLAUDE.md`: it reads the rows, adds them to that player's data file, runs the checks and pushes to `main`. The site updates about a minute later, and Claude writes a short summary to forward.

Shots can also be typed or pasted into the page itself (see [Pasting rows](#pasting-rows)). Those stay on that device until exported.

## What it shows

The player buttons at the top (Dad | M3) switch everything below them. The four tabs are:

- **Stats** for one session, or all sessions pooled:
  - Highlights: shot count, solid-contact rate, thin or topped shots, average miss per club, and change since the baseline.
  - Averages and ranges for every metric per club, plus each club's shot and mis-hit count.
  - A carry gapping chart.
  - Dispersion: offline vs. carry. All clubs show as one panel each on the same scale, or pick one club.
  - Average miss by club.
  - The session's coaching notes.
- **Progress**: pick a club and a metric to see each session's range and average, then a baseline-vs-latest table. "Solid contact %" is one of the metrics. Dad's baseline is the Aug 2026 Rapsodo session (`baseline_session_id`). A club that session doesn't include uses its own first session.
- **Tips**: focus areas and drills for that player. Each focus area has:
  - why it matters for him;
  - a "from your last session" line computed from his latest session (hidden until he has data);
  - drills with steps, reps and a "Look it up on YouTube" search link.
  It ends with a suggestion to check things with a coach. The content is in `js/tips.js`.
- **Sessions**: list, details, coaching notes, screen averages and recorded ranges. Add shots by hand or by pasting rows, delete shots, create or delete sessions. **Data & backup** (a button on this tab) has the player's name and level, baseline session, export JSON and CSV, import JSON, and reset local changes.

The layout is white and high-contrast, using large Atkinson Hyperlegible text (18px body; charts at 14px or more). Every button is at least 48px tall, and it works at phone widths down to 360px.

## Files

```
index.html                   page and styles
js/core.js                   stats, formatting, club names, paste parser, tips callouts (no DOM; runs in node too)
js/tips.js                   tips & drills for each player, keyed by player id
js/app.js                    the interface
data/players.json            the list of players: id (used in ?player=), name, data file
data/dad_golf_data.json      Dad's sessions
data/brother_golf_data.json  M3's sessions (none yet)
tests/core.test.js           node tests; run: node tests/core.test.js
scripts/check-data.js        data check; run: node scripts/check-data.js
CLAUDE.md                    how Claude adds shots from screen photos
favicon.svg, apple-touch-icon.png
```

To add another player, add an entry to `data/players.json` and create his data file by copying the shape of `data/brother_golf_data.json`. Tips are optional: add an entry keyed by his id in `js/tips.js`.

## Data and local edits

Each player's data file is the shared copy. On load, the app draws from the last downloaded copy, then fetches a fresh one, so it also works offline at the range.

Anything added or changed in the app is saved in that browser's localStorage, separately for each player (`golfTracker.v3.<player id>.*`):

- New sessions show **Added on this device**.
- Editing a session from the file copies it locally and shows **Edited on this device**, with a **Revert to file version** button.
- Deleting a session from the file only hides it on that device.
- **Reset local changes** (Sessions → Data & backup) drops all of this for that player.

To share new sessions with every device, use **Export JSON** in Data & backup. It writes the same format as the data file and is named after it (e.g. `dad_golf_data.json`). Replace the file in the repo with it and push. **Import JSON** merges a file into the current player's data on that device, by session id.

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

The top-level `player` has `name`, `relationship`, `level`, and optionally `age`, `height_in` and `goals`. The page and the tips use `name` and `height_in`.

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

- A **likely mis-hit** (thin, topped or fat) has either of these, judged within its own session:
  - launch under 5° for woods, hybrids and driver, or under 10° for irons and wedges;
  - carry under 60% of that club's upper-quartile carry. The upper quartile still works when most of a club's shots were mis-hit.
- **Mis-hits are left out of every number:** averages, ranges, gaps, the dispersion averages, miss by club, progress and the highlights' numbers. They stay on the charts as hollow dots, outside the range bars, so contact and consistency are still visible.
  - The Stats table shows each club's shot count with its mis-hits under it. "3 of 9" counts only solid shots.
  - A club whose shots were all mis-hits shows "—" with "all N were mis-hits".
  - The highlights give the solid-contact rate (e.g. "Solid contact: 45 of 48 shots (94%)"), and Progress tracks it per club and session.
  - Sessions with ranges only, like the Aug 2026 Rapsodo one, can't be split this way. Their recorded ranges include any topped shots, and their solid-contact rate shows as unknown.
- Averages are rounded half to even. An exact 147.25 shows as 147.2, matching the numbers checked from the Toptracer screen.
- The dispersion plots convert offline from feet to yards, so both axes share one scale.

## Tests

```
node tests/core.test.js
node scripts/check-data.js
```

`check-data.js` checks `data/players.json` and every player file it lists: duplicate ids, club names, times in order, and numbers outside plausible ranges (those come up as warnings to compare against the photo). Pass a path to check one file: `node scripts/check-data.js data/dad_golf_data.json`.

The tests check:
- every average and range in the hand-checked tables: the brief's table against shots 001–036, and the full Nov 1 session, where the 5w uses only its 2 solid shots;
- the mis-hit rule, solid-contact rates and the highlight text;
- the progress baseline;
- the tips callouts and content;
- the player registry and data files;
- the paste parser, against the Toptracer screenshot rows (both whitespace and tab-separated) and a Rapsodo CSV.

## Publish with GitHub Pages

In the repo on GitHub, go to **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, then pick **main** and **/ (root)** and save. The site appears at `https://<user>.github.io/<repo>/` within a minute or two. `.nojekyll` makes Pages serve the files as they are.

To try it locally, run `python3 -m http.server` in this folder and open http://localhost:8000. Opening `index.html` directly from disk can't load the data files; use Import JSON in that case.
