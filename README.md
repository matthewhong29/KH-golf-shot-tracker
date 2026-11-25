# Golf Shot Tracker

A phone-friendly tracker for the family's range sessions: Dad, Matthew (M2) and his brother M3. It reads each player's data file and shows, club by club, how far and where the ball goes, how that changes over time, and what to practise next.

**Live site:** https://matthewhong29.github.io/KH-golf-shot-tracker/ (on an iPhone, open it in Safari and use Share → Add to Home Screen)

Each player has his own page:
- Dad: https://matthewhong29.github.io/KH-golf-shot-tracker/?player=dad
- M2 (Matthew): https://matthewhong29.github.io/KH-golf-shot-tracker/?player=matthew
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

The five tabs are:

- **Stats** for one session, or all sessions pooled:
  - Session summary: big-number tiles for shots, solid contact and on line (within 10 yds), each with the change from the previous session, and the longest carry. The change is judged only on the clubs hit both times ("same clubs"), each weighted by the fewer of its two shot counts, so a day of hybrids isn't set against a day of wedges, and it reads "About the same" unless it's bigger than chance would make it (`GolfCore.rateChange`). Then a "Needs work" box listing clubs to practise (tap one to jump to it) and highlights: likely mis-hits (thin or topped, or fat), outliers, average miss per club, and change since the baseline.
  - **Shot replay:** watch each shot fly on a course, drawn from its numbers (see "Shot replay" below). Pick a club or all of them and a camera: **Tee box**, **Side** or **Green**. Step through the shots, **Play all** to run the session in order, and change the speed (1×, 2×, 4×). **Best 10** shows each club's best shots flying together, a picture of his ideal flight, with their average carry, total, height and landing angle. Under the picture: the carry, total, distance to the pin and peak height.
  - Club by club, one club at a time: tiles for its average carry, pure-strike carry, solid contact and average miss, its "Needs work" notes, **Goals** for the range (a focus, a distance zone around its typical carry, on-line target, launch window and solid contact, each marked "On target" or "Keep working", with a link to the matching drills), then every number in plain words. A table comparing all clubs is folded underneath.
  - A carry gapping chart.
  - Dispersion: offline vs. carry. All clubs show as one panel each on the same scale, or pick one club.
  - Average miss by club.
  - The session's coaching notes.
- **Progress**: pick a club and a metric to see the baseline and latest side by side with the change, each session's range and average, then a baseline-vs-latest table. Arrows mark each change: up for better, down for worse, and one to three arrows for a small to big change (`GolfCore.trend` in `js/core.js`). An arrow shows only when the change is bigger than the spread of his shots could make by luck (1.65 standard errors of the difference, from each session's spread and number of shots; for solid contact, from its odds), so a few shots one way or the other read "About the same". A session with fewer than 5 shots is marked "only a few shots". When the baseline kept only ranges, like Dad's Aug 2026 Rapsodo session, only the longest shots can be set side by side, and they get "Can't tell" instead of an arrow, since a longer list of shots has a longer longest. More carry and speed is better; launch is better when it moves toward the club's target window; curve and offline when shots finish closer to the line on average. Peak height, landing angle and hang time get no arrow, since higher isn't always better. "Solid contact %" is one of the metrics. Dad's baseline is the Aug 2026 Rapsodo session (`baseline_session_id`). A club that session doesn't include uses its own first session.
- **Practice** has three sections. **Range**, for use during a range session:
  - **Your yardages:** each club's typical carry, the middle of its solid shots over its last 3 sessions and the number to play on the course, with a lighter bar out to its pure-strike carry and the ball speed of a pure strike. One bad day doesn't move them. Tap a club to pick it.
  - **Your clubs and launch targets:** every club in his bag with its model, loft and the launch a solid strike should have.
  - **Aim for:** the club's numbers to hit: a distance zone around his typical carry (the pure strike is the stretch target), the ball speed of a pure strike, the launch window and on line (within 10 yds). It also shows what his pure strikes look like (peak height, landing angle, total) and the club's "Needs work" notes.
  - **Focus:** one thing to work on with that club, with the matching drill: its animation, steps and coach's video.
  - **Check a shot:** type the carry, ball speed, launch and offline from the range screen to get "Pure strike!", "Good shot", "Keep working", "Looks thin or topped" or "Looks fat or mis-struck", with a line on each number.
  - **Swing**: swing reviews. Matthew sends a swing video; Claude pulls out the key frames (setup, top, impact, finish), draws on them (orange for problems, green for fixes, blue for good, white guide lines), numbers each mark with a note, and lists what's working and what to fix, linked to the drills. Swipe or tap through the frames, and hide the lines to see the plain frame. A filming guide shows where to put the phone for the two views (face-on, and down the line from behind the hands) and what to get in the picture; until the first review there's also an example drawn with the drill figure.
  - **Drills**: focus areas for that player, each with why it matters, a "from your last session" line, and drills. Each drill plays its steps as an animation (a strip of 2–4 frames you can tap; it pauses for phones set to reduce motion), then the steps, reps, and a coach's video that loads when tapped (23 of the 30 drills so far, from long-running instruction channels such as Titleist, Rick Shiels, Danny Maude, Golf Monthly and Golf Channel; the rest link to a YouTube search). It ends with a suggestion to check things with a coach. The content is in `js/tips.js`, the drawings in `js/drillart.js`.
