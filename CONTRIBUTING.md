# Contributing to @danmat/query-fetch

Thanks for your interest in contributing! This project is part of the
[`@danmat` HTTP QUERY suite](https://github.com/DanMat/query-suite-example).

## Development setup

Requires Node.js 18+ (CI tests 18, 20, 22).

```sh
git clone https://github.com/DanMat/query-fetch.git
cd query-fetch
npm install
```

Common tasks:

```sh
npm test         # run the test suite (vitest)
npm run build    # bundle with tsup (ESM + CJS + types)
npm run typecheck
npm run lint     # Biome: lint + format check
npm run format   # Biome: apply safe fixes
```

## Before you open a pull request

- Add or update tests for your change.
- Make sure `npm run lint`, `npm run typecheck`, and `npm test` all pass.
- A pre-commit hook runs `lint-staged` (Biome) automatically; please don't skip it.
- Keep the public API small and dependency-free — that's the point of this suite.

## Commit & PR

- Use clear, imperative commit messages.
- Open the PR against `main`; CI must be green before review.
- Describe the motivation and any tradeoffs.

## Releasing (maintainers)

Releases are automated. Bump the version, tag it, and push:

```sh
npm version patch --no-git-tag-version
git commit -am "release: vX.Y.Z"
git tag vX.Y.Z && git push origin main --tags
```

The `Release` workflow runs lint + typecheck + tests, then publishes to npm with
provenance.

## Code of Conduct

By participating you agree to abide by our [Code of Conduct](./CODE_OF_CONDUCT.md).
