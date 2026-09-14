# SDK build concurrency

SDK builds run one platform command at a time by default. A complete build still
produces Node, browser, Electron, Chrome extension, React Native and Vite bundles,
then declarations. A failed or interrupted build does not record a successful
freshness receipt.

Independent tasks and worktrees can keep running in parallel. The limit applies
to each SDK build invocation, so two builds can run two platform compilers at
once. It is not a machine-wide memory limit; declaration generation and other
tools also consume memory.

To increase platform concurrency when the machine has enough capacity:

```sh
CONCURRENTLY_MAX_PROCESSES=2 yarn build:sdk
```

The override must be a positive decimal integer. Invalid values fail before
platform commands start. Increasing it can shorten a build but increases peak
memory demand, especially when other tasks are building.

## Choose the build needed by the task

- Use focused source tests while iterating on behavior. SDK unit tests load source
  and do not require every platform bundle on each run.
- Use `yarn build:sdk` when testing the complete SDK artifact. Use `yarn build:all`
  when the task also needs the client-shared and Rujira artifacts. Both commands
  already build shared packages; a separate preceding `yarn build:shared` repeats
  work.
- Use the browser example's normal preparation command to reuse an unchanged
  successful build. Its receipt fingerprints inputs and checks selected outputs;
  it does not certify every published platform. Changes to the platform runner
  invalidate SDK reuse.
- Testing an unpublished SDK in Windows requires the actual local package and
  consumer validation. CI against the committed published dependency cannot test
  that temporary package.

Required CI can own equivalent exhaustive suites and build matrices. Keep
focused local regression checks and real QA for the changed behavior. Record
which checks ran locally and which are pending in CI; publication readiness does
not mean CI passed. Missing, skipped, cancelled or stale checks are not proof
that a delegated suite succeeded. Full local validation remains appropriate
when CI does not cover the change or the affected artifact must be exercised
locally.

Keep build outputs inside their owning worktree. Do not share writable `dist`
directories between concurrent tasks or reuse artifacts solely because they
exist.
