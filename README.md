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

The player buttons at the top (Dad | M3) switch everything below them.

Under them, **goals** stay pinned on every tab as a constant reminder: personal goals and goals from a coach, each labelled "From coach" or "My goal". Tap ✓ when one is achieved and it moves to a Done list; **Edit** adds, finishes or removes goals. The first three open goals show, with "Show all" for the rest. Goals added on a phone stay on that phone; to share them with every phone, ask Claude to add them to the data file (see `CLAUDE.md`), or export from Data & backup.

The four tabs are:

- **Stats** for one session, or all sessions pooled:
  - Session summary: big-number tiles for shots, solid contact and on line (within 10 yds), each with the change from the previous session, and the longest carry. Then a "Needs work" box listing clubs to practise (tap one to jump to it) and highlights: thin or topped shots, average miss per club, and change since the baseline.
  - **Shot replay:** watch each shot fly on a course, drawn from its numbers (see "Shot replay" below). Pick a club or all of them and a camera: **Tee box**, **Side** or **Green**. Step through the shots, **Play all** to run the session in order, and change the speed (1×, 2×, 4×). Under the picture: the carry, total, distance to the pin and peak height.
  - Club by club, one club at a time: tiles for its average carry, pure-strike carry, solid contact and average miss, its "Needs work" notes, **Goals** for the range (a focus, a distance zone around its pure-strike carry, on-line target, launch window and solid contact, each marked "On target" or "Keep working", with a link to the matching drills), then every number in plain words. A table comparing all clubs is folded underneath.
  - A carry gapping chart.
  - Dispersion: offline vs. carry. All clubs show as one panel each on the same scale, or pick one club.
  - Average miss by club.
  - The session's coaching notes.
- **Progress**: pick a club and a metric to see the baseline and latest side by side with the change, each session's range and average, then a baseline-vs-latest table. Arrows mark each change: up for better, down for worse, and one to three arrows for a small to big change (`GolfCore.trend` in `js/core.js`). More carry and speed is better; launch is better when it moves toward the club's target window; curve and offline when shots finish closer to the line on average. Peak height, landing angle and hang time get no arrow, since higher isn't always better. "Solid contact %" is one of the metrics. Dad's baseline is the Aug 2026 Rapsodo session (`baseline_session_id`). A club that session doesn't include uses its own first session.
- **Practice** has three sections. **Range**, for use during a range session:
  - **Your yardages:** each club's pure-strike carry and ball speed at a glance. Tap a club to pick it.
  - **Your clubs and launch targets:** every club in his bag with its model, loft and the launch a solid strike should have.
  - **Aim for:** the club's numbers to hit: a distance zone, the ball speed of a pure strike, the launch window and on line (within 10 yds). It also shows what his pure strikes look like (peak height, landing angle, total) and the club's "Needs work" notes.
  - **Focus:** one thing to work on with that club, with the matching drill: its animation, steps and coach's video.
  - **Check a shot:** type the carry, ball speed, launch and offline from the range screen to get "Pure strike!", "Good shot", "Keep working" or "Looks thin or topped", with a line on each number.
  - **Swing**: swing reviews. Matthew sends a swing video; Claude pulls out the key frames (setup, top, impact, finish), draws on them (orange for problems, green for fixes, blue for good, white guide lines), numbers each mark with a note, and lists what's working and what to fix, linked to the drills. Swipe or tap through the frames, and hide the lines to see the plain frame. A filming guide shows where to put the phone for the two views (face-on, and down the line from behind the hands) and what to get in the picture; until the first review there's also an example drawn with the drill figure.
  - **Drills**: focus areas for that player, each with why it matters, a "from your last session" line, and drills. Each drill plays its steps as an animation (a strip of 2–4 frames you can tap; it pauses for phones set to reduce motion), then the steps, reps, and a coach's video that loads when tapped (23 of the 30 drills so far, from long-running instruction channels such as Titleist, Rick Shiels, Danny Maude, Golf Monthly and Golf Channel; the rest link to a YouTube search). It ends with a suggestion to check things with a coach. The content is in `js/tips.js`, the drawings in `js/drillart.js`.
