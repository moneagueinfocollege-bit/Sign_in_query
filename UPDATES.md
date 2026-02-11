# Remote updates via GitHub

The app checks for updates from **GitHub Releases**. Configure it once, then publish new versions by pushing releases.

## 1. Set your GitHub repo in `package.json`

Edit `package.json` and replace the placeholders with your GitHub username and repo name:

- **`repository.url`**: `https://github.com/moneagueinfocollege-bit/Sign_in_query.git`
- **`build.publish.owner`**: `moneagueinfocollege-bit`
- **`build.publish.repo`**: `Sign_in_query`

## 2. Publish a release (after building)

1. Build the app:
   ```bash
   npm run build
   ```

2. Create a new **Release** on GitHub:
   - Repo → **Releases** → **Create a new release**
   - Tag: e.g. `v1.0.0` (must match `version` in `package.json`)
   - Upload the installer from `release/` (e.g. the `.exe` or NSIS installer).

3. For **automated** publish from your machine (optional):
   - Create a **Personal Access Token** (GitHub → Settings → Developer settings → Tokens) with `repo` scope.
   - Run:
     ```bash
     set GH_TOKEN=your_token_here
     npm run build
     ```
   - electron-builder can publish the built files to the release if the token is set.

## 3. How the app updates

- **Packaged app**: On startup it checks for updates; it also checks every 4 hours. If a new version is found, it downloads in the background and then prompts: **Restart now** to install.
- **Manual check**: Use **Check for updates** on the home screen.
- **Dev mode** (`npm run dev`): Update checks are disabled.

## Version numbers

Bump `version` in `package.json` for each release (e.g. `1.0.1`, `1.1.0`). The updater only installs versions **newer** than the current one.
