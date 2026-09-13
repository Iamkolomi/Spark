# Changelog

All notable changes to the Friend-Match Scoring Engine are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/).
Versioning follows [Semantic Versioning](https://semver.org/).

## [1.7] — Initial stable release

### Added
- Metadata-driven dealbreaker inference via option `implies` and
  dealbreaker `trait`.
- `suppressedByGate` metadata on dealbreakers; suppression is now
  config-driven, not hard-coded.
- Config assertion: every detectable dealbreaker's `trait` must be
  reachable via some option's `implies`.
- Config assertion: `suppressedByGate`, if present, must be `A`–`D`.
- `WeakMap` cache for `impliedTraits` to avoid re-walking the
  questionnaire in batch calls.
- `scoreBatch` short-circuits on invalid subject (single error entry
  instead of N duplicates).
- Gates carry `id` (`A`–`D`) so suppression rules can reference them.
- Report prints gate IDs alongside reasons.

### Changed
- Alignment topN now has a floor of 1 (single-answer profiles no
  longer orphan their only comparable question).
- Report section lines are column-aligned between skipped and scored
  variants.
- Breakdown line 2 is indented 24 spaces to align with the first
  line's numeric value.

### Breaking (introduced in 1.6, carried forward)
- `result.manualReview` → `result.manualReviewBy: { byA, byB }`.
  Callers iterating `result.manualReview` must update.

## [1.6]

### Added
- Option metadata `implies: string[]` on questionnaire options.
- Dealbreaker metadata `trait: string` on detectable dealbreakers.
- Config assertion: `implies`, if present, must be `string[]`.

### Changed
- Trait `contact` renamed to `high_frequency`.
- Alignment `topN` floor of 1.
- Proximity validation comment clarified (anti-duplication, not
  symmetry).

### Removed
- Hard-coded `'light'` and `'daily'` string comparisons in trait
  detection.

### Breaking
- `result.manualReview` → `result.manualReviewBy: { byA, byB }`.
- `subjectManualFlags` entries are now clones, not references.

## [1.5]

### Added
- Config assertions: ordinal `pos` values are exactly `0..n-1`.
- Config assertion: proximity keys reference valid option values
  and values are numbers in `[0, 1]`.
- `validateProfile` rejects empty strings for all question types.
- `scoreBatch` guards `null` / non-array candidates.
- `scoreBatch` returns `subjectManualFlags` (subject-side flags
  deduped across the batch).

### Breaking
- `manualReview` shape changed from `string[]` to
  `{ forA, forB }`. (Renamed to `byA/byB` in v1.6.)

## [1.4]

### Added
- Per-question `mode: 'ordinal' | 'categorical'`.
- Proximity map support for categorical questions (`life_stage`).
- `Dice` similarity replacing `Jaccard` for multi-select.
- Section coverage fields; skipped sections render `[skipped]`.
- Explicit `noOverlap` handling — band becomes `Insufficient data`.

### Changed
- Skip = 0: unanswered scored questions contribute 0 to their
  section. Band labels assume near-full completion.
- Config asserts per-section question weights sum to section weight.

## [1.3]

### Added
- Coverage flags (`lowConfidence`, `lowCompletion`).
- `manualReviewTriggered` boolean.
- Batch sort tiebreak by coverage.

### Changed
- `MIN_ANSWERED` derived from ratio × questionnaire length.
- `Math.floor` for conservative banding.

## [1.2]

### Added
- Per-question `mode` (ordinal vs categorical).
- Config assertions for section weights, dealbreaker flags,
  proximity anti-duplication.

### Removed
- Dead defensive branches in similarity helpers.

## [1.1]

### Added
- `validateProfile` / `validatePair`.
- Batch matcher `scoreBatch`.
- `report()` printer.

### Changed
- Penalties stored separately from clipped result.
- Gate B uses unrounded percent.

## [1.0]

Initial version.