- **Sessions**: list, details, coaching notes, screen averages and recorded ranges. Add shots by hand or by pasting rows, delete shots, create or delete sessions. **Data & backup** (a button on this tab) has the player's name and level, baseline session, export JSON and CSV, import JSON, and reset local changes.

The look: a green KH Golf app bar with the Dad | M3 switch, white cards on a light background, big-number tiles, calendar tiles for sessions and a yardage book with distance bars in Practice. Text is Inter at 18px (nothing under 16px; chart labels 15px or more), every colour pair meets WCAG AA contrast (4.5:1), every button is at least 44px tall, and it works at phone widths down to 300px. Added to a home screen, it opens full screen with its own icon (`manifest.webmanifest`, `icons/`).

## Files

```
index.html                   page and styles
js/core.js                   stats, formatting, club names, paste parser, tips callouts (no DOM; runs in node too)
js/tips.js                   tips & drills for each player, keyed by player id
js/app.js                    the interface
js/drillart.js               drill animations (SVG, no DOM; the tests load it)
js/review.js                 swing review markup and checks (no DOM; the tests and data check load it)
js/flight.js                 shot replay: each shot's flight from its numbers, the cameras, the course, canvas drawing (the tests load it)
media/<player>/<review>/     frames for swing reviews (never the videos)
scripts/swing-frames.py      pulls frames from a swing video: probe, sheet, extract (with --blur), grid
scripts/review-preview.js    screenshots a review's frames as the page draws them
data/players.json            the list of players: id (used in ?player=), name, data file
data/dad_golf_data.json      Dad's sessions
data/brother_golf_data.json  M3's sessions
tests/core.test.js           node tests; run: node tests/core.test.js
scripts/check-data.js        data check; run: node scripts/check-data.js
CLAUDE.md                    how Claude adds shots from screen photos
manifest.webmanifest         home-screen app name, colours and icons
favicon.svg, apple-touch-icon.png, icons/
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

A player's clubs can go in a top-level `equipment` block: a `bag` with one entry per club, e.g. Dad's `"7i": { "model": "Lynx Black Cat", "loft_deg": 33 }` and `"Driver": { "model": "Callaway Edge", "loft_deg": 10.5 }`. `loft_deg` can be `null` when it isn't known, like his Callaway Edge 5 hybrid. A `note` and `lofts_source` say which clubs are which and where the lofts came from. Each club's launch target comes from its loft. The club cards show the model and loft, e.g. "7 iron · Lynx Black Cat, 33° loft", and the Practice tab lists every club with its launch target.

Goals live in a top-level `personal_goals` list: `{ "id": "goal-2026-11-02-1", "text": "Keep your head still through impact", "source": "coach", "added": "2026-11-02", "done": false }`, where `source` is `"coach"` or `"me"`.

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
- An **outlier** is a solid shot whose carry is far off that club's usual for the session, like a soft warm-up swing or a freak long one. It's judged within its own session, for a club with 5 or more solid shots:
  - carry more than 3.5 robust standard deviations from the median: 0.6745 × |carry − median| ÷ MAD > 3.5, where MAD is the median distance from the median;
  - MAD is never taken below 3% of the median, so a tight group can't turn ordinary shots into outliers. An outlier is always at least about 16% shorter or longer than usual.
- **Outliers are left out of the numbers too** (averages, ranges, pure strike, gaps, longest carry, dispersion averages, miss by club, progress), **but they still count as solid contact**. They also count in the hit rates: on line, shots landing in the carry zone, and the solid-contact goal.
  - They show as ringed dots on the charts and are marked "outlier" in the shot list, the shot table and the CSV export.
  - The highlights list them with the club's usual carry, e.g. "1 outlier, far off the usual carry: Driver 132 yds (usually 162)".
- Averages are rounded half to even. An exact 147.25 shows as 147.2, matching the numbers checked from the Toptracer screen.
- The dispersion plots convert offline from feet to yards, so both axes share one scale.
- **Needs work** (a soft yellow highlight, always labelled) marks a club when any of these is true (`needsWork` in `js/core.js`):
  - fewer than 80% of its shots were solid;
  - its average solid shot finishes 10 yds or more left or right of the target, a third of a 30-yard fairway;
  - its carry varies a lot: the standard deviation is over 15% of the average carry, with at least 4 solid shots.
- A **pure strike** is one of his best-struck shots with a club (`strikeReference`):
  - Take the club's solid shots.
  - Leave out any launched more than 4° below the club's launch window; those are usually thin, like a skulled wedge that flies low and long.
  - Of the rest, take the top quarter by ball speed (at least 2 shots, ties included). Ball speed is the best sign of a centred strike that Toptracer shows. Without ball speed, the top quarter by carry is used.
  - Their average carry is the **pure-strike carry**, the club's distance goal. Their lowest ball speed is the speed a pure strike needs.
  - On Practice, each club uses its most recent session, so the numbers grow as he improves. On Stats, they come from the session shown.
- **Goals** for each club come from the player's own shots, so they move as he improves (`clubGoals`):
  - **Distance:** a zone centred on the club's pure-strike carry. The window is 25% tighter than his current spread, but never under ±5 yds for wedges, ±6 for irons or ±8 for hybrids, woods and driver. Met when 7 of 10 shots land in it.
  - **On line:** met when 8 of 10 shots finish within 10 yds (30 ft) of the target line.
  - **Launch:** the solid shots' average launch sits inside the club's launch window (`launchWindow`).
    - When the data file gives the club's loft under `equipment.bag`, the window is ±2° around what a solid strike at a modest swing speed usually launches at: 64% of the loft for irons and wedges, 68% for hybrids, 75% for fairway woods, and the loft plus 3° for a driver off a tee. Dad's Black Cats give 3 iron 11–15°, 4 iron 13–17°, 5 iron 15–19°, 6 iron 17–21°, 7 iron 19–23°, 8 iron 22–26°, 9 iron 24–28° and PW 27–31°. His 10.5° Callaway Edge driver gives 12–16°.
    - Otherwise a ballpark window for the club applies (`LAUNCH_WINDOWS`, e.g. PW 26–30°, 7i 19–23°). These sit a few degrees above tour averages because slower swings launch higher; a coach can fine-tune them.
  - **Solid contact:** met when 9 of 10 swings are solid.
  - **Focus** names one thing to work on first: contact, then direction, then launch, then distance. Its "See drills" button opens the matching Tips section on Practice.
- **Check a shot** (`checkShot`) compares the numbers typed from the screen with that club's references:
  - Ball speed at or above the pure-strike speed is a pure strike's speed. Within 5% is "close"; lower is likely an off-centre hit.
  - Carry is checked against the distance zone, launch against the launch window, and offline against the 10-yd (30 ft) target.
  - The verdict is "Pure strike!" when the ball speed and the carry both match. It's "Looks thin or topped" when the shot would count as a mis-hit: launch under the floor, or carry under 60% of the pure-strike carry.

## Shot replay

The Stats tab replays each shot from the numbers the range screen gave; nothing extra needs recording. `js/flight.js` does the work:

- **The flight** leaves the tee at the launch angle, peaks at the apex height and comes down at the landing angle, landing at the carry. The apex sits a little past halfway, as drag makes it in a real flight.
  - Sideways, it bends by the curve in the air and finishes at the offline number (in the data files, offline is where the ball finished), so "to the pin" left or right always matches the screen. It hops and rolls out to the total, or spins back when the total is shorter than the carry.
  - It leaves at its ball speed and slows the way drag slows it. The time in the air is the hang time, or, when the screen doesn't show one (Toptracer's "All shots" screen doesn't), an estimate from the apex height.
  - Any other number missing from the screen is estimated from the club too, and the hint under the replay lists what was estimated.
- **The course** is laid out for each club: a 30-yard fairway (the same as the dispersion charts), rough, bunkers, trees and a green. The pin sits where a pure strike with that club finishes, carry plus roll, so "to the pin" shows how close the shot would have been. It's the same course every time for a club.
- **The cameras:** pick one above the picture. The camera stays put until you pick another; switching mid-shot cuts to it without restarting. Tap the picture to play or pause, like a video.
  - **Tee box** (the default): standing at the back of the tee box, 8 yds behind the ball at eye height, looking down the hole the way the golfer sees it. It ends with the carry, the total and the distance to the pin.
  - **Side:** off to the right of the hole and square to it, tee on the left, so the whole arc shows. The peak height is marked once the ball is over the top.
  - **Green:** above the green. The ball drops in, lands and rolls, then a dashed line shows the distance to the pin and where it landed. A shot that finished well away from the green gets its own framing, so it's always in view.
  - A corner readout counts the distance and height while the ball flies.
  - Each club keeps the same cameras from shot to shot, so in **Play all** each new shot flies over the faded tracers of the ones before it, like the pattern on a range screen. From the green, that shows where the shots finished around the pin.
- It pauses while it's off screen or the page is in the background. On phones set to reduce motion, Play goes straight to the result and Play all draws every shot at once.

## Tests

```
node tests/core.test.js
node scripts/check-data.js
```

`check-data.js` checks `data/players.json` and every player file it lists: duplicate ids, club names, times in order, and numbers outside plausible ranges (those come up as warnings to compare against the photo). Pass a path to check one file: `node scripts/check-data.js data/dad_golf_data.json`.

The tests check:
- every average and range in the hand-checked tables: the brief's table against shots 001–036, and the full Nov 1 session, where the 5w uses only its 2 solid shots;
- the mis-hit and outlier rules, solid-contact rates and the highlight text;
- the progress baseline;
- the tips callouts and content;
- the player registry and data files;
- the paste parser, against the Toptracer screenshot rows (both whitespace and tab-separated) and a Rapsodo CSV;
- the shot replay: every real shot in the data files lands at its carry, bends by its curve, peaks at its apex and finishes at its total and offline; launch and landing angles; estimates for missing numbers; the tee box, side and green cameras keep the shot in view; and drawing runs in every view.

## Saving goals to GitHub

Goals added in the page save on that phone. To keep them on every phone, add a GitHub key to each phone once, under Sessions → Data & backup → **Save goals to GitHub**:

1. On GitHub, open Settings → Developer settings → **Fine-grained tokens** → Generate new token (https://github.com/settings/personal-access-tokens/new).
2. Name it "Shot tracker" and set an expiration. Under **Repository access**, choose **Only select repositories → KH-golf-shot-tracker**.
3. Under **Permissions**, click **+ Add permissions**, tick **Contents**, and change it from Read-only to **Read and write**. GitHub adds Metadata (read-only) automatically; leave it.
4. Generate it and copy it right away (GitHub shows it only once). Paste it into the page on each phone; never into the repo or a chat.

With a key, every goal change (add, ✓ done, undo, remove) is committed to that player's data file as "Update Dad’s goals from the tracker". Only `personal_goals` changes; the file keeps its formatting.
- **Other phones:** phones with a key read the newest file straight from GitHub. Phones without one see the change once Pages rebuilds, about a minute later.
- **Two phones at once:** if two phones save at the same moment, the second one re-reads the file and tries again.
- **No connection or expired key:** if GitHub can't be reached or the key has expired, the change stays on the phone and uploads on the next save or reload. The goals box shows **Try again**.

The key is stored only in that phone's browser (`localStorage`), never in the site or this public repository. It can only change files in this one repository; delete it on GitHub to revoke it. The repository and branch come from `"github"` in `data/players.json`.

## Publish with GitHub Pages

In the repo on GitHub, go to **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, then pick **main** and **/ (root)** and save. The site appears at `https://<user>.github.io/<repo>/` within a minute or two. `.nojekyll` makes Pages serve the files as they are.

To try it locally, run `python3 -m http.server` in this folder and open http://localhost:8000. Opening `index.html` directly from disk can't load the data files; use Import JSON in that case.
