# Capturing real bookmaker requests

The live adapters get built from what you capture here. Nothing about a bookmaker's API is guessed.

> Bookmakers' terms may restrict automated access. gameclaw keeps traffic low (a code is fetched once and then cached). Check each bookmaker's terms before switching a bookmaker to `live`.

## 0. Set up a clean browser (once)

1. In Chrome, click your profile picture (top right), then **Guest**. You'll use a Guest window with no logins, cookies or saved data. **Stay logged out** the whole time.
2. Open DevTools: `Cmd+Option+I` (Mac) or `F12` (Windows).
3. Go to the **Network** tab and set it up like this:
   - Tick **Preserve log**.
   - Tick **Disable cache**.
   - Click the **Fetch/XHR** filter.
4. Click the 🚫 icon to clear the log before each capture below.

## 1. SportyBet Ghana (sportybet.com/gh) — done, nothing needed from you

**Status: fully live.** Found by probing the public site logged out, with no account. All verified by
`VERIFY_LIVE=1 pnpm vitest run tests/bookmakers/sportybet-real.test.ts`, which books a real code and
reads it back:

| Endpoint | Gives us | Verified |
|---|---|---|
| `GET /api/gh/factsCenter/event?eventId={sr:match:N}&productId=3` | one event, every market and price | 2026-10-01 |
| `GET /api/gh/factsCenter/pcUpcomingEvents?sportId=sr:sport:1&marketId={ids}&pageSize=20&pageNum=1&option=1&timeline=48` | upcoming fixtures, with any markets priced inline | 2026-10-01 |
| `GET /api/gh/orders/share/{code}` | read a booking code | 2026-10-01 |
| `POST /api/gh/orders/share` | **create** a booking code | 2026-10-01 |

### Booking a code

```
POST /api/gh/orders/share
{"selections":[{"eventId":"sr:match:68931524","marketId":"18","outcomeId":"12","specifier":"total=2.5"}]}

-> {"bizCode":10000,"data":{"shareCode":"E2745T","deadline":1791744300000,
     "ticket":{"selections":[...]},"outcomes":[...],"unavailableOutcomes":[]}}
```

- No account, no login, no money: a booking code is a shareable selection list.
- `specifier` is required for markets with a line (18, 166, 139, 900342) and absent otherwise.
  Omitting it on a lined market books a **different line**, so it is carried through unchanged.
- `deadline` is the expiry, in epoch ms.
- `data.outcomes` is an array of full event objects — the same shape as the fixtures endpoints, with
  the picked market priced. Reading a code therefore needs no further requests.
- `unavailableOutcomes` holds picks that have dropped off (suspended market, started game).
- Discovered by POSTing `{}` and following the validation errors: the API names the field it wants.

### The inline-markets trick, which matters for cost

`pcUpcomingEvents` accepts **any** market ids in `marketId` and embeds them in the fixture list. That
is ~20 KB per fixture across eleven market groups, against **1.3 MB** for one fixture's full market
list. The slip builder and daily picks depend on this; see `INLINE_MARKET_IDS`.

Notes that matter:
- Both need `user-agent` and `referer: https://www.sportybet.com/gh/sport/football`; without them the
  API answers `bizCode 19003 Forbidden`.
- `bizCode` is the real status: `10000` success, `19000` invalid, `19001` not found, `19003` forbidden.
- Market and outcome ids are the Betradar/Sportradar set, mapped in
  `lib/bookmakers/formats/betradar-format.ts`. A top fixture carries ~1,350 markets.
- **Every outcome carries a `probability`, and they sum to 1.0 across a market.** That is SportyBet's
  own margin-free probability, so "estimated chance" never has to be modelled or invented.

### If SportyBet ever changes shape

`loadCode` reads `data.outcomes` directly. If that key ever disappears, it falls back to a reader
that extracts only the event id and market/outcome/specifier of each pick and prices them from the
event endpoint, logs `sportybet.share_outcomes_missing` with the shape it actually received, and
still never tells the user their real code is invalid.

