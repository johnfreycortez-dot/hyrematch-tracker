# HyreMatch Tracker (desktop app), version 2.0.2

A small Windows / Mac app for hired talent. While they are clocked in on hyrematch.com (My work), it counts how many
minutes the computer is in use and how many it is idle, in 10-minute blocks, and sends them to the HyreMatch backend
(Tracker.gs). Admins see it on the Activity page.

## What it does and doesn't do
- Counts active / idle time only while the person is clocked in. It pauses on lunch and breaks and stops at clock out.
- Idle = no mouse or keyboard for 1 minute or more. It reads one number from the operating system ("seconds since the
  last input"). It never reads keys, window titles, websites, files, camera or microphone.
- Checks in with HyreMatch every 2 minutes while tracking: "I'm online, active or idle", with the running totals of the
  current 10-minute block. If the check-ins stop, the admin Activity page shows "Disconnected" after about 5 minutes
  and the person gets an email after about 10.
- Screen monitoring is the client's choice, per client. Only when it is on for this person's client: one JPEG of every
  monitor (up to 3), 1280 px wide, at a random moment in each 10-minute block, only while active. Only the client sees
  them (client area). The HyreMatch team does not. No video.
- Nothing is tracked until the person ticks "I accept" on the terms screen. If their client turns screen monitoring on
  later, the app asks again and tracks nothing until they accept.
- Starts with the computer, quietly near the clock (2.0.2). The tray menu has "Start with the computer" to turn that off.
- Works offline: time is kept (up to about 25 hours) and sent when the connection is back. The window says "Offline".
- If the person walks away while clocked in, the time is recorded as idle (it is not hidden).
- The sign-in (same email code as the candidate area) is stored encrypted by the operating system.

## Run it from the source
1. Install Node.js 20 or newer.
2. In this folder: `npm install`
3. `npm start`
4. `npm test` checks the counting rules (no network needed).

## Make the installers
GitHub builds them: Actions tab > "Build installers" > Run workflow. It runs the tests, builds the Windows (.exe) and
Mac (.dmg, Intel + Apple Silicon) installers, starts each app once to make sure it opens, and puts both on a Release.
Copy the two links into the admin area: Activity > Tracker app links.

### Signing (so Windows and macOS don't warn people)
- Windows: without a code-signing certificate, SmartScreen shows "Windows protected your PC" and people click
  "More info" > "Run anyway". A certificate costs money every year.
- Mac: without an Apple Developer ID (US$99 a year) and notarization, macOS blocks the first open. People open it once
  from System Settings > Privacy & Security > "Open Anyway" (older macOS: right-click > Open). Screenshots on a Mac
  also need Screen Recording allowed in System Settings (the app shows the step).

## Files
- `main.js`: window, tray icon, sign-in storage, screenshot capture.
- `lib/engine.js`: the counting rules (blocks, idle, offline queue). Tested by `test/engine.test.js`.
- `lib/api.js`: calls `https://hyrematch.com/api/candidate` (ops `track.me`, `track.consent`, `track.beat`).
- `renderer/`: the window (sign in, terms, status).

## Not done yet
- The installers are not signed (see above).
- No auto-update: a new version means sending a new installer link.
