# Contributing

Bug reports, notebooks that read badly and pull requests are welcome.
[AGENTS.md](AGENTS.md) has the stack, the commands and the writing rules, and
[PLAN.md](PLAN.md) says what the panel does and does not try to do.

## Scope

Notebook Viewer reads notebooks. It does not edit or run them, and it stays
offline: `notebook-viewer` must never declare network, embeds, `account` or
`open-url`. The reason is in [docs/marketplace.md](docs/marketplace.md). Open an
issue before starting work on a new feature.

## Set up

You need Node 22.12 or newer.

```sh
npm install
npx playwright install chromium
```

`npm run validate:deska` also needs a clone of
[deska-panels-examples](https://github.com/0xPasho/deska-panels-examples); see
[AGENTS.md](AGENTS.md#validating-and-previewing-with-the-examples-repository).

## Before opening a pull request

CI runs the same checks:

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run size
npm run csp-lint
npm run validate:deska
npm run test:e2e
```

## Rules

- Use public material only: Deska's public docs and the MIT examples repository.
- Agree on any new dependency in an issue first. It has to fit the package
  budget and work without `eval`.
- Keep test notebooks synthetic. Do not commit real data.
- Treat every notebook as untrusted. A change to rendering needs a test that
  hostile input still runs nothing.
- Add both the English and the Spanish words for any new text in the panel.
- Update `CHANGELOG.md` for changes people will notice.

## Releasing

1. Raise `version` in `package.json`, `package-lock.json` and `panel/panel.json`.
2. Update `CHANGELOG.md` and the "What changed" text in `docs/marketplace.md`.
3. Merge, then push a tag such as `v0.7.0`. The release workflow checks that the
   tag matches `panel.json`, then attaches the zip to the GitHub release.