### A. Load a booking code
1. Get a real code. Ask a friend for one, or make your own with step B first.
2. Clear the Network log.
3. On the site, open the **Betslip**, find the **booking code** box, type the code, and press **Load**.
4. Find the request that returned the slip. The easy way: press `Cmd+F` (Mac) or `Ctrl+F` inside the Network panel and search for a **team name** from the slip. The matching request is the one you want.
5. Click it and check the **Response** tab. It should list the games, markets and odds.

### B. Create (book) a new code
1. Clear the Network log.
2. Add 2 or 3 picks to the betslip. Use different markets: 1X2, Over/Under, GG/NG.
3. Press **Book Bet** (or whatever button gives you a booking code).
4. Find the request whose **Response** contains the new code (search for the code the site showed you).

### C. A match's full market list (needed for conversion)
1. Clear the log, then open any upcoming match to see all its markets.
2. Find the request whose response contains that match's markets and odds.
3. Also clear the log and use the site's **search** for a team name. Capture that request too.

## 1b. MSport Ghana (msport.com) — done, nothing needed from you

**Status: fully live.** MSport runs the same platform as SportyBet — both leak `com.hopegaming.*`
class names — so it uses **the same Sportradar event ids and the same Betradar market ids**. That is
what makes conversion between the two real: a pick carries across by id and only the price changes.

| Endpoint | Gives us | Verified |
|---|---|---|
| `GET /api/gh/facts-center/query/frontend/all-matches/next-7-days?sportId=sr:sport:1&pageSize=50&pageNum=1` | upcoming fixtures | 2026-10-01 |
| `GET /api/gh/facts-center/query/frontend/match/detail?eventId={sr:match:N}` | one event, ~240 markets | 2026-10-01 |
| `GET /api/gh/orders/real-sports/order/share/{code}` | read a booking code | 2026-10-01 |
| `POST /api/gh/orders/real-sports/order/share` | create a booking code | 2026-10-01 |

Traps worth knowing, all of them easy to get silently wrong:

- **`operId: 3` is a required header** on facts-center (3 = Ghana). Without it: `invalid operId`.
- **`markets[].id` is a number**, not a string, and the line is in **`specifiers`** (plural). Labels
  are `description`, not `desc`/`name`.
- The facts-center wraps 404s *inside* a `bizCode: 10000` envelope, so a good `bizCode` is not enough
  to tell success from failure — check for `data.error`.
- **`POST .../share` returns a code even when it accepted nothing.** An empty selection list still
  gets a code, and `originalSelectionCount` reads `0` even for good bookings, so it cannot tell them
  apart. `createCode` therefore reads the code back to confirm it is not empty before returning it.
- `bizCode` 19100 = expired, 19000 = invalid.

## 1c. Football.com Ghana (football.com/gh) — done, nothing needed from you

**Status: fully live.** Football.com runs the same platform as SportyBet with *identical* paths, so
it needed no new client: `lib/bookmakers/live/hopegaming.ts` is shared and Football.com only supplies
a base URL. Same Betradar market ids, same Sportradar event ids, so picks carry across by id.

| Endpoint | Gives us | Verified |
|---|---|---|
| `GET https://www.football.com/api/gh/factsCenter/pcUpcomingEvents?...` | fixtures, markets inline | 2026-10-01 |
| `GET .../factsCenter/event?eventId={id}&productId=3` | one event, every market | 2026-10-01 |
| `GET .../orders/share/{code}` | read a booking code | 2026-10-01 |
| `POST .../orders/share` | create a booking code | 2026-10-01 |

Found by sending one normal request: `orders/share/ABC123` returned SportyBet's exact `bizCode`
envelope. If a Ghanaian bookmaker answers that way, it is on this platform and connecting it is an
afternoon's work, not a reverse-engineering project.

## 2. Betway Ghana (betway.com.gh)

**Status: not connected, and harder than the others.** The site is a Nuxt app, but its sportsbook is
an embedded third-party feed (`feeds-roa.ragingriver.io`), so the booking code is not resolved by
Betway's own API. `/bookabet/{code}` and `/share-bet` are client routes, not endpoints: the first
redirects to `/sport/soccer/?bookingCode=X`. API hosts are `api.betwayafrica.com/api` and
`apic.betwayafrica.com/api`. The capture below is the way in.


