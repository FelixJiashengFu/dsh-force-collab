# Changelog

## 0.1.1 — 2026-10-25

- Reserve fan-out slots atomically before starting children so concurrent calls cannot exceed the 36-child session limit.
- Release unused reservations on partial startup failures while preserving the cumulative count of children already started.
- Add concurrent-start and partial-failure regressions, CI, and a publish-time test gate.
