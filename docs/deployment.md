# Deployment

The advisor is a static Vite application. It has no server routes, database,
runtime secrets, analytics, or external API calls.

## Build

```bash
npm ci
npm run check
npm test
npm run build
```

Serve the generated `dist/` directory. Vite uses a relative asset base, so the
same build works at a domain root or a repository subpath.

## GitHub Pages

Use a workflow that installs Node.js 20, runs the commands above, and uploads
`dist/` with the official Pages artifact action. Configure Pages to deploy from
GitHub Actions. No SPA fallback is needed because the application uses
in-memory navigation on one document.

## Cloudflare Pages

Use:

- build command: `npm run build`
- output directory: `dist`
- Node.js version: 20 or newer

No Functions or environment variables are required.

## Definition updates

Definitions are bundled at build time. Publish a new build after changing YAML
or after updating the pinned upstream data revision. Do not load an unpinned
branch at browser runtime: that would make review, caching, and versioned
recommendations harder to reason about.

## Pre-deployment checks

- Confirm the footer and research notes name the upstream revision actually
  reviewed.
- Run `LABGRID_REQUIRED=1 npm run validate:labgrid` in an environment with the
  targeted Labgrid version installed.
- Review generated examples for secrets and private infrastructure names.
- Check desktop and mobile layouts and keyboard focus.
- Treat copied templates as incomplete while required placeholders remain.