Repeat A, B and C:
- **A:** Betslip, then the load/enter **booking code** box.
- **B:** Add picks, then **Book a bet** / **Share** to get a code.
- **C:** Open a match page, and search for a team.

## 2b. betPawa Ghana (betpawa.com.gh) — found, but blocked on protobuf

**Status: endpoints known, not implemented.** No account is needed to read a booking code, but the
response bodies are **protobuf**, not JSON.

| Endpoint | Gives us |
|---|---|
| `GET /api/sportsbook/v3/booking-number/{code}` | read a booking code (JSON errors, protobuf body) |
| `POST /api/sportsbook/v3/booking-number` | create one; takes `{"selections":[...]}` |
| `POST /api/sportsbook/v4/events/lists/by-queries` | fixtures |
| `POST /api/sportsbook/v3/prices/list` | odds |
| `GET /api/sportsbook/v4/categories/list/{id}` | categories (this one *is* JSON) |

Headers: `x-pawa-brand: betpawa-ghana`, `x-pawa-language: en`. Errors are
`{error, params, payload, uuid}`; a bad code gives `BOOKING_CODE_NOT_FOUND`.

**Why it stops here.** The schema is compiled into their generated protobuf code
(`proto-json-converter-*.js`), not shipped as a readable descriptor. Guessing field numbers would
risk silently mis-reading odds, which is the one mistake that must never ship. A DevTools capture
(step A below) unblocks it, because the browser shows the decoded body.

## 3a. 1xBet platform (1xBet, PariPesa, 22Bet, Betwinner) — markets solved, booking unverified

**Status: the booking-code endpoints are found and reachable without an account. One field shape is
still unconfirmed.** These four share a platform, so finishing one finishes all four. Working
domains, all confirmed on this platform by `LineFeed/GetSportsShortZip`:

| Bookmaker | Domain |
|---|---|
| 1xBet | `1xbet.com.gh` |
| PariPesa | `paripesa.top` (also `paripesa.ng`; `paripesa.bet` only redirects to a bonus page) |
| 22Bet | `22bet.com.gh` (`22bet.ng` redirects here; plain `22bet.com` does not resolve) |
| Betwinner | `betwinner.com.gh` |

None of them answer `/api/gh/orders/share`, so none is on the cheaper hopegaming platform.

### Where the endpoints live

They are *not* in the page or the host bundle. The betting screen is a separate Nuxt micro-frontend
whose script is named only inside the Nuxt payload, with `/` escaped as `\u002F`:

```bash
curl -s https://1xbet.com.gh/en/user/coupon | grep -o 'entry-[a-f0-9]*\.js'
curl -s https://1xbet.com.gh/sys-static/sys-betting-app-static/Mobile/Default/entry-<hash>.js
```

That bundle carries the whole betting API surface (192 `/service-api/` paths).

### Verified, no account needed

| Endpoint | Method | Gives us |
|---|---|---|
| `/service-api/LineFeed/GetSportsShortZip?lng=en` | GET | sports list |
| `/service-api/LineFeed/GetGameZip?id={id}&lng=en&cfView=0&isSubGames=true&GroupEvents=true` | GET | one event, markets and odds |
| `/service-api/LiveBet/Open/SaveCoupon` | POST | **creates a booking code** |
| `/service-api/LiveBet/Open/GetCoupon` | POST | **reads a booking code** |
| `/service-api/LiveBet-update/Open/UpdateCoupon` | POST | prices a slip |

```
POST /service-api/LiveBet/Open/SaveCoupon   {"Events":[ ... ],"Lng":"en"}
  -> {"Value":"BEMY7","Success":true,"ErrorCode":0}       <- the booking code

POST /service-api/LiveBet/Open/GetCoupon    {"guid":"BEMY7","CfView":0,"Lng":"en"}
  -> {"Success":false,"Error":"Incorrect code","ErrorCode":100849}   for a bad code
```

`guid` is the booking code despite the name: a wrong one answers "Incorrect code".

### The event shape, read from their own code

The `Events` item was not guessed. It comes from the serializer in their own bundle:

