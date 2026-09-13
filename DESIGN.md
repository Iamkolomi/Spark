# Friend-Match Scoring Engine — Design Notes

## Purpose

Score the compatibility of two people as potential friends, on a
0–100 scale, using 28 questions across 7 signals.

The engine is a **filter**, not a prophecy. It reliably identifies
mismatches. It does not predict chemistry, timing, or the spark
that turns two compatible people into actual friends.

## The 7 signals

| Signal | Points | Role |
|---|---|---|
| Availability & Life Stage | 20 | Gate |
| Social Energy | 25 | Heaviest |
| Values & Friendship Style | 20 | Heavy |
| Communication & Personality | 15 | Medium |
| Interests & Time | 8 | Light |
| Life Context & Current Needs | 7 | Light |
| Compatibility Deepeners | 5 | Lightest |

Weights are reasoned, not fitted to data. Expect to tune them once
real friendship outcomes are available.

## The core logic

> **Match on logistics and values. Diversify on interests.**

- Same logistics → friendship can actually happen.
- Same values → friendship can actually last.
- Different interests → friendship stays interesting.

Two people who share only hobbies will fizzle. Two people who share
rhythms and values but have different interests will thrive. The
scoring model reflects this: hobbies are the smallest slice.
## Similarity math

**Ordinal questions** (single-select with a natural order):

    similarity = 1 − |posA − posB| / (options.length − 1)

Adjacent answers score high. Opposite ends score 0.

**Categorical questions** (single-select, no order):

    similarity = 1 if same value, 0 otherwise

Proximity maps can override specific pairs (e.g. `life_stage`).

**Multi-select questions**:

    similarity = 2 · |A ∩ B| / (|A| + |B|)   (Dice coefficient)

Dice is used instead of Jaccard because Jaccard punishes heavy
multi-selectors. A user who picks 8 hobbies shouldn't be penalized
for not matching someone who picks 2.

## Skip = 0

Unanswered scored questions contribute 0 to their section score.
A section is scored out of its full declared weight, not out of the
weight of answered questions.

This is deliberate. Skipping hard questions should cost points, not
preserve the score.

**Consequence:** band labels assume near-full completion. A profile
with 10 of 27 scored questions answered caps around 45–55 points,
regardless of how well-matched it is. Use `coverage` to decide
whether to surface a score to end users.
## Gates

Gates cap the total score when certain conditions hold. They exist
because averaging everything into one number lets incompatible
pairs through.

| ID | Trigger | Cap |
|---|---|---|
| A | No overlap in free time | 35 |
| B | Logistics < 40% (bad) / < 60% (strained) | 45 / 65 |
| C | Availability asymmetry ≥ 2 positions | 55 |
| D | Frequency asymmetry ≥ 3 positions | 60 |

Gates are evaluated **before** dealbreaker penalties so that
penalties can be suppressed when a gate already covers the same
offense (see `suppressedByGate`).

## Dealbreakers

Users can select up to 3 dealbreakers from a list of 7. Dealbreakers
are handled in two ways:

**Detectable dealbreakers** (2 of 7):
- `surface` — inferred from `convo_type: 'light'`
- `contact` — inferred from `frequency: 'daily'`

These are inferred from the other person's answers using metadata
(`implies` on options, `trait` on dealbreakers). If the trait is
present, a penalty is applied — unless the corresponding gate has
already fired (via `suppressedByGate`).

**Undetectable dealbreakers** (5 of 7):
- `cancels`, `behind`, `negative`, `money`, `demanding`

These route to `manualReviewBy`. They are advisory only. Apps that
display "dealbreakers respected" must treat them as manual review,
not automated protection.

### Why so few detectable

The two detectable dealbreakers are the only ones where the
questionnaire actually measures the same axis as the dealbreaker.
The other five would require different questions or explicit
self-report from the other person. Inferring "cancels a lot" from
"I don't mind being cancelled on" is a false positive.
