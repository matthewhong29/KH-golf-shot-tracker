# KH Golf Shot Tracker

A phone-first web page that tracks Dad's golf shots. GitHub Pages serves it from `main`. All shot data lives in `data/dad_golf_data.json`, and the page reads that file every time it loads, so updating the file updates the site.

## Adding shots from a photo of a range screen

Dad takes photos of the Toptracer or Rapsodo screen and texts them to Matthew, who sends them here and asks for them to be added. Follow these steps.

1. **Read every row.** Toptracer's "All shots" screen has these columns: Time, Club, Flat carry (yds), Total (yds), Ball speed (mph), Launch (deg), Apex (ft), Landing (deg), Curve (ft), Offline (ft). Some screens also show Hang time (s).
   - Arrows: ◀ before a number means left (store it negative). ▶ after a number means right (positive). A bare 0 is 0.
   - Store values the screen doesn't show (no column, "-", blank) as `null`. Never guess a number you can't read clearly. Ask, or leave the row out and say so.
   - Clubs use these names: `PW`, `GW`, `SW`, `LW`, `9i` to `4i`, `5hy`/`4hy`, `3w`/`5w`, `Driver`. Toptracer shows "Sw", which becomes `SW`; "Pw" becomes `PW`; "5w" stays `5w`.
   - Times are 24-hour `HH:MM`, so "01:00 PM" becomes `13:00`.
2. **Pick the session.** Screens show times but not dates. Use the date Matthew gives. If he gives none, ask; photos can arrive days after the range session.
   - If a session already exists for the same date and venue, add the shots to it.
   - Otherwise create a session with id `{date}-{device}` (e.g. `2026-11-15-toptracer`). Give it `date`, `device`, `bay` or `location` if known, `shot_level_data: true`, `metrics_not_available` and `notes`, copying the shape of the existing sessions.
   - Overlapping screenshots are common. Skip any row the session already has (same time, club, carry, total and ball speed).
3. **Write the shots in time order.** Screens list the newest shot first, so reverse them. In an existing session, ids continue its sequence (e.g. `2026-11-01-049` after `2026-11-01-048`). A new session numbers its shots `{session id}-001`, `-002`, … (e.g. `2026-11-15-toptracer-001`), the same as the page does, so two sessions on one day never share an id. Use the same keys as the existing shots: `id, time, club, carry_yds, total_yds, ball_speed_mph, launch_deg, apex_ft, landing_deg, hang_time_s, curve_ft, offline_ft`. Add `club_speed_mph`, `spin_rpm` or `smash_factor` only when the device shows them. Add any new club to the top-level `clubs` map. If the photo cuts off rows, add a line to the session's `notes`.
4. **Check before committing.** Re-read your rows against the photo one more time. Then `node scripts/check-data.js` and `node tests/core.test.js` must both pass.
5. **Commit and push to `main`.** Matthew, the repo owner, approved pushing data updates straight to `main`, because that branch is what the website serves. If your session requires a different branch, ask once whether to push to `main`. Use a commit message like "Add 12 shots from 2026-11-01 (SW, 5w)". The site updates about a minute after the push.
6. **End with a short summary Matthew can forward to his dad:** shots per club, average carry per club, and anything notable, such as topped shots or misses to one side. Use plain words and keep it short and encouraging; his dad is a beginner.

Don't change `coaching_notes` unless asked. Don't commit the photos themselves unless asked, because the repo is public.

## Code

- `index.html`: markup and styles. `js/app.js`: the UI. `js/core.js`: stats, rounding and the paste parser; the node tests load it too.
- Tests: `node tests/core.test.js`. Data check: `node scripts/check-data.js`.
- Preview: run `python3 -m http.server 8000` in the repo root and open http://localhost:8000.
