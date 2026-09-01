# Publishing pi-message-sidebar

This package publishes to npm from GitHub Actions on tag push using **trusted
publishing (OIDC)**. No long-lived npm token is needed: npm exchanges the
short-lived GitHub OIDC token for publish access, and provenance attestations
are generated automatically.

One-time setup is required by Francesco on npmjs.com (2 minutes). For a new
package name, use the "Add a new package" flow on npmjs.com and register the
trusted publisher before the first publish:

1. On https://www.npmjs.com, under Packages, choose **Add a new package** and
   select the GitHub Actions trusted publisher option. Configure:
   - Organization or user: `Fornace`
   - Repository: `pi-message-sidebar`
   - Workflow filename: `publish.yml` (filename only, must exist in
     `.github/workflows/`)
   - Environment name: leave blank
2. npm does not verify the configuration until the first publish, so
   double-check the workflow filename.
3. Publish by pushing a tag or dispatching the workflow:

   ```bash
   git tag -a v<x.y.z> -m "..."
   git push origin v<x.y.z>
   # or, against an existing tag:
   gh workflow run publish.yml --repo Fornace/pi-message-sidebar --ref v<x.y.z>
   ```

The workflow (`.github/workflows/publish.yml`) runs on Node 24 with npm
11.16.0 (the minimum versions required for trusted publishing are Node
22.14.0 and npm 11.5.1), then runs typecheck, the test suite, the load test,
and a pack dry-run before `npm publish --access public`. The
`id-token: write` permission is required and already set.
Package-manager caching is disabled per npm's current trusted-publisher
guidance.

After the first successful trusted publish, consider restricting publishing
access to tokens (Settings -> Publishing access -> "Require two-factor
authentication and disallow tokens") for maximum security.
