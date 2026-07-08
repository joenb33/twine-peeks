# Releasing Twine Peeks

## Regular release

1. Bump `version` in [extension/manifest.json](../extension/manifest.json)
2. Add an entry to [CHANGELOG.md](../CHANGELOG.md)
3. Commit and push to `main`
4. Create the release (this also creates the tag):

   ```bash
   gh release create v1.9.0 --title "Twine Peeks v1.9.0" --notes "…"
   ```

5. Publishing the release triggers CI, which builds the `.xpi` and attaches
   it automatically. Don't push the tag separately first — the release event
   is the single trigger for asset upload.

## Firefox signing on AMO (for permanent installs)

Release Firefox only accepts signed extensions. Signing is free through
[addons.mozilla.org](https://addons.mozilla.org) (AMO), even for extensions you
don't want listed publicly.

**One-time setup:**

1. Create an account at <https://addons.mozilla.org>
2. Generate API credentials at
   <https://addons.mozilla.org/developers/addon/api/key/>
3. In the GitHub repo: Settings → Secrets and variables → Actions → add
   - `AMO_JWT_ISSUER` — the "JWT issuer" value
   - `AMO_JWT_SECRET` — the "JWT secret" value

**Before the first submission**, consider changing the add-on id in
`manifest.json` (`browser_specific_settings.gecko.id`, currently
`twine-devtools@addon.local`) to something permanent like
`twine-peeks@joenb33.github.io`. AMO ties the id to your account forever.
Note: changing the id makes Firefox treat it as a brand-new extension
(existing local settings are not migrated), which is why it hasn't been
changed casually.

**Signing:** go to Actions → CI → "Run workflow", tick **Sign the .xpi on
AMO**, and run. The signed `.xpi` appears as the `twine-peeks-signed`
artifact. The workflow uses the *unlisted* channel — the extension is signed
for self-distribution without appearing in the AMO catalog. For a public AMO
listing, change `--channel unlisted` to `--channel listed` in
[.github/workflows/ci.yml](../.github/workflows/ci.yml) and complete the
listing details on AMO.

**Chrome Web Store:** a separate process — create a developer account
(one-time $5 fee), zip `extension/`, and upload via the
[developer dashboard](https://chrome.google.com/webstore/devconsole). The same
zip built by CI works.
