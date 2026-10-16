# Changelog

All notable changes to this project are documented here. This project uses [semantic versioning](https://semver.org/); before `1.0.0`, minor versions may include intentional compatibility changes.

## 0.9.0

### Added

- **Settings menu.** In interactive TUI mode, bare `/approval-guardian` opens a settings menu for the reviewer model, fallback model, review timeout, custom policy, per-tool review rules, and the temporary bypass.
  - The model rows open a picker listing models with configured authentication. Typing filters the list; every space-separated word must appear in the model name.
  - The policy row opens an editor. Saving empty text removes the custom policy.
  - Changes are saved to the global config file (`approval-guardian.json` in the Pi agent directory). The file is written atomically with mode `0600`. Keys the menu does not manage are preserved. Choosing a `default (…)` value removes that key. A file that is not a JSON object is never overwritten.
  - The bypass row uses the same transition as `/approval-guardian bypass` / `enable`. It is never written to config.
  - When an environment variable or a trusted project config overrides a value, the row's description says so. The menu does not edit those sources.
- `/approval-guardian status` prints reviewer readiness, channels, config sources, and warnings.
- Temporary bypass survives `/reload` of the same TUI session. It is held in process memory only; `/new`, `/resume`, `/fork`, and restarting Pi still clear it.
- Bypass control requests can set `quiet: true` to skip the activation notice when the caller already shows the bypass state. The below-editor warning is still shown.
- `@earendil-works/pi-tui` is now a declared peer dependency (`>=0.80.7 <0.81.0`).

### Changed

- **Bare `/approval-guardian` in TUI mode opens the settings menu instead of printing status.** Use `/approval-guardian status` for the previous output. Outside TUI mode, bare `/approval-guardian` still prints status.

### Fixed

- Shell commands are now classified using each word as the shell would see it: quoting is tracked, `\x` escapes are resolved, and every brace expansion is checked.
- Regex patterns, prose, and extension-only globs no longer cause false private-read reviews. These exemptions are switched off when the command runs a shell (including escaped names such as `ba\sh` and variables such as `S=sh; $S -c …`) or names a directory that holds private data.
- Confidential Pi paths stay private when they are hidden behind brace expansion or reached through a symlink.
