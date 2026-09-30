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

## 1. SportyBet Ghana (sportybet.com/gh)

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

## 2. Betway Ghana (betway.com.gh)

Repeat A, B and C:
- **A:** Betslip, then the load/enter **booking code** box.
- **B:** Add picks, then **Book a bet** / **Share** to get a code.
- **C:** Open a match page, and search for a team.

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
