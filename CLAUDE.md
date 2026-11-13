# KH Golf Shot Tracker

A phone-first web page that tracks golf shots for Matthew's family. GitHub Pages serves it from `main`. The page reads the data files every time it loads, so updating a file updates the site.

## Players and data files

`data/players.json` lists the players. Each player has their own data file in the same format:

| Player | id (URL `?player=`) | File | About |
|---|---|---|---|
| Dad | `dad` | `data/dad_golf_data.json` | 56, 6′1″; has had lessons and knows the basics; older Lynx Black Cat irons (3 iron to PW), Callaway Edge 5 hybrid and driver |
| M3 (Matthew's brother) | `brother` | `data/brother_golf_data.json` | 14, 5′0″; has had lessons and knows the basics; plays for fun and wants to keep up with his friends on the team |

If it isn't clear whose photos they are, ask Matthew before adding anything.

A player's clubs are in the `equipment` block of his file: `equipment.bag` has one entry per club with its `model` and `loft_deg` (use `null` when the loft isn't known). Each loft sets that club's launch target, so when Matthew says a player has new clubs or gives their lofts, update the bag and leave the shot data alone.

The page itself also commits to `main`: on a phone with a GitHub key, every goal change is saved straight into that player's data file ("Update Dad’s goals from the tracker"). So run `git pull origin main` before editing any data file, and pull again if a push is rejected.

## Adding shots from a photo of a range screen

Dad or M3 takes photos of the Toptracer or Rapsodo screen and texts them to Matthew, who sends them here and asks for them to be added. Follow these steps.

1. **Read every row.** Toptracer's "All shots" screen has these columns: Time, Club, Flat carry (yds), Total (yds), Ball speed (mph), Launch (deg), Apex (ft), Landing (deg), Curve (ft), Offline (ft). Some screens also show Hang time (s).
   - Arrows: ◀ before a number means left (store it negative). ▶ after a number means right (positive). A bare 0 is 0.
   - Store values the screen doesn't show (no column, "-", blank) as `null`. Never guess a number you can't read clearly. Ask, or leave the row out and say so.
   - Record the club the screen shows, using these names: `PW`, `GW`, `SW`, `LW`, `9i` to `4i`, `5hy`/`4hy`, `3w`/`5w`, `Driver`. Toptracer shows "Sw", which becomes `SW`; "Pw" becomes `PW`; "5w" stays `5w`. Change a club only when Matthew says it was mislabelled.
   - Times are 24-hour `HH:MM`, so "01:00 PM" becomes `13:00`.
   - Keep every shot, including topped or fat ones. The page spots likely mis-hits by itself, leaves them out of the averages and shows them as hollow dots. It also spots outliers, solid shots far off a club's usual carry: they're left out of the averages too but still count as solid contact, and show as ringed dots. Never delete or skip a real shot to make the numbers look better.
2. **Pick the session.** Screens show times but not dates. Use the date Matthew gives. If he gives none, ask; photos can arrive days after the range session.
   - If that player already has a session for the same date and venue, add the shots to it.
   - Otherwise create a session with id `{date}-{device}` (e.g. `2026-11-15-toptracer`). Give it `date`, `device`, `bay` or `location` if known, `shot_level_data: true`, `metrics_not_available` and `notes`, copying the shape of the existing sessions.
   - Overlapping screenshots are common. Skip any row the session already has (same time, club, carry, total and ball speed).
   - Leave `baseline_session_id` alone. Dad's is his Aug 2026 Rapsodo session. M3's is `null`, which makes the page use each club's first session.
