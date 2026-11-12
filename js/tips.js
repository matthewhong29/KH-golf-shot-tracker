/*
 * Tips & drills, keyed by player id (data/players.json).
 * {name}, {height} and {age} are filled in from the player's data file.
 * callout: a "from your last session" line computed by GolfCore.sessionCallout
 * (mishits | launch | miss | carry); it's hidden until the player has shot data.
 * search: the YouTube search behind the drill's "Look it up" link, used when it has no video.
 * video: a coach's video of the drill { id (YouTube), title, by (the coach), note }; ids come from
 *   real search results, never made up.
 * art: the drill as 2–4 animated frames, drawn by js/drillart.js (scenes, poses and marks are listed there).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GolfTips = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  return {
    dad: {
      intro: 'Pick one focus for each practice session and stick with it. Every drill plays its steps as a moving picture, and most have a coach’s video to watch.',
      focus: [
        {
          id: 'contact',
          title: 'Solid contact first',
          why: 'Topped and thin shots cost the most distance, and they have shown up in both sessions so far: the PW in August and the 5 wood in November. Hitting the ball first, then brushing the ground just after it, fixes most of them.',
          callout: 'mishits',
          drills: [
            { name: 'Towel drill', reps: '2 sets of 10 balls', search: 'golf towel drill behind ball hit ball first',
              video: { id: 'VpySB09vqRE', title: 'Golf Swing Fundamentals: Controlling Low Point and Making Solid Contact', by: 'Tom Patri for Titleist' },
              art: { scene: 'swing', club: 'wedge', props: ['towel'], frames: [{ pose: 'address', cap: 'Towel 4–6 inches behind the ball', marks: ['gap'] }, { pose: 'halfBack', cap: 'Half swing back' }, { pose: 'impact', cap: 'Hit the ball first and miss the towel', marks: ['divot'] }, { pose: 'halfThru', cap: 'Half swing through' }] },
              steps: ['Lay a towel flat about 4–6 inches behind the ball.', 'Make half swings with a 9 iron or PW.', 'Miss the towel and hit the ball first. Touching the towel means the bottom of your swing is too far back.', 'When you miss the towel 5 times in a row, try full swings.'] },
            { name: 'Line drill', reps: '10 practice swings, then 10 balls', search: 'golf line drill ball first contact low point',
              video: { id: 'H1VuPW7-88s', title: 'Golf Line Drill for Better Contact', by: 'Debbie Doniger, LPGA and GOLF Top 100 Teacher' },
              art: { scene: 'swing', club: 'iron', props: ['line'], frames: [{ pose: 'address', cap: 'Ball just on the target side of the line' }, { pose: 'halfBack', cap: 'Half swing back' }, { pose: 'impact', cap: 'Brush the ground after the line', marks: ['brush'] }, { pose: 'halfThru', cap: 'Through to hip high' }] },
              steps: ['Draw a line on the ground, or lay a club across your stance.', 'Put the ball just on the target side of the line.', 'Make practice swings that brush the ground on the target side of the line, never behind it.', 'Hit balls with that same brush.'] },
            { name: 'Feet-together half swings', reps: '15 balls with a 9 iron', search: 'feet together golf drill',
              video: { id: 'fFH73XecQbs', title: 'Feet Together Drill - Improve Balance in the Golf Swing', by: 'Dan Whittaker Golf' },
              art: { scene: 'swing', club: 'iron', stance: 'together', frames: [{ pose: 'address', cap: 'Feet together, ball in the middle' }, { pose: 'halfBack', cap: 'Smooth half swing back, hip high' }, { pose: 'halfThru', cap: 'Hip high through, and stay balanced' }] },
              steps: ['Stand with your feet together and the ball in the middle.', 'Make smooth half swings, hip high to hip high.', 'Stay balanced until the ball lands. If you wobble, swing slower.'] },
            { name: 'Long club off a low tee', reps: '10 teed up, then 5 off the mat', search: 'hybrid fairway wood low tee drill sweep',
              video: { id: 'rqcltJwvozI', title: 'Why You Keep Topping Fairway Woods (It\'s Not What You Think)', by: 'Danny Maude, PGA coach' },
              art: { scene: 'swing', club: 'hybrid', ball: { tee: true }, frames: [{ pose: 'address', cap: 'Hybrid or 5 wood, ball on a low tee' }, { pose: 'top', cap: 'Smooth swing back' }, { pose: 'impact', cap: 'Sweep it off the tee; don’t chop down' }, { pose: 'finish', cap: 'All the way to a full finish' }] },
              steps: ['Tee the ball with your hybrid or 5 wood so it sits about a quarter inch above the grass.', 'Sweep it off the tee with a smooth, shallow swing. Don’t chop down.', 'After 5 good ones, lower the tee, then hit from the mat.'] }
          ]
        },
        {
          id: 'turn',
          title: 'Turn your body, not just your arms',
          why: 'The August swing video showed mostly arms with little body turn, a steep, handsy downswing and a short finish. Turning your chest back and through gives more power for less effort and makes contact easier to repeat.',
          drills: [
            { name: 'Towel under both arms', reps: '10 swings without a ball, then 10 balls', search: 'towel under arms golf drill connection',
              video: { id: 'FyU6qjJXk6Y', title: 'Ben Hogan\'s Golf Towel Drill - School of Golf', by: 'Martin Hall, PGA Teacher of the Year, on School of Golf' },
              art: { scene: 'swing', club: 'wedge', frames: [{ pose: 'address', cap: 'Towel tucked under both armpits', marks: ['armTowels'] }, { pose: 'halfBack', cap: 'Arms and chest turn back together', marks: ['armTowels'] }, { pose: 'halfThru', cap: 'Turn through; the towel stays put', marks: ['armTowels'] }] },
              steps: ['Tuck a small towel under both armpits.', 'Make half swings and keep the towel in place.', 'Your arms and chest turn together. If the towel drops, your arms got ahead.'] },
            { name: 'Cross-arm shoulder turn', reps: '10 slow turns each way, before you hit balls', search: 'cross arm shoulder turn golf drill',
              art: { scene: 'swing', club: 'cross', frames: [{ pose: 'crossAddr', cap: 'Club across your chest, in your posture' }, { pose: 'crossBack', cap: 'Turn until your front shoulder is under your chin', marks: ['chin'] }, { pose: 'crossThru', cap: 'Turn through until your chest faces the target', marks: ['chest'] }] },
              steps: ['Hold a club across your chest with your arms crossed.', 'Get into your golf posture.', 'Turn back until your front shoulder is under your chin.', 'Turn through until your chest faces the target.'] },
            { name: 'Hold your finish for 3 seconds', reps: 'Every shot in one block of 10', search: 'hold your finish golf balance drill',
              video: { id: '0hXNXt94hOI', title: 'THE FOLLOW THROUGH & FINISH POSITION - THE COMPLETE GOLF SWING GUIDE', by: 'Rick Shiels, PGA professional' },
              art: { scene: 'swing', club: 'iron', frames: [{ pose: 'address', cap: 'Your normal swing' }, { pose: 'impact', cap: 'Swing through toward the target' }, { pose: 'finish', cap: 'Belt buckle to the target; hold for 3', marks: ['timer', 'weight'] }] },
              steps: ['After each shot, finish with your belt buckle facing the target.', 'Weight on your front foot, back heel up, balanced.', 'Hold it for a slow count of three before you move.'] }
          ]
        },
        {
          id: 'hands',
          title: 'Hands ahead at impact',
          why: 'Your Lynx Black Cats have a little more loft than many new irons (the 7 iron is about 33°), and the launch targets on the Practice tab allow for that. Even so, launch runs above those targets on every iron, which usually means the hands are behind the ball at impact and add loft. With your hands slightly ahead of the ball, it flies lower and farther.',
          callout: 'launch',
          drills: [
            { name: 'Punch shots', reps: '10 balls with a 7 iron', search: 'golf punch shot drill hands ahead',
              video: { id: 'JxW8QXkVr_g', title: 'What You Need to Know About the Punch Shot in Golf', by: 'Joe Hallett for Titleist' },
              art: { scene: 'swing', club: 'iron', ball: { x: -6 }, frames: [{ pose: 'address', cap: 'Ball back of centre, hands a little ahead', marks: ['handsAhead'] }, { pose: 'punchBack', cap: 'Short backswing, about hip high' }, { pose: 'punchThru', cap: 'Short, low finish; the ball flies low', marks: ['flightLow'] }] },
              steps: ['Put the ball slightly back of center, with your hands a little ahead of it.', 'Make a short backswing, about hip high, and a short, low finish.', 'Keep the flight low. The ball should land and roll.'] },
            { name: 'Impact check in a mirror', reps: '5 holds of 5 seconds, a few days a week', search: 'golf impact position drill flat lead wrist mirror',
              video: { id: 'sMBLbUrXkrE', title: 'SIMPLE LESSON ON IMPROVING IMPACT POSITION - Rick Shiels Quest Golf Academy', by: 'Rick Shiels, PGA professional' },
              art: { scene: 'swing', club: 'iron', props: ['mirror'], frames: [{ pose: 'address', cap: 'Set up facing a mirror' }, { pose: 'impact', cap: 'Move slowly into impact; hold it 5 seconds', marks: ['handsAhead', ['hold', '5 s']] }, { pose: 'halfThru', cap: 'Then slow swings through that position' }] },
              steps: ['Take your setup facing a mirror at home.', 'Move slowly into impact: hands ahead of the ball, lead wrist flat, weight on your front foot.', 'Hold it for 5 seconds and check it in the mirror.', 'Then make slow swings through that position.'] }
          ]
        },
        {
          id: 'straight',
          title: 'Straighter long clubs',
          why: 'The miss grows to the right as the clubs get longer, and the long clubs start right before they curve. That usually points to an open clubface, so alignment and clubface control help most here.',
          callout: 'miss',
          drills: [
            { name: 'Alignment sticks', reps: 'Every shot in one block', search: 'alignment sticks golf setup drill',
              video: { id: 'Q8Y44h_MKx0', title: 'Improve Your Aim with these Alignment Stick Drills', by: 'John Kostis for Titleist' },
              art: { scene: 'swing', club: 'iron', props: ['sticks', 'target'], frames: [{ pose: 'address', cap: 'One stick at the target, one along your toes' }, { pose: 'top', cap: 'Feet, hips and shoulders parallel to them' }, { pose: 'finish', cap: 'Swing along the line to the target' }] },
              steps: ['Lay one stick or club pointing at your target, just outside the ball.', 'Lay a second one along your toes, parallel to the first.', 'Set your feet, hips and shoulders parallel to them before every shot.'] },
            { name: 'Toe up to toe up', reps: '10 swings, then 10 balls with the 7 iron and 5 with a long club', search: 'toe up to toe up golf drill',
              art: { scene: 'swing', club: 'iron', frames: [{ pose: 'address', cap: 'Half swings with a 7 iron' }, { pose: 'halfBack', cap: 'Halfway back, the toe points at the sky', marks: ['toeUp'] }, { pose: 'halfThru', cap: 'Halfway through, the toe points up again', marks: ['toeUp'] }] },
              steps: ['Make half swings with a 7 iron.', 'Halfway back, the toe of the club points at the sky.', 'Halfway through, it points at the sky again.', 'That turn of the clubface is what squares it at impact.'] },
            { name: 'Gate drill for start line', reps: '10 balls with the hybrid or 5 wood', search: 'golf start line gate drill',
              art: { scene: 'swing', club: 'hybrid', props: ['gate'], frames: [{ pose: 'address', cap: 'Two tees 3 feet ahead, on your target line', marks: ['startLine'] }, { pose: 'top', cap: 'Your normal swing' }, { pose: 'finish', cap: 'Start the ball through the gate', marks: ['startLine'] }] },
              steps: ['Push two tees into the ground about 3 feet in front of the ball, on your target line, a few inches wider than a ball.', 'Hit shots that start through the gate.', 'If they start right of it, check your grip and alignment first.'] }
          ]
        },
        {
          id: 'fit',
          title: 'Your Black Cats for a {height} golfer',
          why: 'You’re playing an older set of Lynx Black Cat irons. With any older set, two things are worth checking: the grips and the fit. Old grips get hard and slick, and a grip that slips lets the clubface open at impact, which is one common cause of shots going right. Older sets were also usually built at standard length, and clubs that are short for a {height} golfer can make you hunch over the ball, which leads to thin shots. Fitting charts typically suggest about ½ to 1 inch longer than standard and a slightly more upright lie for someone your height, but the right numbers depend on your wrist-to-floor measurement and your swing, so let a fitter decide, and ask whether your set can be adjusted.',
          drills: [
            { name: 'Club check at a golf shop', reps: 'Once now; the grips about once a year', search: 'golf club fitting wrist to floor measurement length lie',
              art: { scene: 'swing', club: 'iron', frames: [{ scene: 'grip', worn: true, cap: 'Shiny, hard or cracked grips are worn' }, { pose: 'stand', cap: 'Measure from your wrist crease to the floor', marks: ['measure'] }, { pose: 'address', cap: 'A fitter checks length, lie and grip size' }] },
              steps: ['Look at the grips: shiny, hard, cracked or smooth spots mean they’re worn. If the 7 iron twists or slips when you hold it lightly, it’s worn.', 'Stand up straight in golf shoes with your arms relaxed, and have someone measure from the crease of your wrist to the floor.', 'Take that number and your 7 iron to a club fitter or golf shop.', 'Ask them to check the length, lie angle and grip size, and to regrip the set if the grips are worn. Regripping doesn’t cost much.'] },
            { name: 'Use your own yardages', reps: 'Every time you pick a club', search: 'golf club yardages how far each club goes',
              video: { id: 'a-BJyJz67uA', title: 'How to Find Your Stock Yardages with Joanna Coe', by: 'Joanna Coe for Titleist' },
              art: { scene: 'range', flags: [['PW', 0.36], ['7i', 0.6], ['5hy', 0.88]], frames: [{ step: 1, cap: 'Learn how far your own PW carries' }, { step: 2, cap: 'Then your 7 iron' }, { step: 3, cap: 'Then your hybrid. Pick clubs by your numbers' }] },
              steps: ['Your Black Cats have more loft than many new irons, so the same number goes a little shorter than a friend’s new club.', 'Pick clubs from Your yardages on the Practice tab, not from the number on the club.', 'The yardages update after every range session.'] },
          ]
        },
        {
          id: 'plan',
          title: 'One-bucket practice plan',
          why: 'A small bucket with a plan beats a big bucket of random swings. Work on one focus each time, and finish with a few “test” shots for the tracker.',
          drills: [
            { name: 'The bucket', reps: 'One small bucket, about 50 balls', search: 'golf practice plan one bucket',
              video: { id: 'W-nm8xfQAiI', title: 'Your Ultimate Driving Range Session', by: 'Rick Shiels for Golf Monthly' },
              art: { scene: 'plan', blocks: [['Warm-up', 10, '10 balls'], ['Drill block', 20, '20 balls'], ['Switch clubs', 20, '20 balls']], frames: [{ step: 0, cap: 'Warm up with 10 half-swing wedges' }, { step: 1, cap: 'Drill block: 20 balls on today’s focus' }, { step: 2, cap: 'Switch clubs every shot, with your routine' }] },
              steps: ['Pick one focus from this page for today.', 'Warm up with 10 half-swing wedges.', 'Drill block: 20 balls on that focus’s drill.', 'Then switch clubs every shot (for example PW, 7 iron, hybrid) with your full routine: pick a target, line up, one practice swing, hit.'] },
            { name: 'Test shots for the tracker', reps: '5–10 shots', search: 'toptracer range how to see shot data',
              video: { id: 'gRUjsGgeC4Y', title: 'Toptracer Range - How to Get Started', by: 'Toptracer' },
              art: { scene: 'tracker', shots: '5–10 shots', frames: [{ step: 0, cap: 'Finish with 5–10 shots on Toptracer' }, { step: 1, cap: 'Open the All shots screen' }, { step: 2, cap: 'Take a photo that shows every row' }, { step: 3, cap: 'Text the photo to Matthew' }] },
              steps: ['Finish with 5–10 shots on Toptracer, thinking about today’s focus.', 'Open the “All shots” screen and take a photo that shows every row.', 'Text the photo to Matthew so it goes into this tracker.'] }
          ]
        }
      ],
      lesson: 'These work best with a second pair of eyes. A lesson or two with a PGA coach can check your grip, setup and turn in person and tell you which focus matters most right now.'
    },

    brother: {
      intro: 'Hey {name}! Pick one thing to work on each time you practice. Every drill shows its steps as a moving picture, and most have a coach’s video too.',
      focus: [
        {
          id: 'clubs',
          title: 'Clubs that fit you',
          why: 'At {height}, adult clubs are too long. Clubs that are too long make you stand too far from the ball and cause topped and fat shots. Junior clubs, or clubs cut to your size, make good contact way easier. Get them checked again as you grow.',
          callout: 'mishits',
          drills: [
            { name: 'Quick fit check', reps: 'Once, then again every couple of inches you grow', search: 'junior golf club fitting by height',
              video: { id: 'GOUcGOozECo', title: 'U.S. Kids Golf Fitting System', by: 'U.S. Kids Golf' },
              art: { scene: 'swing', club: 'iron', frames: [{ pose: 'address', cap: 'Take your normal setup with a 7 iron' }, { pose: 'address', cap: 'Toe sticking way up? The club is too long', marks: ['tooLong'] }, { pose: 'address', choke: 12, cap: 'Gripping down past the grip? Too long', marks: [['choke', 'too long']] }] },
              steps: ['Take your normal setup with a 7 iron.', 'If you have to grip down past the bottom of the grip, or the toe sticks way up in the air, the club is too long.', 'Show your coach or a club fitter. Junior sets come in sizes by height.'] },
            { name: 'Choke-down test', reps: '10 balls each way', search: 'choke down golf club drill juniors',
              video: { id: 'JEV8FohQTlk', title: 'David Leadbetter GolfWRX Swing Tips: Choke down for control', by: 'David Leadbetter for GolfWRX' },
              art: { scene: 'swing', club: 'iron', frames: [{ pose: 'address', cap: 'Hit 10 balls gripping normally' }, { pose: 'address', choke: 9, cap: 'Then 10 gripped down about an inch', marks: ['choke'] }, { pose: 'impact', choke: 9, cap: 'Keep the way that hits it better' }] },
              steps: ['Until your clubs fit, grip down about an inch on each club.', 'Hit 10 balls gripping normally, then 10 gripped down.', 'See which way gives you better contact.'] }
          ]
        },
        {
          id: 'strike',
          title: 'Better ball-striking',
          why: 'You already know the basics, so the next step is the strike: ball first, then the ground, and the ball starting where you aimed. These are the drills good players use to get there.',
          drills: [
            { name: 'Towel drill', reps: '2 sets of 10 balls', search: 'golf towel drill behind ball hit ball first',
              video: { id: 'VpySB09vqRE', title: 'Golf Swing Fundamentals: Controlling Low Point and Making Solid Contact', by: 'Tom Patri for Titleist' },
              art: { scene: 'swing', club: 'wedge', props: ['towel'], frames: [{ pose: 'address', cap: 'Towel 4–6 inches behind the ball', marks: ['gap'] }, { pose: 'halfBack', cap: 'Half swing back' }, { pose: 'impact', cap: 'Hit the ball first and miss the towel', marks: ['divot'] }, { pose: 'halfThru', cap: 'Half swing through' }] },
              steps: ['Lay a towel flat about 4–6 inches behind the ball.', 'Make half swings with a 9 iron or PW.', 'Miss the towel and hit the ball first. Touching the towel means the bottom of your swing is too far back.', 'When you miss the towel 5 times in a row, try full swings.'] },
            { name: 'Gate drill for start line', reps: '10 balls with the hybrid or 5 wood', search: 'golf start line gate drill',
              art: { scene: 'swing', club: 'hybrid', props: ['gate'], frames: [{ pose: 'address', cap: 'Two tees 3 feet ahead, on your target line', marks: ['startLine'] }, { pose: 'top', cap: 'Your normal swing' }, { pose: 'finish', cap: 'Start the ball through the gate', marks: ['startLine'] }] },
              steps: ['Push two tees into the ground about 3 feet in front of the ball, on your target line, a few inches wider than a ball.', 'Hit shots that start through the gate.', 'If they start right of it, check your grip and alignment first.'] },
            { name: 'Punch shots', reps: '10 balls with a 7 iron', search: 'golf punch shot drill hands ahead',
              video: { id: 'JxW8QXkVr_g', title: 'What You Need to Know About the Punch Shot in Golf', by: 'Joe Hallett for Titleist' },
              art: { scene: 'swing', club: 'iron', ball: { x: -6 }, frames: [{ pose: 'address', cap: 'Ball back of centre, hands a little ahead', marks: ['handsAhead'] }, { pose: 'punchBack', cap: 'Short backswing, about hip high' }, { pose: 'punchThru', cap: 'Short, low finish; the ball flies low', marks: ['flightLow'] }] },
              steps: ['Put the ball slightly back of center, with your hands a little ahead of it.', 'Make a short backswing, about hip high, and a short, low finish.', 'Keep the flight low. The ball should land and roll.'] }
          ]
        },
        {
          id: 'short',
          title: 'Short game: the fastest way to keep up',
          why: 'About half the shots in a round happen on or around the green. Getting up and down saves more shots than hitting it farther, and it’s where you can catch your friends fastest.',
          drills: [
            { name: 'Putting ladder', reps: 'Climb the ladder 3 times', search: 'putting ladder drill',
              video: { id: '_Jd1ldRP1yU', title: 'Ladder Drill - School of Golf', by: 'Katie Detlefsen, LPGA, on School of Golf' },
              art: { scene: 'green', game: 'ladder', frames: [{ step: 1, cap: 'Make the 3-footer to move up' }, { step: 2, cap: 'Then 6 feet' }, { step: 3, cap: 'Then 9 feet. Miss and you drop back' }, { step: 4, cap: 'Climb all the way to 12 feet' }] },
              steps: ['Put tees at 3, 6, 9 and 12 feet from a hole.', 'Make the 3-footer to move up to 6 feet, and so on.', 'Miss and you drop back down a step.', 'Climb all the way to the top.'] },
            { name: 'Around the world', reps: '3 rounds', search: 'around the world putting drill',
              video: { id: 'IukApU3-Uys', title: 'Dave Pelz - 3 Foot Putting Circle Drill Golf Tip', by: 'Dave Pelz, short-game coach' },
              art: { scene: 'green', game: 'world', frames: [{ step: 0, cap: '6 balls in a circle, 3 feet from the hole' }, { step: 1, cap: 'Make them all in a row. Miss? Start over' }, { step: 2, cap: 'All 6 in a row' }, { step: 3, cap: 'Then move the circle out to 4 feet' }] },
              steps: ['Put 6 balls in a circle, 3 feet around a hole.', 'Make them all in a row.', 'Miss one? Start over.', 'Got all 6? Move the circle out to 4 feet.'] },
            { name: 'Up-and-down game', reps: '2 rounds of 5 balls', search: 'up and down chipping game golf',
              video: { id: 'vjXAIwK6NTs', title: 'Short Game Practice: Can You Shoot 21?', by: 'Dave Phillips for Titleist' },
              art: { scene: 'green', game: 'updown', frames: [{ step: 0, cap: 'Drop 5 balls around a green' }, { step: 1, cap: 'Chip one close' }, { step: 2, cap: 'Putt it out' }, { step: 3, cap: 'In with 2 shots? Count it, and beat your score' }] },
              steps: ['Drop 5 balls in different spots around a green.', 'Chip each one, then putt it out.', 'Count how many you finish in 2 shots or fewer.', 'Beat that score next time.'] }
          ]
        },
        {
          id: 'speed',
          title: 'Speed and distance, the fun way',
          why: 'Swinging faster is a skill you can train, and knowing how far each club goes helps you pick the right one. After a range session, the carry chart on the Stats tab shows your numbers.',
          callout: 'carry',
          drills: [
            { name: 'Whoosh drill', reps: '3 sets of 5 swings', search: 'golf whoosh drill swing speed',
              video: { id: 'ra5oa4kzHL4', title: 'Improve your swing speed with the "swoosh drill"', by: 'Piers Ward, PGA professional', note: 'The same idea with an alignment stick' },
              art: { scene: 'swing', club: 'reversed', ballShown: false, frames: [{ pose: 'address', cap: 'Hold the club upside down, below the head' }, { pose: 'top', cap: 'Full swing back' }, { pose: 'halfThru', cap: 'Make the loudest whoosh past the ball', marks: ['whoosh'] }] },
              steps: ['Flip a club upside down and hold it just below the head.', 'Make full swings and make the loudest “whoosh” in front of you, past where the ball would be.', 'Do 5 swings the other way around too.', 'Then hit 5 balls with your normal swing.'] },
            { name: 'Know your carry', reps: '5 shots per club', search: 'how far should each golf club go juniors',
              video: { id: 'a-BJyJz67uA', title: 'How to Find Your Stock Yardages with Joanna Coe', by: 'Joanna Coe for Titleist' },
              art: { scene: 'range', flags: [['Wedge', 0.3], ['7 iron', 0.56], ['Driver', 0.9]], frames: [{ step: 1, cap: 'Hit 5 shots with each club on Toptracer' }, { step: 2, cap: 'See how far each club carries' }, { step: 3, cap: 'On the course, pick the club that matches' }] },
              steps: ['At the range, hit 5 shots with each club on Toptracer.', 'Take a photo of the screen and text it to Matthew.', 'Check the Stats tab: the carry chart shows how far each club goes.', 'On the course, pick the club whose carry matches the distance.'] }
          ]
        },
        {
          id: 'games',
          title: 'Games to play with friends',
          why: 'Practice is more fun when somebody wins. These games sharpen the shots that matter most.',
          drills: [
            { name: 'Closest to the pin', reps: 'One game to 5 points', search: 'closest to the pin game golf',
              video: { id: '-BU4bdAtK1k', title: 'RICK Vs DANNY WILLETT - NEAREST THE PIN COMP', by: 'Rick Shiels Golf' },
              art: { scene: 'green', game: 'closest', frames: [{ step: 0, cap: 'Everyone hits one ball at the same flag' }, { step: 1, cap: 'See whose ball finished closest' }, { step: 2, cap: 'Closest gets a point. First to 5 wins' }] },
              steps: ['Everyone picks the same flag or target.', 'Each player hits one ball.', 'Closest ball gets a point.', 'First to 5 points wins.'] },
            { name: 'Chipping HORSE', reps: 'One full game', search: 'chipping horse golf game',
              art: { scene: 'horse', frames: [{ step: 0, cap: 'The first player picks a chip shot' }, { step: 1, cap: 'Within a club length? Everyone matches it' }, { step: 2, cap: 'Miss and you get a letter' }, { step: 3, cap: 'Spell HORSE and you’re out' }] },
              steps: ['Like basketball HORSE: the first player picks a chip shot.', 'If it stops within a club length of the hole, everyone else has to match it.', 'Miss and you get a letter.', 'Spell HORSE and you’re out.'] }
          ]
        },
        {
          id: 'plan',
          title: '30–45 minute practice plan',
          why: 'Short, focused practice beats smashing a big bucket. Spend most of the time on the short game.',
          drills: [
            { name: 'The plan', reps: '30–45 minutes', search: 'junior golf practice plan',
              art: { scene: 'plan', blocks: [['Warm-up', 5, '5 min'], ['Short game', 18, '15–20 min'], ['Full swings', 12, '10–15 min'], ['Game', 5, '5 min']], frames: [{ step: 0, cap: 'Warm up: stretches and 10 half swings' }, { step: 1, cap: 'Short game: ladder, then up-and-down' }, { step: 2, cap: 'Full swings: 3 clubs, 5 balls each' }, { step: 3, cap: 'Finish with a game' }] },
              steps: ['Warm up, 5 minutes: easy stretches and 10 half swings with a wedge.', 'Short game, 15–20 minutes: the putting ladder, then the up-and-down game.', 'Full swings, 10–15 minutes: 3 clubs, 5 balls each, with a few whoosh swings in between.', 'Finish with a game, 5 minutes: closest to the pin or chipping HORSE.'] },
            { name: 'Track it', reps: '5 shots', search: 'toptracer range how to see shot data',
              video: { id: 'gRUjsGgeC4Y', title: 'Toptracer Range - How to Get Started', by: 'Toptracer' },
              art: { scene: 'tracker', shots: '5 shots', frames: [{ step: 0, cap: 'Finish with 5 shots on Toptracer' }, { step: 2, cap: 'Take a photo of the screen' }, { step: 3, cap: 'Text it to Matthew' }] },
              steps: ['At the range, finish with 5 shots on Toptracer.', 'Take a photo of the screen and text it to Matthew.', 'Watch your numbers show up on the Stats and Progress tabs.'] }
          ]
        }
      ],
      lesson: 'Ask your team coach, or book a lesson with a PGA coach, to check your grip, setup and clubs in person. A quick look from a coach goes a long way.'
    }
  };
});
