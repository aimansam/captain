# Contributing

Thanks for helping! Bug reports, ideas and pull requests are all welcome.

## Setup

```bash
cd server && npm install
DEMO=true ADMIN_PASSWORD=demo npm start     # fake data, no Docker needed
cd web && npm install && npm run dev        # separate terminal, hot reload
```

Run the tests with `cd server && npm test`.

## Guidelines

- Keep it small and dependency-light. Prefer a few lines over a new package.
- Anything destructive (removing containers, volumes, images) must be explicit, previewed and refused when it would hit something in use.
- Add a test for new API behaviour. The demo backend (`server/src/demo.js`) mirrors `docker.js`; keep them in sync.
- Match the surrounding style. There's no formatter to run.

## Pull requests

Describe what changed and why, and include a screenshot for UI changes. Small, focused PRs are reviewed fastest.