```js
// betting app bundle, verbatim
e => e.map(t => ({
  GameId: t.gameId, Type: t.typeId, Coef: t.coef, Param: t.param || 0,
  PV: null, PlayerId: t.playerId || 0, Kind: t.kind,
  InstrumentId: 0, Seconds: 0, Price: 0, Expired: 0, PlayersDuel: t.playersDuel
}))

var jt = (e => (e[e.LIVE = 1] = "LIVE", e[e.LINE = 3] = "LINE", e))(jt || {});
```

So one prematch pick is:

```json
{"Events":[{"GameId":756597520,"Type":1,"Coef":1.22,"Param":0,"PV":null,
            "PlayerId":0,"Kind":3,"InstrumentId":0,"Seconds":0,"Price":0,"Expired":0}],
 "Lng":"en"}
```

`GameId` is the feed's `I` (not `CI`), `Type` is the outcome's `T` and `Coef` its `C`, all from
`LineFeed/GetGameZip`. `Kind` is 3 for a prematch bet, 1 for live.

### What is left: two things, not one

**1. One verified booking.** Save a code with the body above, read it back with
`GetCoupon {"guid":"<code>","CfView":0,"Lng":"en"}`. If the picks come back, booking works.

That check was not run from here: sending bet-slip POSTs to a third party is blocked as attack-like
traffic, and the block is right — earlier rounds of trying shapes are exactly what it exists to stop.
Run those two requests yourself, or capture the `UpdateCoupon` body from DevTools, and paste either.

**2. ~~A market dictionary~~ — done, by a different route.** This platform ships numeric ids with no
labels (`{"T":1,"C":1.22,"G":1}`), and the names come from a translations service, so there was
nothing to read them off. But gameclaw writes its own labels anyway ("Over 2.5 goals"), so what was
actually needed was a mapping to our market model, not their display names.

That was derived without sending them anything:

- **Structure** from the platform's own table in its betting bundle, which declares which outcome
  types make up each group: `vn = {1:[1,2,3], 2:[7,8], 8:[4,5,6], 14:[182,183], 15:[11,12],
  17:[9,10], 62:[13,14], ...}`
- **Meaning** by comparing one fixture against a bookmaker that *does* label its data, at the same
  moment, and against the platform's own arithmetic — double chance `12` must price at
  `1/(1/1.22 + 1/14.70) = 1.126` from its own 1X2, and `T5` was `1.12`.

Verified, in `lib/bookmakers/formats/onex-format.ts`, re-checked against live data by
`tests/bookmakers/onex-format-real.test.ts`:

| Group | Types | Market | Corroboration (Germany v Serbia, 1xBet vs SportyBet) |
|---|---|---|---|
| `G1` | 1/2/3 | 1X2 | 1.22 / 6.95 / 14.70 vs 1.20 / 8.32 / 14.41 |
| `G8` | 4/5/6 | Double chance | self-consistent with its own 1X2 (above) |
| `G17` | 9/10 + `P` | Over/Under | brackets SportyBet's 2.0 and 3.0 lines |
| `G14` | 182/183 | Both teams to score | 1.83 / 1.87 vs 1.87 / 1.94 |
| `G2` | 7/8 + `P` | Asian handicap | T7 gives, T8 receives |
| `G15` | 11/12 + `P` | Home team total | 1.22 / 1.65 vs 1.21 / 1.66 |
| `G62` | 13/14 + `P` | Away team total | 1.80 / 4.40 vs 1.78 / 4.90 |

One trap: **the handicap line is written from each side's own perspective** — `T7 P-1` and `T8 P+1`
are the same bet — while ours is always home-relative. Mapping that wrong books the opposite
handicap, so the away side's line is negated and a test pins it.

Over 200 groups exist on a fixture. Everything not in that table maps to `null` rather than a guess,
and the earlier mock had guessed four of seven wrong (it had both-teams-to-score as `G19`/`T180`;
it is `G14`/`T182`), which is why nothing here is accepted without corroboration.

## Priority order

One capture each, in this order. It reflects how widely each is used in Ghana and how much a single
capture unlocks:

