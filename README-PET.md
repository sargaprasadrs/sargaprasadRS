# GitHub Profile Pet

A retro pixel **dragon Tamagotchi** powered by your live **GitHub GraphQL** data.
Feed it commits, keep the streak alive, play with it — and it grows from an
`EGG` to a `LEGENDARY` dragon as your profile does.

- Zero dependencies. Pure HTML/CSS/JS + one tiny Node server (optional).
- Your GitHub token **never touches the browser** when using proxy mode.
- Works instantly in **Demo Mode** if you don't have a token yet.

---

## Run it

### 1. Start the server

```bash
node server.mjs        # or: npm start
# - http://localhost:8787
```

That's it — no `npm install` needed. The server serves the page **and**
proxies `POST /graphql` to the GitHub GraphQL API.

### 2. Connect your GitHub (3 options, pick one)

| Mode | How | Where the token lives |
|------|-----|----------------------|
| **Proxy (safest)** | Copy `.env.example` to `.env`, add `GITHUB_TOKEN=ghp_…`, restart `node server.mjs` | Only on your machine/server |
| **Browser token** | Open Settings and paste the token | Only in your browser's localStorage |
| **Demo** | Click **DEMO MODE** on the connect screen | Nowhere — sample data |

### 3. Get a token (2 minutes)

1. Go to **github.com/settings/tokens** and choose **Generate new token (classic)**
2. Leave **every scope unchecked** — public data needs no permissions
3. Copy the `ghp_…` value into `.env` (recommended) or Settings

---

## How the pet works

**Stats feed:** every refresh (or click of `DATA`) the app runs one
GraphQL query against `user(login: …)` and computes:

- total contributions & **today's** contributions
- **current** & longest streak (from the contribution calendar)
- stars, repos, followers, PR reviews, issues
- top languages + recent repos

**Pet mapping:** activity drives energy, stars/followers/streaks drive happiness,
commits today drive fullness ("the dragon snacks on your pushes"). The pet
**decays in real time** (and while you're away — check back tomorrow!) and
levels up through 10 stages:

`EGG > HATCHLING > BABY > CHILD > TEEN > YOUNG > ADULT > VETERAN > ANCIENT > LEGENDARY`

**Moods:** content, hungry, sleepy, happy, excited (7+ day streak = fire
breathing), sleeping. Use Feed, Play, and Sleep, and click the dragon to pet it.

---

## Architecture

```
index.html     page + setup/settings modals
styles.css     neon-retro CRT theme
dragon.js      pixel sprite (26x24 grid) + animations + particles
github.js      GraphQL query, streak/stat computation, demo data
app.js         state, simulation loop, auth modes, UI wiring
server.mjs     zero-dep static server + /graphql proxy (.env token)
```

**Auth resolution order:** proxy-with-token, then browser token, then proxy-no-token, then
demo. The page auto-detects a proxy via `GET /graphql`.

## Deploy

- **Netlify / Vercel / GitHub Pages (static):** drag the folder in. Browser-token
  or demo mode only (no proxy). On Netlify you can also run `server.mjs` as a
  Node function if you want proxy mode.
- **Any Node host:** `node server.mjs` with `.env` for full proxy mode.
- Add a link from your profile README so visitors can meet your dragon.

## Security notes

- The GraphQL proxy forwards your token server-side; the browser only ever
  talks to your own origin.
- **Deploying the proxy publicly?** Anyone who can reach `/graphql` on that
  host could spend your token. Bind it to localhost (`PORT=8787` + firewall),
  add auth in front, or use the pure-static deploy (browser-token/demo modes).
- Classic PATs with **no scopes** are the least-privilege option for public
  data — treat the token like a password regardless.
- Demo mode & localStorage data are purely client-side.
