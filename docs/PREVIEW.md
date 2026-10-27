# Online preview

The preview lives at https://mapdude334.github.io/longleaf-atlas-preview/ in its own repository. The main app remains at https://mapdude334.github.io/longleaf-outdoors/.

Requested development changes are committed on `codex/preview-development` and published to the preview for user validation. Do not promote changes to production or push `main` until the user explicitly approves a production release. Region selection fits the mapped centers of the destinations offered in that region's dropdown; a region with no cataloged locations retains its geographic bookmark.

Run `pwsh -File tools/publish-preview.ps1` from the work machine to build and publish the current working files to the preview repository. GitHub Actions deploys the compiled output. This does not commit or push changes to the main app repository. A stored GitHub credential for mapdude334 is required; credentials are read into memory and are not included in the deployment.

Preview builds use `VITE_PREVIEW=true`, `BASE_PATH=/longleaf-atlas-preview/`, and the existing production tile URL. The preview labels itself as a test version and uses separate local/session storage keys, offline cache names, and an OPFS subdirectory. Service-worker and asset paths remain within the preview scope. Saved trips and map downloads in the main app are not reused or deleted by the preview.

The preview is publicly reachable by link. It contains the app and public catalogs, not the developer's saved trips, fishing pins, credentials, or unrelated local files. These preview updates do not expand the geographic coverage of the published map archives.