| # | Bookmaker | Capture | Unlocks |
|---|---|---|---|
| 1 | **1xBet** (`1xbet.com.gh`) | open a match page, then add one pick | **four bookmakers** — 1xBet, PariPesa, 22Bet, Betwinner share the platform. Needs both the `UpdateCoupon` body *and* the market names beside their numeric ids |
| 2 | **betPawa** | load a booking code | betPawa; the browser shows the decoded protobuf we cannot read from outside |
| 3 | **Betway** | load a code, book a code, open a match | Betway |
| 4 | **Football.com** | the same three | Football.com |

SportyBet and MSport need nothing: both are live, including booking codes.

## Steps for every other bookmaker

Do the same three captures (**A** load a code, **B** book a code, **C** a match page plus a team search) in a fresh Guest window, logged out:

| Bookmaker | Site | Where the booking code box usually is | What to name your files |
|---|---|---|---|
| 1xBet | 1xbet.com.gh | Bet slip → "Load bet slip" / coupon code | `1xbet-load.har`, `1xbet-book.har`, `1xbet-match.har` |
| betPawa | betpawa.com.gh | Betslip → "Load booking code" | `betpawa-*.har` |
| MSport | msport.com/gh | Betslip → booking code field | `msport-*.har` |
| Football.com | football.com/gh | Betslip → "Load code" | `footballcom-*.har` |
| Betwinner | betwinner.com | Bet slip → "Load bet slip" | `betwinner-*.har` |
| 22Bet | 22bet.com | Bet slip → "Load" | `22bet-*.har` |
| PariPesa | paripesa.com | Bet slip → "Load bet slip" | `paripesa-*.har` |

The exact button names change often; look for "booking code", "load", "coupon" or "share" around the betslip.

**Also collect 3 or 4 real codes per bookmaker** (from friends, Telegram or X). Their exact format (length, letters or digits) sharpens auto-detection. For now each adapter uses a broad placeholder pattern (`codeFormat` in `lib/bookmakers/<name>.ts`), and ties are settled by trying each matching bookmaker in parallel.

To switch a bookmaker to live once its adapter is implemented, set its environment variable to `live`, for example:
```bash
npx wrangler secret put ONEXBET_MODE   # value: live
```
The variables are `SPORTYBET_MODE`, `BETWAY_MODE`, `ONEXBET_MODE`, `BETPAWA_MODE`, `MSPORT_MODE`, `FOOTBALLCOM_MODE`, `BETWINNER_MODE`, `TWENTYTWOBET_MODE` and `PARIPESA_MODE`.

## 3. Save what you captured

### Option 1: HAR files (easiest)
1. In the Network panel, click the **download arrow** (⤓ "Export HAR"). Chrome's default export is **sanitized**: it leaves out cookies and auth headers.
2. Save the files into the project's `captures/` folder, which is git-ignored so it never gets committed. Use these names:
   ```
   captures/sportybet-load.har    captures/betway-load.har
   captures/sportybet-book.har    captures/betway-book.har
   captures/sportybet-match.har   captures/betway-match.har
   ```
3. Tell me they're there. I'll read them locally and check for anything sensitive before I use them.

### Option 2: paste into the chat
For each request, right-click it, then **Copy → Copy as cURL (bash)**. Then open the **Response** tab and copy the body. Paste it in this format:

````
### sportybet: load code
```bash
curl 'https://…' \
  -H 'accept: application/json' \
  -H 'content-type: application/json' \
  --data-raw '{…}'
```
Response (status 200):
```json
{ … }
```
````

## 4. What to remove before pasting (Option 2)

**Delete these:**
- Any `-H 'cookie: …'` line, and any `-b '…'` part.
- Headers named `authorization`, `x-auth…`, `x-token`, `x-csrf…`, `x-session…`, or anything containing `token` or `session`.
- In request bodies or URLs: phone numbers, user ids, device ids, account numbers, balances.

**Keep these:**
- The URL, including the query string.
- The method: `POST` or `GET` (a curl with `--data-raw` is a POST).
- `content-type`, `accept`, and other plain headers like `platform`, `operid`, `clientid` or `lang`.
- The full request body, and the response JSON.

**Don't:**
- Hand-edit the JSON structure.
- Trim responses mid-object. If a response is huge, keep 2 full games and cut at a clean boundary.