- **Game**: play TPC Harding Park with his own shots: a real swing on the phone (drag back and swipe through, or swing the phone itself like a club; the tempo, the swipe or the phone set the clubface and the path, and the ball flies by the ball-flight laws), the swing meter, or typing in the shots he hits at the range to play a hole live. He picks the shot as well as the club (a draw or a fade, high or low, a spinner, a chip, a flop, a splash), with the one a golfer would play suggested (see [Game](#game) below).
- **Sessions**: list, details, coaching notes, screen averages and recorded ranges. Add shots by hand or by pasting rows, delete shots, create or delete sessions. **Data & backup** (a button on this tab) has the player's name and level, baseline session, export JSON and CSV, import JSON, and reset local changes.

The look: a green KH Golf app bar with the Dad | M3 switch, white cards on a light background, big-number tiles, calendar tiles for sessions and a yardage book with distance bars in Practice. Text is Inter at 18px (nothing under 16px; chart labels 15px or more), every colour pair meets WCAG AA contrast (4.5:1), every button is at least 44px tall, and it works at phone widths down to 300px. On a phone too narrow for all five tab names, the tab bar shows the icons, with the name of the tab you're on. Added to a home screen, it opens full screen with its own icon (`manifest.webmanifest`, `icons/`).

## Files

```
index.html                   page and styles
js/core.js                   stats, formatting, club names, paste parser, tips callouts (no DOM; runs in node too)
js/tips.js                   tips & drills for each player, keyed by player id
js/app.js                    the interface
js/drillart.js               drill animations (SVG, no DOM; the tests load it)
js/review.js                 swing review markup and checks (no DOM; the tests and data check load it)
js/flight.js                 shot replay: each shot's flight from its numbers, the cameras, the course, canvas drawing (the tests load it)
js/courses.js                the Game tab's courses: TPC Harding Park's scorecard and hole notes (the tests load it)
js/course-maps.js            the courses' ground as mapped in OpenStreetMap: every hole's line of play, green, fairway, tee box and bunker, the boundary, Lake Merced, the trees (the tests load it)
js/course-elev.js            the height of the courses' ground every 6 yds, from the USGS 3D Elevation Program (the tests load it)
js/game.js                   the Game tab's engine: the holes on the ground, his shots for each club, the real swing (reading a swipe or the phone's gyroscope, his clubs' face and path, the ball-flight laws, the strike), the shot types and which to play, the swing meter's timing, penalties, putting, the score (the tests load it)
media/<player>/<review>/     frames for swing reviews (never the videos)
scripts/swing-frames.py      pulls frames from a swing video: probe, sheet, extract (with --blur), grid
scripts/review-preview.js    screenshots a review's frames as the page draws them
scripts/build-course-map.py  builds js/course-maps.js from OpenStreetMap's data for the course, and js/course-elev.js from the USGS's heights
data/players.json            the list of players: id (used in ?player=), name, data file
data/dad_golf_data.json      Dad's sessions
data/brother_golf_data.json  M3's sessions
tests/core.test.js           node tests; run: node tests/core.test.js
scripts/check-data.js        data check; run: node scripts/check-data.js
scripts/stamp.js             stamps each script tag in index.html with a hash of its file; run after changing js/
CLAUDE.md                    how Claude adds shots from screen photos
manifest.webmanifest         home-screen app name, colours and icons
favicon.svg, apple-touch-icon.png, icons/
```

To add another player, add an entry to `data/players.json` (and to `DEFAULT_PLAYERS` in `js/app.js`, so a link to him works on a phone's first visit) and create his data file by copying the shape of `data/brother_golf_data.json`, as `data/matthew_golf_data.json` was for M2. Tips are optional: add an entry keyed by his id in `js/tips.js`.

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

A shot can also have `club_speed_mph`, `spin_rpm`, `smash_factor` (derived from ball and club speed when missing) and `note`, and `"partial": true` when it wasn't a full swing: a drill ball, a half swing or a warm-up (see "Warm-ups and half swings" below).

A player's file can also have `swing_notes`, a list of `{ "date", "source", "note" }` shown under Practice → Swing (M2's came with his data), and `rounds_reset`, a day (`YYYY-MM-DD`): the first time a phone loads the file, it erases that player's saved round and past rounds from that day or before, so test rounds go from every phone. M3's is 2026-11-25. On one phone, **Erase all rounds** under Your rounds on the Game tab does the same.

A session whose shots have only some numbers (M2's August sessions, transcribed from screenshots) has `"shot_level_data": "partial"`, so the data check doesn't flag shots without a carry. Its numbers worked out from others rather than measured stay in an `estimated` block beside the shots and are never plotted, and its ranges (`summary`) fill in what the shots don't have.

A session can also have `equipment`, when it was hit with other clubs than the bag lists, like Dad's August baseline (`"Callaway Edge irons (same set Matthew used)"`). Progress then says that some of the change since is the clubs.

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

- A **likely mis-hit** has either of these, judged within its own session:
  - **thin or topped:** launch under the club's floor: 5° for woods, hybrids and driver and 10° for irons and wedges, or 60% of the low end of the club's usual launch window when that's higher (`launchFloor`: PW 16°, 9 iron 14°, 7 iron 11°, 5 hybrid 9°, driver 8°, to the nearest degree). A pitching wedge launched at 11° came off thin even if it ran a long way;
  - **fat or mis-struck:** carry under 60% of that club's upper-quartile carry at a normal height. The upper quartile still works when most of a club's shots were mis-hit. The screen can't tell a fat shot from a deliberate half swing, so warm-ups and half swings are set aside first (below).
- **Warm-ups and half swings** aren't full swings, so they're left out of every number, the mis-hits and the hit rates, like solid contact and on line (`practiceSwings`). They still show in the session's shot list (marked), the replay and the CSV export, and the highlights say how many there were:
  - any shot marked `"partial": true` in the data file: a drill ball, a half swing or a warm-up that Matthew says wasn't a full swing;
  - the warm-up: what would be a fat mis-hit (a short carry at a normal height) with a wedge or a short iron, among the first 10 balls of a range session (20 or more, with times) and within 5 minutes of its first shot. M3's first pitching wedges on Nov 12 (44–50 yds at 51–53 mph) are one. A thin or topped shot there is still a mis-hit, and so is a fat shot later on.
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
  - A long one struck at least as fast as his top quarter of ball speeds for the club isn't an outlier: it's his best strike of the day.
  - The highlights list them with the club's usual carry, e.g. "2 outliers, far off the usual carry: 9i 67 yds (usually 95); 7i 73 yds (usually 109)" (Dad, Nov 22).
- Averages are rounded half to even. An exact 147.25 shows as 147.2, matching the numbers checked from the Toptracer screen.
- The dispersion plots convert offline from feet to yards, so both axes share one scale.
- **Needs work** (a soft yellow highlight, always labelled) marks a club when any of these is true (`needsWork` in `js/core.js`):
  - fewer than 80% of its shots were solid;
  - its average solid shot finishes 10 yds or more left or right of the target, a third of a 30-yard fairway;
  - its carry varies a lot: the standard deviation is over 15% of the average carry, with at least 4 solid shots;
  - fewer than half of its solid shots (at least 5) finish within 10 yds of the line, when the average miss alone doesn't show it, as with misses both ways ("only 6 of 30 finished within 10 yds of the line, missing both ways").
- A **pure strike** is one of his best-struck shots with a club (`strikeReference`):
  - Take the club's solid shots.
  - Leave out any launched more than 4° below the club's launch window; those are usually thin, like a skulled wedge that flies low and long.
  - Of the rest, take the top quarter by ball speed (at least 2 shots; equal speeds, as whole mph often are, go to the longer carry). Ball speed is the best sign of a centred strike that Toptracer shows. Without ball speed, the top quarter by carry is used.
  - Their average carry is the **pure-strike carry**, what a pure strike does: the stretch target. Their lowest ball speed is the speed a pure strike needs.
  - On Practice, each club uses its last 3 sessions pooled, so the numbers grow as he improves but one bad day doesn't move them. On Stats, they come from the session shown.
- **Goals** for each club come from the player's own shots, so they move as he improves (`clubGoals`):
  - **Distance:** the same distance every time: a zone centred on the club's typical carry (the median of his solid shots; on Practice, over the club's last 3 sessions), ±5 yds for wedges, ±6 for irons and ±8 for hybrids, woods and driver, however scattered the session. Met when 7 of 10 shots land in it. The pure-strike carry is shown beside it as the stretch target. Pick clubs on the course by the typical carry: most shots aren't pure.
  - **On line:** met when 8 of 10 shots finish within 10 yds (30 ft) of the target line.
  - **Launch:** the solid shots' average launch sits inside the club's launch window (`launchWindow`).
    - When the data file gives the club's loft under `equipment.bag`, the window is ±2° around what a solid strike at a modest swing speed usually launches at: 64% of the loft for irons and wedges, 68% for hybrids, 75% for fairway woods, and the loft plus 3° for a driver off a tee. Dad's Black Cats give 3 iron 11–15°, 4 iron 13–17°, 5 iron 15–19°, 6 iron 17–21°, 7 iron 19–23°, 8 iron 22–26°, 9 iron 24–28° and PW 27–31°. His 10.5° Callaway Edge driver gives 12–16°.
    - Otherwise a ballpark window for the club applies (`LAUNCH_WINDOWS`, e.g. PW 26–30°, 7i 19–23°). These sit a few degrees above tour averages because slower swings launch higher; a coach can fine-tune them.
  - **Solid contact:** met when 9 of 10 swings are solid.
  - **Focus** names one thing to work on first: contact, then direction, then launch, then distance. Its "See drills" button opens the matching Tips section on Practice.
- **Check a shot** (`checkShot`) compares the numbers typed from the screen with that club's references:
  - Ball speed at or above the pure-strike speed is a pure strike's speed. Within 5% is "close"; lower is likely an off-centre hit.
  - Carry is checked against the distance zone, launch against the launch window, and offline against the 10-yd (30 ft) target.
  - Carry in the zone is on target; carrying to within a club's window of the pure-strike carry is pure-strike distance, even past the zone.
  - The verdict is "Pure strike!" when the ball speed and the carry both match and the launch isn't low. It's "Looks thin or topped" when the launch is under the floor and "Looks fat or mis-struck" when the carry is under 60% of the pure-strike carry, as for a mis-hit.

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
- **Best 10** (`GolfCore.bestShots`) picks each club's 10 best shots in the session (or all sessions): solid shots, no outliers, launched at a normal height as for pure strikes. They're ranked by how close each came to an ideal shot: the yards it landed short of the pure-strike carry (nothing for flying past it, since that's a great strike) plus the yards it finished off line. A weak shot that rolls out straight doesn't make the list; a long, straight one does. On a tie, the faster ball speed goes first. A club with fewer solid shots shows them all ("best 4 of 4").
  - It opens on all of them at once, the best one highlighted and the rest as faint tracers, with the cameras framed on just those shots. Step through them, or Play and Play all to watch them fly; the others stay on screen.
  - The line above the numbers gives their averages, e.g. "Your best 10 with the 5 hybrid average 133 yds carry, 140 total, 65 ft high, landing at 40°."
- It pauses while it's off screen or the page is in the background. On phones set to reduce motion, Play goes straight to the result and Play all draws every shot at once.

## Game

The Game tab plays a real course, TPC Harding Park in San Francisco, with each player's own shots. The round is saved on the phone, for each player, after every stroke, so closing the page carries on where he left off. Finished rounds go in **Your rounds**.

- **Before a round:** pick the tees (Blue, 6,845 yds, or White, 6,405), all 18, the front or back 9, or one hole, and how to play the shots (he can switch during a round):
  - **Real swing** (the default): a swing on the phone, like a real one: a swipe on the pad, or the phone itself swung like a club (see [The real swing](#the-real-swing) and [Swinging the phone](#swinging-the-phone) below).
  - **Swing meter:** tap to start the swing, tap again to set the power (a white line marks the power for the distance he's aiming at), then tap as the marker comes back across the yellow line. Early pulls it left and late pushes it right; way off is a mis-hit. The bar fills in 1.4 s, and however short the shot, it takes at least half a second to reach its white line and the marker at least 0.4 s to come back, so a chip is as calm to time as a drive.
  - **From the range:** hit the shot at the range, then type in its carry, total and offline from the screen, and it plays on the hole. A club with no range shots yet can be played this way.
  - **Easy** gives both swings more room for error (the meter is slower, with a bigger window). **I play left-handed** turns the real swing round for a left-hander: his pull goes right and his draw curves right.
  Settings saved before the real swing existed, and a round started on the swing meter before then, move to the real swing once.
- **Each shot:** the map shows the hole from above with the ball, this hole's shots so far, the aim line and an oval where most of his shots with that club finish (1.5 standard deviations each way, moved by his average miss, so if his 5 hybrid usually finishes right, its oval sits right of the aim). Tap the map to aim, or nudge the aim with ◀ ▶. Each club chip shows how far a good swing goes. The suggested club is the shortest that gets there, skipping clubs he mis-hits more than a third of the time, the driver off the turf, and woods from sand or the trees. Then the shot flies, seen from behind the ball. Once it's past its peak and has come down to half its height, the camera cuts to where it's landing: from behind and above the landing spot, framed on the end of the descent, the landing and the roll (and the flag, when it comes down near the pin), so he sees it land, bounce and roll out the way it would. Then the map comes back where it stopped. Once the hole is over, the map shows the whole hole with every shot.
- **The default aim** (`GolfGame.aimFor`) is the pin when it's in range and nothing's in the way. Otherwise it's the spot that leaves the least of the hole to play, counting rough as 25 yds more, sand as 45, under the trees as 60 and each tree in the way as 60, and never in the water or out of bounds. A carry over water with little to spare counts against a spot (3 yds for every yard under 45 to spare over his good carry), so on the 18th, Dad (156 yds with his 5 hybrid) plays round the inlet of Lake Merced, while M3 (185 with his driver) carries it. From the rough or the trees it also looks sideways, to chip out.
- **With the swing meter, every swing is one of his real shots** with that club (`GolfGame.pickShot` in `js/game.js`). His solid shots with the club are ranked best to worst the way Best 10 ranks them (yards short of a pure strike plus yards off line). Perfect timing hits one of his best. The further off, the further down the list it goes (|timing|^0.7 of the way, so the timing most taps get, about a third of the window off, hits one from the middle: his usual shot), leaning to shots that went left when early and right when late. Off the line there's also a chance of one of his mis-hits, which grows with how often he mis-hits that club; outside the window it's always a mis-hit. The message after each shot says which real shot it was: "It flew like your 7 iron on Nov 22 at 14:31: 118 yds carry, 9 ft right."
- **Power and lie:** a smaller swing flies the same shape, shorter: a 70% swing goes 70% as far, and 70% as far off line. From the rough it goes 10% shorter and 15% wider; from sand, 20% shorter and 25% wider; from under the trees it's a low punch at 60% that runs out; and a driver off the turf goes 8% shorter and 25% wider.
- **The ground:** a ball that lands in the rough rolls about half as far, and slows more as it goes. One that lands in a bunker stays there, and one that rolls into a bunker stops in it. A ball that flies into a tree (its trunk, or the leaves above its bottom third, so a low punch can run under them) drops beside it. Rolling slowly over the hole, it drops in.
- **The hills** are the real ones (`js/course-elev.js`): the ground's height every 6 yds, from the USGS 3D Elevation Program by way of the AWS Terrain Tiles. It agrees with the course guides: the 3rd plays 16 ft uphill (they say 17), the 10th climbs 23 ft tee to green (22), the 8th and 11th play downhill, the 14th's approach climbs from the bottom of its fairway, and the 15th falls 40 ft toward the lake.
  - A ball comes down where its flight meets the ground: rising ground meets it sooner, and over falling ground it flies on, down at its landing angle. So uphill plays longer and downhill shorter, about a yard for every 3 ft with an iron, more with a driver's flatter fall (`GolfGame.playsLike`). The aim says it ("plays 163, 21 ft uphill"), and the club suggestion and the swing it asks for count it.
  - It rolls like a ball: farther downhill, shorter uphill, and a side slope turns it downhill, more as it slows. Landing on an upslope stops its first bounce short; a downslope kicks it on.
  - A sloped lie changes the shot. With the ball above his feet the face points left of his aim (for a right-hander; the more loft, the more: a 5° slope turns a 7 iron's face 3° and a sand wedge's 7°); below his feet, right. Uphill it launches higher and flies shorter; downhill it comes out lower and runs. The status line names the lie ("ball above your feet"), and the swing report says what it did.
  - The map shades the slopes, as if lit from the north-west. The greens are level, for putts and for a ball that lands and rolls on one: the heights are too coarse to read a green, so they're left flat rather than guessed.
- **Penalties** follow the Rules of Golf. Lake Merced costs a stroke, with a drop where the ball went in; out of bounds costs a stroke, and he hits again from the same spot. The most a hole can cost is double par, a casual rule, and **Pick up** takes double par any time.
- **Putting** with the real swing is on the pad (below). With the swing meter: on the green, or on the fringe (where he can chip with a club instead), the putting meter's yellow line is set for the length of the putt: stop the marker on it. The marker always takes at least 0.85 s to reach the line, so a short putt has the same easy rhythm as a long one (longer putts take a little longer). A well-paced putt dies a foot or so past the hole, and every putt wanders a little off line, more on longer ones. With taps about 45 ms off, as most people's are, about 8 in 10 drop from 3 ft, 2 in 3 from 5 ft, 4 in 10 from 10 ft and 1 in 7 from 20 ft. Putts inside 1½ ft are tapped in.
- **The course** is the real one. The ground (`js/course-maps.js`) is OpenStreetMap's map of TPC Harding Park, © OpenStreetMap contributors (ODbL): the course boundary and, inside it, each hole's line of play, every green, fairway, tee box and bunker, the practice ground, the woods and the cart paths, for the Harding 18 and the Fleming nine. All the holes share it, so a ball that strays onto the next fairway plays from there, and another hole's green plays as fairway. Beyond the boundary is Lake Merced (from the south tip round the west end to the 18th green) or out of bounds (the property line, everywhere else). A few things OSM doesn't map are added, and marked in the file:
  - the 18th's line of play, from its back tee box (the championship tee, 466 yds) across the inlet of the lake, then up the middle of its fairway to its green: a long, gentle dogleg left, with the Blue and White tees on the boxes beside;
  - a 26 by 30 yd green standing in for the 9th's;
  - the cypress trees, placed in rows with gaps between the holes (OSM doesn't map them one by one);
  - the fairways of holes 2, 4, 5, 7, 9, 13 and 15, which OSM doesn't have: each runs along the hole's line of play like the course's mapped ones, from 130 yds off the back tee to the front of the green, about 30 yds wide (26 on the tight 5th, 32 to 34 on the par 5s), narrowing toward the green and pinched where a fairway bunker cuts in.
  Two lines of play are moved to fit the ground: OSM's line for the 16th runs down the right edge of its fairway and into the rough, so it follows the middle of the fairway, as the 18th's does; and OSM's straight line for the 13th runs over its fairway bunker, which the 2020 PGA Championship guides put down the right of the landing area, so the line passes 6 yds left of it and the fairway built along it has the bunker on its right edge. Each hole's line now stays in its fairway at least 70% of the way from 60 yds off the tee to 30 short of the green (60% on the 18th, whose drive carries the inlet).

  The map comes from a cache of OSM's data (see `scripts/build-course-map.py`); it was checked hole by hole against the 2020 PGA Championship course guides (the shape of each hole, its bunkers, water and out of bounds) and the elevation, but refreshing it from OSM itself needs network access to OSM, which this environment doesn't allow by default.
  Each set of tees stands on the real tee box closest to its scorecard yardage (within 12 yds), or on the line of play at its yardage where no box is close. The scorecard (`js/courses.js`): pars and yardages, Blue from Offcourse and White from GolfPass, with a note on each hole from the course guides, checked against the map. The forward tees aren't offered, because their hole-by-hole yardages weren't published anywhere they could be checked. `scripts/build-course-map.py` rebuilds the map from OSM's data.
- **A simulator** could play shots too: `GolfGame.playShot(hole, from, aim, shot)` takes any shot with the usual keys (carry, total, offline, curve, apex, launch, landing, ball speed), the same way the range entry does.

### The real swing

The swing pad, under the map, is the ball seen from above with the target straight up the dashed line. He puts a thumb on the ball, drags down for the backswing and swipes up through the ball. It teaches the two things that send a ball left or right: the clubface, set by his timing, and the club's path, set by the way he swipes. Other golf games split a swing the same way: PGA TOUR 2K's swing stick measures the backswing, the tempo of the push forward (3 times the speed of the backswing) and the swing path, and EA's Pure Strike the backswing, the forward swing's speed and the swing plane; mobile games steer the ball with the angle of the swipe.

- **The backswing** is how far down he drags: the marks show ¼, ½, ¾ and full, red past full, and a gold line marks the backswing this shot needs (the same share of a full swing as the meter's white line). Past full adds only a little (a quarter of the extra, at most 6%) and costs control.
- **The tempo** is the time back over the time down, from when the finger starts moving to when it turns at the top, and from the top to the ball. The goal is Tour Tempo's: 3 : 1 for a full swing, 2 : 1 for a short one (half back or less, in between for in between) and for a putt, at whatever pace he likes. A stop of 0.12 s or more at the top is a pause and counts in neither half. Once he turns at the top, a gold ring rises to the ball at the pace of a perfect tempo, so he can see whether he beat it (quick) or lagged it (slow).
- **Reading the swipe** (`GolfGame.readSwing`) works like a launch monitor: a finger speeds up from rest and slows into the top, so the takeaway's start and the turn at the top are found by following the square root of the distance back in time (it runs straight in time while the finger speeds up evenly). Swipes of known timing read back within about 5%, at 60 or 120 frames a second. The path is the direction of the swipe's last part, from part way down to a little past the ball; where it comes back through, against where it started, is the strike. A quick flick that leaves the glass just short of the ball still counts.
- **The ball flies by the ball-flight laws** (`GolfGame.swingShot`). It starts mostly where the face points (85% for a driver, 75% for a 7 iron, 70% for a pitching wedge; the path sets the rest) and curves away from the path, by how open or shut the face is to it: about 4% of the carry for each degree with a driver, 2% with a 7 iron and 1% with a sand wedge (TrackMan's numbers). A slice flies a little higher and stops quicker; a hook flies lower and runs.
- **The timing sets the face.** A downswing that's quick for its backswing gets to the ball early with the face shut (a pull, left for a right-hander); a slow one gets there late with it open (a push). A 4 : 1 tempo instead of 3 : 1 shuts it about 3°, and the path goes half as far the same way (over the top when quick, stuck behind when slow). **The swipe sets the path:** up and to the right is in-to-out (for a right-hander it draws when the face is shut to that path), up and to the left out-to-in (it fades, or slices, when the face is open to it), 0.35° of path for each degree the swipe leans past 3° (a phone's slack).
- **His own swing is where it starts from.** Each club's usual face and path come from his range shots: Toptracer's offline and curve give each shot's start line and curve, and the ball-flight laws turn those into the face and path that hit it. So Dad's 5 hybrid comes in with the face 3.5° open and the path 1.7° in-to-out, and a perfect swing with it pushes and fades, as his real ones do; M3's 6, 7 and 8 irons swing about 3° in-to-out and draw. His own scatter stays too, half as wide as his range shots' with a perfect swing; a club with only a few shots leans toward straight and an ordinary golfer's scatter (3 shots' worth), so one odd shot doesn't make the club.
- **The strike sets the distance.** Each swing flies with the carry, height and spin of one of his real shots with the club, picked by how well it was struck: a good tempo out of the middle hits one of his best-struck (closest to his pure-strike carry), and the further off the tempo, the further from the middle, past full or snatched back, the further down the list. A bad enough strike is a mis-hit (the chance grows with how often he mis-hits the club): thin when he rushed it or snatched it, fat when it was slow, a shank off the heel, weak off the toe. It's one of his own mis-hits of that kind, or, for a kind he's never hit with the club, one of his good shots made thin or fat. Off the middle, the face twists (open off the toe, shut off the heel), a wood's gear effect curves it back the other way, and it goes a little shorter.
- **The aim allows for his shape.** The default aim is moved by where a perfect swing with the club finishes, so with Dad's 5 hybrid it aims 17 yds left ("17 yds left for your push-fade"), and the oval sits where a perfect swing ends up.
- **After each shot,** the report shows the tempo against its goal, the backswing, the path, the face and the strike, with a picture of the impact from above (the path in blue, the face in orange, the ball's flight in green, the angles drawn four times as big), a sentence of the ball-flight laws for that shot ("The ball started 2.7° right (where the face pointed) and curved 15 yds right, the face 4.0° open to the path."), and the one or two things that cost the most, with the numbers: "Tempo 4.0 : 1: quick from the top. Back in 0.83 s wants about 0.28 s down, for 3 : 1. Early, so the face shut 3.2° and it started further left." A good swing says what the club usually does for him, or, if it still curved off, that's the spread in his own shots. **Practice** takes one swing that doesn't count and says what a swing like that does on average, and how often it would be mis-hit.
- **Putting** is on the pad too: the backstroke sets the length (60 ft for a full one, growing faster than the drag, so short putts still get a stroke big enough to control), and a gold line marks the one that rolls this putt a foot past. The tempo (2 : 1) sets the pace and the face: jabbed, it runs on and pulls; slow, it dies and pushes. The swipe's lean turns it, and every putt wanders a little off line, as on a real green (2% of its length). With ordinary strokes about 8 in 10 drop from 3 ft, 1 in 2 from 6 ft, 1 in 4 from 10 ft and 1 in 7 from 20 ft.
- **After each hole and round,** a line says how many swings and putts were on tempo (within 10% of the goal), how many quick and slow, and his most common shape.
- **Simulated rounds** on the White tees (every shot a swipe, read and played as on the page): with good swings Dad shoots about 87 and M3 83; with ordinary ones about 94 and 91; with poor ones about 116 and 108; rushing every swing at about 4 : 1 costs 14 to 19 shots, most of them thin. Without the aim's allowance for his push-fade, Dad's ordinary round costs 3 more shots and twice as many trees.

### Swinging the phone

On a phone or tablet, **Swing the phone** under the swing pad turns the phone into the club. He holds it in both hands like the grip, the screen facing the target like the clubface, and swings it. The gyroscope reads the swing (`GolfGame.readMotion`), and the shot flies just as a swipe's would. iPhones ask first for access to motion; a phone that doesn't share its motion with web pages says so and stays on the pad.

- **Safety first.** Before the first swing of a visit, the page asks him to hold on tight (a case with a wrist strap helps), to make sure no one is near and there's nothing to hit, and to swing smoothly: it reads how far back he goes, his tempo and where the screen faces at impact, not his speed, so a half-speed swing is plenty. A reminder stays under the pad, and **Use the pad** goes back to swiping.
- **Nothing counts until he's ready.** Before every shot a ready check shows under the pad: both hands on it, the screen to the target, holding tight; no one near, nothing to hit; smooth, not hard (a smooth stroke on the green). The first time it's the fuller safety note, and its tap also asks the phone for its motion. Until he taps **I'm ready** the phone can be picked up, carried and waggled freely. After the tap it gives him 1.5 s to get set (turning the screen to the target and taking his grip), waits for him to keep still for half a second, then beeps, and buzzes on phones that can ("Swing! This one wants hands to the shoulder, the phone pointing up."), as he can't see the screen at address. The swing starts when the phone turns, and the slow first inches of the takeaway count. It's one swing a tap: after it, after a swing that couldn't be read, or after 30 s with no swing, the ready check comes back. **Cancel** stops it watching.
- **The backswing** is how far the phone turned about the swing's axis: a full one is about 240° from the ball (the club past vertical), a full putting stroke 30°. The dial on the pad shows ¼, ½, ¾, full and past full, the gold line for this shot and where the last swing got to.
- **The tempo** is the time back over the time down, as on the pad: from when it started turning to the top, where it stopped (a stop of 0.12 s or more is a pause), and from the top to impact, when the shaft came back to where it was at address.
- **The face** is where the screen pointed at impact, against the target line. With the screen facing the target, the swing's own axis says which way is up the shaft, and gravity at address (whichever sign the phone gives it) which way is level, so it works for either hand, held upright or sideways, and even with the screen facing him. **The path** is where the bottom of the "shaft" was heading at impact: a flatter downswing than the backswing comes from the inside (in-to-out), a steeper one over the top (out-to-in). The club gets 30% of the phone's face past 4° and of its path past 3°, up to 10° and 8° (a phone in two hands can't be held stiller than that), and the tempo still sets the strike. A putt starts a quarter of the screen's angle past 2°.
- **Checked on made-up swings** (a phone swung by numbers, its gyroscope sampled 60 times a second, as phones' browsers give it): it reads the backswing to within 1%, the tempo to within 3%, and the face and path to within 1°, for either hand, upright or sideways, the screen either way, gravity either way round or not there at all. A swing that pins the gyroscope (about 2000°/s) is turned down ("Too quick for the phone to follow: swing a little gentler"), as is one that stops at the top or never goes back.
- **The report** adds what the phone did ("The phone at impact: the screen 6.8° open, swinging 1.3° in-to-out.") and a tip when it was off ("The screen came back 6.8° open: roll it back to square, as it was at address, as you come through."). There's no strike row: the phone can't feel where the ball was struck.
- Wii golf games read a swing much the same way: the backswing sets the power, and the controller's twist at impact hooks or slices it.

### Choosing the shot

A golfer picks the shot as well as the club. Under the club chips, the **Shot** chips offer the shots that make sense from where the ball lies, with the one a golfer would play marked **Suggested** and why ("Suggested: out of bounds down the left: curve it away from it"), and how to play it. The real swing and the swing meter both play it; a club that can't (a flop with a 7 iron) switches to one that can.

- **On offer:** full shots: Normal, Draw, Fade, High and Low, and a Spinner off a clean lie within 140 yds. Round the green (within 45 yds of the pin or 30 of the green): Pitch, Chip and Flop. In a bunker within 30 yds: Splash; further out, Normal or Low. Under the trees: Punch, or a punch hooked or cut round them. On the green, just the putt.
- **What each does** to his normal shot with the club (`GolfGame.SHOTS`):
  - **Draw and Fade** are set up the way a golfer sets one up: the face where it should start and the path across it, as much as the ball-flight laws need to curve 6% of the carry back to the line, starting the other side of it by as much (a 7 iron's draw: the face 2.7° right and the path 5.7° right). A driver needs less of a change than a wedge to curve as far. His own pattern and his swing go on top, and once he's committed to a shape, his face-to-path scatter against it is halved: a golfer who plays a fade seldom hooks it. A draw runs 15% farther, a fade stops 15% sooner.
  - **High:** ball forward, a full finish: it launches 4° higher, peaks 25% higher, lands 6° steeper, goes 4% shorter and rolls 40% less. **Low:** ball back, hands ahead: 5° lower, about half as high, 10% shorter, rolling almost twice as far and curving 30% less.
  - **Spinner:** a crisp, full wedge or short iron that lands and stops. Struck pure from a clean lie it spins back 4% of its carry off a fast strike (85 mph or more, as tour players' wedges leave), and at a slower swing's speed it checks up instead (both players' wedges leave at about 65–80 mph). Not crisp enough, it checks and releases; from the rough it comes out hot and runs.
  - **Chip:** a bump-and-run played with a stroke of its own, like a putt: his biggest chip, a full stroke on the pad or the meter, goes about 50 yds with any club, so a 20-yd chip is a 40% stroke he can control. It flies low (14° flatter, a third as high), carries 55% of the club's normal shot and rolls by the club's chipping ratio, the ones golfers are taught for a medium-speed green: about as far as it carries with a sand wedge, twice with a pitching wedge, three times with an 8 iron and four times with a 6 iron, the same every time. It's easier to strike than a pitch, and a less than pure strike costs it little. The suggested chip club is the least lofted that still lands it on the green: a yard and a half on, more on a longer chip, allowing for the climb to a raised green.
  - **Flop:** face open, a long swing for a short shot: 18° higher off the face, 20° steeper down, 45% of the carry and hardly any roll. Much harder to strike: skulled, it shoots across the green; chunked, it goes half as far.
  - **Splash:** hit the sand behind the ball: half the carry, higher and softer, and a little more forgiving than picking it clean. **Punch:** from under the trees every shot is a low punch already (60%, and it runs).
- **The suggestion** (`GolfGame.suggestShot`) weighs what a golfer would: splash out of a greenside bunker; punch out from the trees; under trees in the way, or over them. Round the green: chip when there's green to roll on (the edge within 12 yds, the pin 6 or more yds on, and a club that lands it on), flop only over a bunker to a pin within 5 yds of the edge, otherwise pitch. Then water or out of bounds on one side of where he's aiming: curve it away from it (a fade for a right-hander when it's on the left), unless his normal shot with the club already curves away from it (3 yds or more on average), when that's the play: golfers are taught to play their usual shape and aim for it, not to force a bigger one. A bunker short of a tucked pin in reach: high. A tight pin within 120 yds: a spinner, but only for a golfer whose pure strike with the club is fast enough to back it up (85 mph or more), so not yet for Dad or M3. The hole bending over the shot and a little past it: shape it round the corner. Trees or sand much worse down one side (2½ times the other's; most holes have trees down both): curve it away from them, or again his usual shape when it already does. Never a draw or a fade with a wedge, which is for distance. On the White tees M3 hears a fade away from out of bounds off the 12th tee and from Lake Merced on the 16th to 18th, a draw round the bends of the 5th and 6th and into the 4th and 12th, a chip on the 1st, his usual draw away from the trees on the 1st, 4th and 11th, and his normal shot where nothing calls for more. Dad, whose hybrid fades, hears "your usual fade curves away from it" by the water on the 16th to 18th and the out of bounds on the 12th.
- **After the shot,** the report says whether it came off: "Fade: It faded, as planned.", "It didn't draw: the face was open to the path.", "Not struck crisply enough to spin: it released.", "Skulled the flop: it shot across the green." With a draw or a fade planned, the setup curves it, so the swipe tip asks for a straight swipe, and a planned shape that came off isn't called the spread in his shots. For a left-hander the words swap sides: his draw starts left and curves back right (he swings out to the left).
- **Simulated rounds** (ordinary swings, every shot a swipe, 100 rounds each): playing every suggested shot scores about the same as always playing his normal one, Dad 95.0 against 95.4 and M3 90.3 against 89.9, with fewer balls into the trees for both. The chip is the clearest gain: from 12 to 30 yds a chip finishes a median 5.7 ft from the hole, a sand-wedge pitch 8.5.

## Tests

```
node tests/core.test.js
node scripts/check-data.js
```

`check-data.js` checks `data/players.json` and every player file it lists: duplicate ids, club names, times in order, and numbers outside plausible ranges (those come up as warnings to compare against the photo). It also warns when a club's averages over a session's shots don't round to the `screen_averages` the screen showed (usually a misread row), when two rows match in every column (a shot entered twice), and when two sessions share a day and a device. Pass a path to check one file: `node scripts/check-data.js data/dad_golf_data.json`.

After changing any file under `js/`, run `node scripts/stamp.js`. It stamps each script tag in `index.html` with a hash of its file (`js/app.js?v=1a2b3c4d`). GitHub Pages lets phones keep files for 10 minutes, so without it a phone could run the new page with old scripts; with it, a changed script has a new address and is fetched fresh. The tests fail while a stamp is out of date.

The page sets a Content Security Policy (in `index.html`): scripts only from the site itself, data only from the site and the GitHub API, images from the site and YouTube thumbnails, and videos from youtube-nocookie.com. Since a phone may hold a GitHub key, nothing injected into the page can run. The web font loads after the first paint, so a slow connection never holds the page up.

The tests check:
- every average and range in the hand-checked tables: the brief's table against shots 001–036, and the full Nov 1 session, where the 5w uses only its 2 solid shots;
- the mis-hit and outlier rules, solid-contact rates and the highlight text;
- the progress baseline;
- the tips callouts and content;
- the player registry and data files;
- the paste parser, against the Toptracer screenshot rows (both whitespace and tab-separated) and a Rapsodo CSV;
- the game: the course's pars and yardages add up; every tee is within 12 yds of its scorecard yardage along the line of play and on a tee box, and every green and pin on its green; Lake Merced lies beyond the lake shore and out of bounds beyond the rest of the boundary; the lake down the left of 14–17, out of bounds down the left of 12, the 18th's carry over the inlet, the doglegs, the 1st fairway and the 2nd's bunkers are where the map has them; every tree stands in the rough; every hole has a fairway along its line; the heights match the course guides' climbs, uphill comes down sooner and downhill flies on, rolls go farther downhill and turn on a side slope, and on level ground nothing changes; a sloped lie turns the face by the loft; timing picks his best shots on the line and leans left when early and right when late; the real swing: swipes of known timing read back as their tempo (whatever the pace, with a pause, at 60 or 120 Hz), backswing, angle and strike, and a swipe that isn't a swing says why; each club's face and path from his shots (Dad's 5 hybrid open and fading, M3's 8 iron in-to-out and drawing); quick shuts the face and starts it left, slow opens it, and a left-hander's go the other way; up and to the right curves it left, more with a driver than a wedge; a shot built from a face and path reads back as the same; a perfect swing carries his pure-strike carry and half a backswing about half as far; rushed thins it, slow hits it fat, the heel shanks it; the aim's allowance for his shape; the tips; the swipe putt's length, pace and line and its odds; and a whole round with the real swing for each player; the shot types: which shots are on offer from each lie, a draw's or a fade's setup (it starts the other side of the line by as much as it curves back), each type's flight, the chip's club, stroke and roll, which shot a golfer would play (curving away from water, out of bounds or trees, round a bend, over a bunker to a tucked pin), and whether the planned shot came off; swinging the phone, with phones swung by numbers (60 readings a second, either hand, held upright or sideways, gravity either way round or none): the backswing, tempo, face and path read back, what isn't a swing, and the phone's face and path in the shot and the putt; the meters' pace (half a second to a short shot's power line, 0.85 s to any putt's line); power, lie and the driver off the turf; landing, rolling, trees, water, out of bounds and holing out; the putting odds; club suggestions and aim; and a whole round for each player;
- the shot replay: every real shot in the data files lands at its carry, bends by its curve, peaks at its apex and finishes at its total and offline; launch and landing angles; estimates for missing numbers; the tee box, side and green cameras keep the shot in view; drawing runs in every view; and Best 10's ranking (mis-hits and low launches left out, yards short of a pure strike plus yards off line, ties to the faster ball speed).

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
