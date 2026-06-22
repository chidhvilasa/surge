# Privacy Policy — Surge (Chrome Extension)

Last updated: 2026-06-22

Surge is a board game with a self-improving local AI opponent. This
policy is short because the extension does very little with your data —
on purpose.

## No personal data is collected

Surge does not collect, request, or have any access to your name, email,
location, browsing history, or any other personally identifiable
information. There is no account, no sign-in, and no user identifier of
any kind.

## Everything stays on your device

The only data Surge stores is:

- **Game stats** — games played, wins/losses, current streak.
- **The AI's learned table** — the Monte Carlo Tree Search agent's
  accumulated experience from games played on this installation.

Both are stored using `chrome.storage.local`, which keeps data on your
own device, scoped to this one browser profile. Nothing is uploaded,
synced to an account, or shared with this or any other extension.

## Zero network calls

Surge makes no network requests of any kind. The rules engine and the AI
agent both run entirely inside your browser. There is no backend server,
no API, and nothing is ever sent over the network — not your gameplay,
not your stats, not anything else.

## No analytics, no tracking, no third parties

Surge includes no analytics SDKs, no crash reporters, no advertising
code, and no third-party libraries that phone home. No data is sold,
shared, or transferred to any third party, because no data ever leaves
your device in the first place.

## Uninstalling

Removing the extension deletes all of its locally stored data
(`chrome.storage.local` is cleared by Chrome when an extension is
uninstalled). Nothing persists anywhere else, because nothing was ever
sent anywhere else.

## Contact

This is a personal, open-source project. The full source code is public
at [github.com/chidhvilasa/surge](https://github.com/chidhvilasa/surge)
— you can verify everything in this policy by reading it directly.