3. **Write the shots in time order.** Screens list the newest shot first, so reverse them. In an existing session, ids continue its sequence (e.g. `2026-11-01-049` after `2026-11-01-048`). A new session numbers its shots `{session id}-001`, `-002`, … (e.g. `2026-11-15-toptracer-001`), the same as the page does, so two sessions on one day never share an id. Use the same keys as the existing shots: `id, time, club, carry_yds, total_yds, ball_speed_mph, launch_deg, apex_ft, landing_deg, hang_time_s, curve_ft, offline_ft`. Add `club_speed_mph`, `spin_rpm` or `smash_factor` only when the device shows them. Add any new club to that player's top-level `clubs` map. If the photo cuts off rows, add a line to the session's `notes`.
4. **Check before committing.** Re-read your rows against the photo one more time. Then `node scripts/check-data.js` (it checks every player's file) and `node tests/core.test.js` must both pass.
5. **Commit and push to `main`.** Matthew, the repo owner, approved pushing data updates straight to `main`, because that branch is what the website serves. If your session requires a different branch, ask once whether to push to `main`. Use a commit message like "Add 12 shots for Dad from 2026-11-01 (SW, 5w)". The site updates about a minute after the push.
6. **End with a short summary Matthew can forward:** shots per club, average carry per club (solid shots), each club's new pure-strike carry from the Practice tab's "Your yardages", how many likely mis-hits and outliers there were, which clubs the page now marks "Needs work" (and any that dropped off the list), and anything notable, such as misses to one side or a club that went farther than last time. Use plain words, short and encouraging. Both have had lessons and know the basics, so skip beginner advice (grip, posture, ball position); for M3, keep it fun.

## Adding or updating goals

Each player file has a `personal_goals` list. The page pins the open ones at the top of every tab as a constant reminder.

- When Matthew asks for a goal ("add a coach goal for Dad: keep your head still"), append `{ "id": "goal-YYYY-MM-DD-N", "text": "...", "source": "coach", "added": "YYYY-MM-DD", "done": false }` to that player's `personal_goals`. Use `"coach"` for anything a coach or teacher gave him and `"me"` for his own goals. Use today's date and the next free N for that day.
- Keep the text short and in Matthew's words: something the player can read at a glance, ideally under 80 characters (the check warns past 140). Don't reword or merge goals.
- To mark a goal achieved, set `"done": true` rather than deleting it; the page moves it to a "Done" list. Delete only when asked.
- Then run the checks, commit (e.g. "Add a coach goal for Dad") and push to `main` as above.

## Swing reviews from a video

Matthew may send a swing video and ask for a review. The page shows it under Practice → Swing: the key frames with lines drawn on them, numbered notes, what's working, and the fixes linked to drills.

1. **Ask what isn't clear:** whose swing, the date, the club, and the view (face-on, or down the line from behind the hands). Never commit the video itself.
2. **Privacy:** the repo and the site are public. Before a player's first review, ask Matthew whether to blur faces (recommended for M3, who is 14), and use `--blur` when he says yes.
3. **Find the frames:** `python3 scripts/swing-frames.py probe VIDEO`, then `python3 scripts/swing-frames.py sheet VIDEO --out /tmp/sheet.jpg --every 0.05` and look at the sheet to find setup, the top of the backswing, impact and the finish (plus any frame that shows a problem best).
4. **Pull them out:** `python3 scripts/swing-frames.py extract VIDEO --out media/<player id>/<review id> --at 0.42:address,1.10:top,1.36:impact,2.05:finish` (add `--blur X,Y,W,H` for a face; `N:X,Y,W,H` for frame N only). The review id is `{date}-{club}-{view}`, e.g. `2026-11-15-7i-face-on`. It prints the `frames` JSON to start from.
5. **Mark them up:** look at each frame (`python3 scripts/swing-frames.py grid FRAME --out /tmp/grid.png` shows pixel coordinates). Mark only what is clearly visible, and say so when the camera angle makes something hard to judge. Never guess.
   - Marks: `type` is line, arrow, circle, box, angle, path or dot; `kind` is issue (orange), fix (green), good (blue) or ref (white guide); points are `[x, y]` in frame pixels; `dash: true` for guide lines; `label` up to 24 characters; `n` numbers a mark and matches the note with the same `n`.
   - Useful marks: a dashed line through the head at address, repeated on later frames to show head movement; the spine or shaft angle (`angle`); the hands against the ball at impact; the shaft plane down the line; a balance line at the finish.
6. **Write the review** into that player's `swing_reviews` list: `id, date, session_id` (if it matches a range session), `club, view, title, summary, video` (`duration_s`, `fps`), `frames` (each with `src, w, h, time_s, label, marks, notes`), `good` (short strings) and `fixes` (`{ "text": "...", "drill": "contact:0" }`; the drill is `focus id:drill number` in `js/tips.js`, so `contact:0` is the Towel drill). Keep the words short and encouraging, like the shot summaries.
7. **Check:** `node scripts/check-data.js` and `node tests/core.test.js` must pass. Then run `node scripts/review-preview.js <player id> <review id>` and look at every PNG to make sure each mark sits where it should.
8. **Commit and push** the frames and the data change to `main` ("Add a swing review for Dad: 7 iron, Nov 15"), then end with a short summary Matthew can forward: what's working, the one or two things to fix, and the drills for them.

## Coach videos and drill animations

Each drill in `js/tips.js` has `art`, its frames for the animation (`js/drillart.js` lists the scenes, poses and marks; 2–4 frames, captions up to 60 characters), and `video` when a coach's video has been found: `{ "id", "title", "by", "note" }`.

- Only use a YouTube id copied from a real search result or page. Never type one from memory or make one up.
- The listing must show the same drill (or the same skill) and come from a channel with a long track record of good instruction, such as Titleist, Rick Shiels, Me and My Golf, Danny Maude, Golf Monthly, Golf Digest, Golf Channel's School of Golf, PGA of America, or U.S. Kids Golf for juniors (or a nationally known teacher, such as a GOLF Top 100 Teacher). The videos can't be watched from here, so the channel's track record is the check. If you can't tell, leave `video` out; the page then shows a "Look it up on YouTube" search instead.
- When Matthew says a video is wrong or doesn't play, replace it or take it out.
- `node scripts/check-data.js` checks every drill's animation and video.

Don't change `coaching_notes` or the tips in `js/tips.js` unless asked. Don't commit the photos themselves unless asked, because the repo is public.

## Code

- `index.html`: markup and styles. `js/app.js`: the UI. `js/core.js`: stats, the mis-hit and outlier rules, rounding and the paste parser; the node tests load it too. `js/tips.js`: the Tips & drills content for each player, shown under the Practice tab (the tab's internal id is still `tips`; its sections are Range, Swing and Drills). `js/drillart.js`: the drill animations. `js/review.js`: swing review markup and its checks. `js/flight.js`: the Stats tab's shot replay (each shot's flight rebuilt from its numbers, the course and the cameras); it needs nothing beyond the usual shot keys, so there's nothing extra to record.
- Scripts: `scripts/swing-frames.py` pulls frames from a swing video; `scripts/review-preview.js` screenshots a review's frames as the page draws them.
- Tests: `node tests/core.test.js`. Data check: `node scripts/check-data.js`.
- Preview: run `python3 -m http.server 8000` in the repo root and open http://localhost:8000 (add `?player=brother` for M3).
