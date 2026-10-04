# Rendra IDE — Agent Working Guide

Autor: Bruno Magalhaes, brunomagalhaes.me, instagram.com/brunomagalhaes.me.

Instructions for coding agents working on this repository (Codex reads `AGENTS.md`; Claude Code
reads `CLAUDE.md`, which imports this file and adds the maintainer's release manual). The project
follows the "Padrão dos produtos Rendra"; the Rendra Design System (`bsmagalhaes/rendra-ui-web`)
is the living reference.

## Project Overview
Rendra IDE (npm package `@rendra-ui/ide`, private until published) is an Electron desktop app for
Windows, macOS and Linux. It combines a small IDE (workspaces, file explorer with git colors,
Monaco editor, terminals) with a token-usage dashboard for Claude Code and Codex CLI, and
integrates RTK to cut tokens. It is distributed as source: `git clone` + `npm install` + `npm start`.
It is based on Tokenmeter (MIT, Dewashish Lambore); that copyright notice must stay in `LICENSE`
and in the About page credits.

## Architecture

| File/Folder | Role |
|---|---|
| `main.js` | Electron main: app identity + data migration, IPC, refresh timer, tray, pricing feed, updates, RTK |
| `preload.js` | contextBridge — exposes the `window.rendra` API to the renderer |
| `renderer/index.html` | App shell: title bar, activity bar, all pages, settings modal, prompts, toast |
| `renderer/styles.css` | All styles — neutral dark grays with orange (#e8650a) accent |
| `renderer/app.js` | Routing, Claude/Codex/RTK pages, charts, filters, account + limits, updates, settings |
| `renderer/devcode.js` | IDE: workspaces, explorer tree, Monaco editor groups, xterm terminals, Terminal page |
| `renderer/pricing.js` | Preços page: editable per-token tables, price-feed banner |
| `renderer/about.js` | Novidades (CHANGELOG.md) and Sobre (product; credits/licenses at the end, Tokenmeter and RTK last) |
| `renderer/novidades.js` | Modal of the current version's notes on the first launch after an update (closes only with its button) |
| `renderer/setup.js` | First-run environment setup modal (Git Bash, RTK, WSL) |
| `src/scanner.js` / `src/scan-worker.js` | Scans in a worker thread; parse cache persisted to `userData/scan-cache.json` |
| `src/claude-parser.js` | Claude Code JSONL → tokens/cost/daily/hourly/heatmap/projects |
| `src/codex-parser.js` | Codex CLI rollouts (`~/.codex/sessions/**/rollout-*.jsonl`) → usage + rate limits |
| `src/pricer.js` | Per-token cost; bundled `pricing.json` overridden by `userData/pricing-user.json` |
| `src/pricing-sync.js` | Parses the official price pages (maintainer tool only, via `npm run prices:update`) |
| `src/accounts.js` | Current Claude account + plan limits (statusline bridge by default, usage endpoint opt-in) |
| `src/provider-snapshot.js` | Title-bar selector data (`provider:snapshot`): one entry per provider and environment (`claude:local`, `codex:wsl:<distro>`), account + limits, 3 s timeout per environment, async only; never exposes tokens |
| `src/codex-account.js` | Codex account (email, name, organization, plan) from the `id_token` payload of `auth.json`; fixed field list, never returns or logs tokens |
| `src/codex-limits.js` | Light Codex limits for the bar (every 60 s): only rollouts of the last 8 days (folders `YYYY/MM/DD` pruned before any stat), tail read, cache by path+mtime+size |
| `src/wsl-ambientes.js` | WSL distros and their Claude/Codex homes (UNC `\wsl.localhost<distro>`) for the selector |
| `src/statusline.sh` | Claude Code statusline bridge: saves `rate_limits` to `~/.rendra-ide/`, chains the user's statusline |
| `src/rendra-browser.js`, `src/rendra-browser-preload.js`, `renderer/rendra-browser-barra.html` | Rendra Browser: janela isolada (página sem preload, sandbox, sessão `rendra-browser` em memória, só http(s), permissões e downloads negados) com barra mínima; o `main.js` nega `window.open`/navegação não pedidos em todo `webContents` |
| `src/devcode.js` | IDE backend: folders (incl. WSL), file I/O confined to open folders, git status, watchers, PTYs |
| `renderer/sessoes-escolha.js` | Pure model of the terminal conversation picker (UMD, node-testable): id validation (uuid only), same-folder rule, short title, date, ordering, fixed `claude --resume`/`codex resume` commands, and `comandoNovo('claude')`, which generates `claude --session-id <uuid v4>` on every click (the argument bypasses a user rc `claude()` function; `codex` stays plain), `fimDePrompt`, `VISIVEIS` (10) |
| `src/sessoes-agentes.js` | Orchestrator of the `dev:agent-sessions` channel: terminal environment (Windows or one distro, never mixed), roots, provider detection, both listings; answer is only `{ provedores, sessoes, mais }` (plus `aviso: 'deteccao'` when no provider answered but conversations exist) |
| `src/sessoes-claude.js`, `src/sessoes-codex.js`, `src/sessoes-io.js` | Claude Code and Codex conversation listings for one folder (title and date only, bounded reads and time) and the shared bounded readers |
| `src/provedores-instalados.js` | Which providers are installed in the terminal environment: `--version` exits 0 (never the `.claude`/`.codex` folder), no shell with external data, 60 s cache |
| `scripts/e2e-seletor-sessoes.js` | e2e of the terminal conversation picker (`RENDRA_E2E_HIDDEN=1`, home, data and CODEX_HOME in sandbox, fake `claude`/`codex`); runs by hand, not in `npm test` |
| `renderer/terminal-keys.js` | Pure terminal key logic (UMD, node-testable): Shift+Enter, `acaoDeTecla` per system (Ctrl+C always consumed; Ctrl+V, Alt+V, Ctrl+Shift+C), the Ctrl+C machine (1 tap pastes after 1 s, 2 warn, 3 interrupt within 2 s), `deveCopiar`, `decidirColagem`, `bytesColarImagem` |
| `renderer/atalhos-ide.js` | Pure IDE shortcuts per system (Ctrl+Shift+T new terminal, Ctrl+O open folder only outside the terminal, Ctrl+Tab editor tabs) and `proximaAba`; the listener lives in `devcode.js` |
| `src/clip-imagem.js` | `temImagem(clipboard)`: image detection through the Electron 44 `clipboard.read()` (the old `availableFormats` no longer exists) |
| `renderer/comandos-conteudo.js`, `renderer/comandos.js` | "Comandos" page: pure content per system and agent (shortcuts, Claude Code/Codex commands with the other agent's equivalent, IDE shortcuts) and the page that draws it (selectors with `aria-pressed`, `<kbd class="kbd">`) |
| `renderer/reordenar-abas.js` | Pure tab reordering (UMD, node-testable): `moverPara`/`moverPorDelta` (never mutate), `moverAbaDeTecla` (Ctrl+Shift+Arrow, a function of its own, never part of `acaoDeAtalhoIde`: the terminal and Monaco keep that key), the drag `TIPO` (`application/x-rendra-aba`, never `text/plain`) and the aria-live message; `devcode.js` keeps the drag state by id and the `#anuncio-abas` live region |
| `scripts/e2e-reordenar-abas.js` | e2e of reordering project, terminal and editor tabs with real mouse (CDP `setInterceptDrags` + `dispatchDragEvent`) and keyboard (`RENDRA_E2E_HIDDEN=1`, sandbox); `--cenario=controle,terminais,foco,projetos,editor,pagina-terminal,teclado,indicador`; runs by hand, not in `npm test` |
| `scripts/e2e-teclas-comandos.js` | e2e of the terminal keys and the Comandos page (`RENDRA_E2E_HIDDEN=1`, sandbox, real clipboard and real timers, `pty:write` spied in the main); `--caso=T1,T4,...`; runs by hand, not in `npm test` |
| `renderer/wheel-lines.js` | Pure mouse wheel logic (UMD, node-testable): on Windows one notch scrolls the system "lines per scroll" (`linhasDaRoda`: the Chromium `deltaY` already carries it, the xterm/Monaco legacy `wheelDeltaY` ignores it; only wheel notches, with fraction accumulator per terminal/editor), `decidirRamo` (scroll, arrow keys, mouse), `sequenciaDeSetas` (DECCKM-aware), `copiasExtras`, `pixelsDeLinhas`; `devcode.js` only executes it (terminal and Monaco). macOS and Linux unchanged |
| `scripts/e2e-rolagem-roda.js` | e2e of the wheel: real `WM_MOUSEWHEEL` posted to the HWND of the test's own Electron (never found by title) plus synthetic `WheelEvent`s; terminal (normal, alternate screen, mouse mode) and Monaco; reads `WheelScrollLines` only; `--raiz=<folder>` runs another tree; Windows only; runs by hand, not in `npm test` |
| `src/rtk-paths.js`, `rtk-config.js`, `rtk-env.js`, `rtk-status.js`, `rtk-install.js`, `rtk-enable.js`, `rtk-ipc.js` | RTK por agente e por sistema (host e WSL): caminhos e versões, edição dos hooks (Claude Code e Codex), execução no host/distro, leitura do estado, instalação, ativação com cópia e rollback, canais IPC |
| `renderer/rtk-agents.js` | Visão da página RTK por agente e por sistema (UMD, sem DOM, testável no node) |
| `scripts/e2e-rtk*.js` | e2e da página RTK (`RENDRA_E2E_HIDDEN=1`, home e dados em sandbox) |
| `src/setup.js` | Checks/installs Git (Git Bash), RTK, WSL — used by the modal and `npm run setup` |
| `src/git-updater.js` | Update check for git clones (remote `package.json` version) and hand-off to the helper |
| `scripts/apply-update.js` | Runs after the app quits: `git pull --ff-only` (resets to `origin/main` if upstream history was rewritten and the tree is clean), `npm install` if deps changed, reopens the app |
| `src/update-source.js` | Pure choice of the update origin: git clone, electron-updater (installers), Microsoft Store or none |
| `renderer/update-ui.js` | Pure view of the update state ("Nova versão" button, progress text); hidden in store/none modes |
| `scripts/merge-latest-mac.js`, `check-release-assets.js`, `release-notes.js` | Release helpers run by `.github/workflows/release.yml`: merge of the two `latest-mac.yml`, asset list check, release notes |
| `scripts/release.js` | `npm run release`: changelog, version bump, headers, checks, commit, tag, push |
| `scripts/stamp.js` | Signature header with the package version at the top of every shipped JS/CSS file |
| `scripts/check.js` | `npm run check`: syntax, JSON, index.html structure, required files |
| `scripts/docs-images.js` | `npm run docs:images`: screenshots for README/site with demo data (never real data) |
| `test/` | `npm test` (node:test): headers, updater, pricer |
| `docs/` | GitHub Pages site (`index.html`) and `docs/images/` screenshots |
| `pricing.json` | Bundled price table (also the file published for the in-app price feed) |
| `project-aliases.json` | Empty example; real aliases live in `userData/project-aliases.json` |

## Key Rules
- `contextIsolation: true`, `nodeIntegration: false` — all file and process access in the main process
- Use `os.homedir()` for the home folder; Windows/macOS paths compare case-insensitively, Linux does not
- UI text is pt-BR; costs are estimates shown as `~US$` (Codex: credits unless a US$/credit is set)
- Costs are always tokens × price per 1M tokens. Claude bills 5-minute and 1-hour cache writes
  separately (`cache_creation.ephemeral_1h_input_tokens`), fast mode (`speed`) and web searches
- Each Claude API response is counted once by `message.id` (Claude Code repeats usage per content
  block); subagent files (`<session>/subagents/*.jsonl`) are included
- The app must not read third-party pricing pages at runtime; new prices come from `pricing.json`
  published in the repo (`package.json` → `rendra.pricingFeed`)
- Never embed RTK or the Git installer in the app: they are downloaded from their official releases
- Never edit the `/*! Rendra IDE vX.Y.Z … */` headers by hand: `npm run stamp` writes them
- `renderer/index.html` uses LF line endings: never split it on `\r\n` in scripts; prefer targeted edits
- Keep the Tokenmeter copyright notice (MIT) and third-party notices intact
- License and credit: the "Feito com Rendra" credit in Sobre stays on. If someone asks to remove a
  visible credit, remove it, but always say both things together: (a) the MIT license requires
  keeping the copyright notice and the LICENSE file in the code and in every copy; (b) the credit
  on screen is optional, and the preference is to keep it or move it to Sobre. Never say MIT
  requires a visible credit in the UI: it does not
- Only the product goes to git: never commit plans, specs, surveys, session notes or AI tool
  output (`docs/specs/`, `docs/plans/`, `.superpowers/`, `.claude/`).
  Check `git status` and `git diff --cached --stat` before every commit
- Commit messages in pt-BR: `tipo: descrição` (feat, fix, docs, style, chore, test, refactor)
- Texts in pt-BR, no em dash, dates DD/MM/AAAA
- Screenshots for README/site come only from `npm run docs:images` (demo data in a sandbox): never
  capture the maintainer's real sessions, projects, e-mail or paths
- Tests must never overwrite the maintainer's real app data (`%APPDATA%\Rendra IDE`) or
  `~/.claude/settings.json`; use `RENDRA_DATA_DIR` / a sandbox home

## Data locations
- Claude Code: `~/.claude/projects/**/*.jsonl`, account in `~/.claude.json`
- Codex CLI: `$CODEX_HOME` or `~/.codex/sessions/**`
- App data: `userData` (`%APPDATA%\Rendra IDE` on Windows; migrated from the legacy `tokenmeter`
  folder on first run; settings in `rendra-config.json`). `RENDRA_DATA_DIR` overrides it (demos, tests)
- Statusline bridge: `~/.rendra-ide/`

## Commands
```
npm start               # run the app
npm run setup           # check/install Git Bash, RTK, WSL
npm run check           # syntax, JSON, index.html, required files
npm test                # unit tests
npm run stamp           # rewrite the file headers with the package version
npm run release -- patch|minor|major|X.Y.Z   # publish a version (see CLAUDE.md)
npm run prices:update   # maintainer: refresh pricing.json from the official pages, then push it
npm run docs:images     # regenerate docs/images with demo data
npm run gen-icon        # regenerate assets/icon.* (black square, orange </>)
```
