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
