# Development and publishing

- Publish requested development changes to the non-production preview so the user can validate them from home.
- Commit application source on `codex/preview-development`. Do not push `main` or promote to production without the user's explicit go-ahead.
- Publish the current build with `tools/publish-preview.ps1`. It deploys to the separate `mapdude334/longleaf-atlas-preview` repository and verifies production's main revision is unchanged.
- Preserve the preview's separate storage keys, offline cache names, OPFS directory and service-worker scope.
- Keep unrelated local files out of application commits.
