/* ============================================================
   FRIEND-MATCH SCORING ENGINE  v1.7  (stable)
   ------------------------------------------------------------
   7 signals · 28 questions · 100 points

   CHANGELOG
   ---------
   v1.6 → v1.7
     • Gate suppression of dealbreaker penalties is now
       metadata-driven: dealbreaker options carry
       `suppressedByGate: 'A'|'B'|'C'|'D'`; gates carry `id`.
       No more hard-coded trait names in the suppression path.
     • Config asserts every detectable dealbreaker's trait is
       reachable via some option's `implies` — prevents dead
       detection rules from passing config silently.
     • scoreBatch short-circuits on invalid subject (one error
       entry instead of N duplicates).
     • impliedTraits cached per answers object (WeakMap).
     • Report column alignment fixed.

   v1.5 → v1.6
     • BREAKING: result.manualReview → result.manualReviewBy
       ({ byA, byB }); subjectManualFlags entries cloned.

   DESIGN NOTES
   ------------
   • Skip = 0. Unanswered scored questions contribute 0 to their
     section. Band labels assume near-full completion; partial
     profiles will score low by design. Use `coverage` to decide
     whether to surface a score to end users.
   • Categorical vs ordinal per question, with optional proximity
     map for categorical questions.
   • Dealbreaker detection is metadata-driven. Options declare
     `implies: string[]`; dealbreakers declare `trait`. Detection
     is the set of implied traits across all answered options.
   • 5 of 7 dealbreakers (cancels, behind, negative, money,
     demanding) carry `detectable: false` and are advisory-only.
     Apps that display "dealbreakers respected" must treat them
     as manual review, not automated protection.
   ============================================================

   Breaking in this version (v1.7): NONE.
   (v1.6 introduced the manualReview → manualReviewBy rename.)

   ------------------------------------------------------------
   Public API:
     QUESTIONNAIRE
     SECTIONS
     BANDS
     MIN_ANSWERED
     validateProfile(profile)      → string[]
     scoreMatch(a, b)              → result object
     scoreBatch(subject, arr, n)   → { results, errors, subjectManualFlags }
     report(result)                → string

   Result shape (scoreMatch):
     {
       pair, total, band,
       normalizedTotal, penaltyAmount, penaltyClipped,
       postPenaltyTotal, preCapTotal, capped,
       sections, gates, penalties,
       manualReviewBy: { byA: {flag,label}[], byB: {flag,label}[] },
       manualReviewTriggered,
       highestAlignment, lowestAlignment,
       coverage, lowConfidence, lowCompletion, noOverlap
     }
   ============================================================ */

'use strict';

/* ---------------- CONFIG (editable; section weights must sum to 100) */

const SECTIONS = {
  logistics:     { label: 'Availability & Life Stage',    weight: 20 },
  energy:        { label: 'Social Energy',                weight: 25 },
  interests:     { label: 'Interests & Time',             weight: 8  },
  values:        { label: 'Values & Friendship Style',    weight: 20 },
  communication: { label: 'Communication & Personality',  weight: 15 },
  context:       { label: 'Life Context & Current Needs', weight: 7  },
  chemistry:     { label: 'Compatibility Deepeners',      weight: 5  },
};

const BANDS = [
  { min: 85, label: 'Excellent match' },
  { min: 70, label: 'Strong match' },
  { min: 55, label: 'Decent — could work' },
  { min: 40, label: 'Weak — only if nothing better' },
  { min: 0,  label: "Poor — don't match" },
];

const MIN_ANSWERED_RATIO        = 0.35;
const LOW_CONFIDENCE_COVERAGE   = 0.60;
const LOW_COMPLETION_BANNER     = 0.80;
const DEALBREAKER_PENALTY       = 8;
const GATE_THRESHOLDS = {
  logisticsBad:       40, /* percent */
  logisticsStrain:    60,
  minLogisticsAnswers: 3,
};

/* ---------------- QUESTIONNAIRE ---------------- */
/* mode: 'ordinal' | 'categorical' (default 'ordinal')
   proximity: anti-duplicated pair map (only one of "a|b" or "b|a")
   maxPick: enforced on multi
   implies: optional string[] — traits this option signals
   detectable: only on dealbreaker options (boolean, required)
   trait: required when detectable is true — trait this dealbreaker detects
   suppressedByGate: optional gate id; when that gate fires, penalty is skipped */

const QUESTIONNAIRE = [
  /* ---- 1. LOGISTICS (20) ---- */
  { id:'free_time', section:'logistics', weight:4, type:'multi', maxPick:3,
    text:'When are you usually free to see friends?',
    options:[
      {value:'weekday_am', label:'Weekday mornings'},
      {value:'weekday_pm', label:'Weekday afternoons'},
      {value:'weekday_eve',label:'Weekday evenings'},
      {value:'weekend_am', label:'Weekend mornings'},
      {value:'weekend_pm', label:'Weekend afternoons'},
      {value:'weekend_eve',label:'Weekend evenings'}]},

  { id:'predictability', section:'logistics', weight:4, type:'single', mode:'ordinal',
    text:'How predictable is your schedule?',
    options:[
      {value:'very',  label:'Very predictable — same rhythm every week', pos:0},
      {value:'mostly',label:'Mostly predictable, occasional changes',    pos:1},
      {value:'varies',label:'Changes week to week',                      pos:2},
      {value:'chaos', label:'Totally unpredictable',                     pos:3}]},

  { id:'life_stage', section:'logistics', weight:4, type:'single', mode:'categorical',
    text:'What season of life are you in?',
    options:[
      {value:'student',   label:'Student'},
      {value:'early',     label:'Early career, building'},
      {value:'settled',   label:'Settled — steady work and routine'},
      {value:'busy',      label:'Busy season — work, kids, caregiving'},
      {value:'transition',label:'In transition — moved, new job'},
      {value:'slowing',   label:'Slowing down or retired'}],
    /* Similarity (NOT distance): 1 = identical, 0 = unrelated. */
    proximity: {
      'student|early': 0.7, 'student|settled': 0.3, 'student|busy': 0.4,
      'student|transition': 0.6, 'student|slowing': 0.2,
      'early|settled': 0.8, 'early|busy': 0.5, 'early|transition': 0.7,
      'early|slowing': 0.3,
      'settled|busy': 0.6, 'settled|transition': 0.5, 'settled|slowing': 0.8,
      'busy|transition': 0.5, 'busy|slowing': 0.5,
      'transition|slowing': 0.4,
    }},

  { id:'time_available', section:'logistics', weight:4, type:'single', mode:'ordinal',
    text:'How much time do you realistically have for new friendships?',
    options:[
      {value:'lot',   label:"A lot — I'm actively looking",   pos:0},
      {value:'some',  label:'Some — I could make room',        pos:1},
      {value:'little',label:'A little — it would take effort', pos:2},
      {value:'none',  label:'Almost none right now',           pos:3}]},

  { id:'planning', section:'logistics', weight:4, type:'single', mode:'ordinal',
    text:'Spontaneous or planned?',
    options:[
      {value:'planned',     label:'Almost always planned',             pos:0},
      {value:'mostly_plan', label:'Mostly planned, some spontaneity',  pos:1},
      {value:'mostly_spont',label:'Mostly spontaneous, some planning', pos:2},
      {value:'spont',       label:'Almost always spontaneous',         pos:3}]},

  /* ---- 2. SOCIAL ENERGY (25) ---- */
  { id:'recharge', section:'energy', weight:6, type:'single', mode:'ordinal',
    text:'After a long week, what actually recharges you?',
    options:[
      {value:'alone',label:'Time completely alone',          pos:0},
      {value:'one',  label:'Quiet time, maybe one person',   pos:1},
      {value:'small',label:'A small group of close people',  pos:2},
      {value:'big',  label:'A big group — being around people',pos:3}]},

  { id:'format', section:'energy', weight:6, type:'single', mode:'ordinal',
    text:"What's your ideal hangout format?",
    options:[
      {value:'one',       label:'One-on-one, always',   pos:0},
      {value:'mostly_one',label:'Mostly one-on-one',    pos:1},
      {value:'small',     label:'Small groups (3–5)',   pos:2},
      {value:'big',       label:'Big groups or parties',pos:3}]},

  { id:'frequency', section:'energy', weight:6, type:'single', mode:'ordinal',
    text:'How often do you like to see close friends?',
    options:[
      {value:'daily',  label:'Almost daily',        pos:0, implies:['high_frequency']},
      {value:'few_wk', label:'A few times a week',  pos:1},
      {value:'weekly', label:'Weekly',              pos:2},
      {value:'few_mo', label:'A few times a month', pos:3},
      {value:'monthly',label:'Monthly or less',     pos:4}]},

  { id:'channel', section:'energy', weight:7, type:'single', mode:'ordinal',
    text:'How do you prefer to stay in touch?',
    options:[
      {value:'text',     label:'Text and messaging',pos:0},
      {value:'voice',    label:'Voice notes',       pos:1},
      {value:'call',     label:'Phone calls',       pos:2},
      {value:'in_person',label:'In person only',    pos:3}]},

  /* ---- 3. INTERESTS (8) ---- */
  { id:'weekend', section:'interests', weight:3, type:'multi', maxPick:3,
    text:'What does a good weekend look like?',
    options:[
      {value:'rest',     label:'Staying in, resting'},
      {value:'people',   label:'Out with people'},
      {value:'outdoors', label:'Outdoors / nature'},
      {value:'creating', label:'Creating something'},
      {value:'consuming',label:'Watching or consuming'},
      {value:'exploring',label:'Exploring new places'},
      {value:'project',  label:'Working on a project'}]},

  { id:'hobby', section:'interests', weight:3, type:'multi', maxPick:4,
    text:"What's a hobby you'd love a friend to share?",
    options:[
      {value:'fitness',  label:'Fitness / sports'},
      {value:'cooking',  label:'Cooking / food'},
      {value:'reading',  label:'Reading'},
      {value:'music',    label:'Music / live shows'},
      {value:'films',    label:'Films / TV'},
      {value:'travel',   label:'Travel'},
      {value:'gaming',   label:'Gaming'},
      {value:'art',      label:'Art / crafts'},
      {value:'hiking',   label:'Hiking / outdoors'},
      {value:'learning', label:'Learning / classes'},
      {value:'volunteer',label:'Volunteering'},
      {value:'nightlife',label:'Nightlife'}]},

  { id:'topics', section:'interests', weight:2, type:'multi', maxPick:4,
    text:'What could you talk about for hours?',
    options:[
      {value:'ideas',    label:'Ideas / philosophy'},
      {value:'people',   label:'People / relationships'},
      {value:'work',     label:'Work / ambition'},
      {value:'culture',  label:'Culture / art'},
      {value:'science',  label:'Science / how things work'},
      {value:'humor',    label:'Humor / banter'},
      {value:'growth',   label:'Personal growth'},
      {value:'news',     label:'Current events'},
      {value:'nostalgia',label:'Nostalgia / memories'}]},

  /* ---- 4. VALUES (20) ---- */
  { id:'good_friend', section:'values', weight:5, type:'multi', maxPick:2,
    text:'What does a good friend look like to you? (pick 2)',
    options:[
      {value:'myself',   label:'Someone I can be completely myself with'},
      {value:'shows_up', label:'Someone who shows up when it matters'},
      {value:'laugh',    label:'Someone who makes me laugh'},
      {value:'anything', label:'Someone I can talk to about anything'},
      {value:'grow',     label:'Someone who pushes me to grow'},
      {value:'reliable', label:'Someone reliable and consistent'}]},

  { id:'need_most', section:'values', weight:5, type:'single', mode:'categorical',
    text:'What do you need most from a friendship?',
    options:[
      {value:'loyalty', label:'Loyalty and consistency'},
      {value:'fun',     label:'Fun and lightness'},
      {value:'depth',   label:'Deep conversation and honesty'},
      {value:'support', label:'Practical support and showing up'}]},

  { id:'conflict', section:'values', weight:5, type:'single', mode:'ordinal',
    text:'How do you handle conflict with a friend?',
    options:[
      {value:'direct',label:'Address it directly, right away',pos:0},
      {value:'gentle',label:'Bring it up gently, when ready', pos:1},
      {value:'space', label:'Need space first, then talk',    pos:2},
      {value:'letgo', label:'Let it go and move on',          pos:3}]},

  { id:'show_care', section:'values', weight:5, type:'single', mode:'categorical',
    text:'How do you show someone you care?',
    options:[
      {value:'words', label:'Telling them — words'},
      {value:'time',  label:'Spending time with them'},
      {value:'acts',  label:'Doing things for them'},
      {value:'gifts', label:'Small gifts or gestures'}]},

  { id:'dealbreakers', section:'values', weight:0, type:'multi', maxPick:3,
    text:"What's a dealbreaker in a friendship?",
    options:[
      {value:'surface',  label:"Someone who won't go deep",
       detectable:true,  trait:'surface' },
      {value:'contact',  label:'Someone who needs constant contact',
       detectable:true,  trait:'high_frequency', suppressedByGate:'D' },
      {value:'cancels',  label:'Someone who cancels a lot',                    detectable:false},
      {value:'behind',   label:'Someone who talks about me behind my back',    detectable:false},
      {value:'negative', label:'Someone who is always negative',               detectable:false},
      {value:'money',    label:'Someone who is unreliable with money',         detectable:false},
      {value:'demanding',label:'Someone who is too demanding of my time',      detectable:false}]},

  /* ---- 5. COMMUNICATION (15) ---- */
  { id:'comm_style', section:'communication', weight:4, type:'single', mode:'ordinal',
    text:'How do you tend to communicate?',
    options:[
      {value:'direct',  label:'Very direct — I say what I mean',pos:0},
      {value:'gentle',  label:'Honest but gentle',              pos:1},
      {value:'indirect',label:'Indirect — I hint',              pos:2},
      {value:'avoid',   label:'I avoid hard topics',            pos:3}]},

  { id:'convo_type', section:'communication', weight:4, type:'single', mode:'categorical',
    text:'What kind of conversation do you enjoy most?',
    options:[
      {value:'deep',  label:'Deep and personal'},
      {value:'mix',   label:'A mix of deep and light'},
      {value:'light', label:'Light, funny, easy', implies:['surface']},
      {value:'debate',label:'Debating and ideas'}]},

  { id:'vulnerability', section:'communication', weight:4, type:'single', mode:'ordinal',
    text:'How comfortable are you being vulnerable with a friend?',
    options:[
      {value:'very',  label:'Very — I share quickly',        pos:0},
      {value:'fair',  label:'Fairly — once I trust them',    pos:1},
      {value:'slow',  label:'Slowly — it takes a long time', pos:2},
      {value:'rarely',label:'Rarely — I keep things light',  pos:3}]},

  { id:'cancelling', section:'communication', weight:3, type:'single', mode:'categorical',
    text:'How do you handle cancelling or being cancelled on?',
    options:[
      {value:'fine',      label:"It's fine, no big deal"},
      {value:'notice',    label:'Fine with notice, not last minute'},
      {value:'bothers',   label:'It bothers me — I take it personally'},
      {value:'rarely_cxl',label:'I rarely cancel and expect the same'}]},

  /* ---- 6. LIFE CONTEXT (7) ---- */
  { id:'looking_for', section:'context', weight:2, type:'single', mode:'categorical',
    text:'What are you looking for in a friend right now?',
    options:[
      {value:'activity',label:'Someone to do things with'},
      {value:'talk',    label:'Someone to talk to deeply'},
      {value:'group',   label:'Someone to be part of a group with'},
      {value:'longterm',label:'Someone to build a long-term friendship'},
      {value:'support', label:'Someone to help me through a hard time'}]},

  { id:'social_place', section:'context', weight:2, type:'single', mode:'ordinal',
    text:'Where are you socially?',
    options:[
      {value:'new',      label:'New to the area, starting fresh',pos:0},
      {value:'rebuild',  label:'Rebuilding after a change',      pos:1},
      {value:'want_more',label:'Have friends but want more',     pos:2},
      {value:'settled',  label:'Settled, looking to deepen',     pos:3}]},

  { id:'missing', section:'context', weight:2, type:'single', mode:'categorical',
    text:"What's missing from your current friendships?",
    options:[
      {value:'depth',    label:'Depth / real conversation'},
      {value:'frequency',label:'Frequency / time together'},
      {value:'fun',      label:'Fun / novelty'},
      {value:'stage',    label:'People in a similar life stage'},
      {value:'nothing',  label:'Nothing much — I just want more'}]},

  { id:'best_self', section:'context', weight:1, type:'single', mode:'categorical',
    text:'What kind of person brings out the best in you?',
    options:[
      {value:'calm',     label:'Someone calm and grounding'},
      {value:'energetic',label:'Someone energetic and motivating'},
      {value:'curious',  label:'Someone curious and questioning'},
      {value:'warm',     label:'Someone warm and accepting'},
      {value:'funny',    label:'Someone funny and playful'}]},

  /* ---- 7. DEEPENERS (5) ---- */
  { id:'humor', section:'chemistry', weight:2, type:'multi', maxPick:3,
    text:'What kind of humor do you like?',
    options:[
      {value:'dry',     label:'Dry / sarcastic'},
      {value:'silly',   label:'Silly / absurd'},
      {value:'story',   label:'Storytelling'},
      {value:'wordplay',label:'Wordplay / puns'},
      {value:'dark',    label:'Dark humor'},
      {value:'warm',    label:'Wholesome / warm'},
      {value:'selfdep', label:'Self-deprecating'}]},

  { id:'understood', section:'chemistry', weight:2, type:'multi', maxPick:3,
    text:'What makes you feel understood?',
    options:[
      {value:'remembers', label:'When someone remembers small things'},
      {value:'listens',   label:'When someone listens without fixing'},
      {value:'checks_in', label:'When someone checks in on me'},
      {value:'gets_humor',label:'When someone gets my humor'},
      {value:'accepts',   label:'When someone accepts me as I am'},
      {value:'challenges',label:'When someone challenges me'}]},

  { id:'want_try', section:'chemistry', weight:1, type:'multi', maxPick:3,
    text:"What's something you'd love to try?",
    options:[
      {value:'travel',  label:'Travel somewhere new'},
      {value:'hobby',   label:'A new hobby or skill'},
      {value:'class',   label:'A class or course'},
      {value:'sport',   label:'A new sport'},
      {value:'business',label:'Starting a project or business'},
      {value:'creative',label:'Something creative or performing'}]},
];

const QUESTION_BY_ID   = Object.fromEntries(QUESTIONNAIRE.map(q => [q.id, q]));
const SCORED_QUESTIONS = QUESTIONNAIRE.filter(q => q.weight > 0);
const MIN_ANSWERED     = Math.ceil(SCORED_QUESTIONS.length * MIN_ANSWERED_RATIO);

/* ---------------- CONFIG ASSERTIONS (module load) ---------------- */

(function validateConfig() {
  /* 1. Section weights sum to 100 */
  const weightSum = Object.values(SECTIONS).reduce((s, sec) => s + sec.weight, 0);
  if (weightSum !== 100) {
    throw new Error(`SECTIONS weights must sum to 100, got ${weightSum}`);
  }

  /* 2. Per-section question weights sum to section weight; ≥ 1 weighted Q */
  for (const [key, sec] of Object.entries(SECTIONS)) {
    const sum = QUESTIONNAIRE
      .filter(q => q.section === key)
      .reduce((s, q) => s + q.weight, 0);
    if (sum !== sec.weight) {
      throw new Error(
        `Section "${key}": question weights sum to ${sum}, expected ${sec.weight}`
      );
    }
    const hasWeighted = QUESTIONNAIRE.some(q => q.section === key && q.weight > 0);
    if (!hasWeighted) throw new Error(`Section "${key}" has no weighted questions`);
  }

  /* 3. Dealbreaker options: boolean detectable; string trait when detectable.
        Also collect implied registry for reachability check (step 4). */
  const impliedRegistry = new Set();
  for (const q of QUESTIONNAIRE) {
    for (const opt of q.options) {
      if (Array.isArray(opt.implies)) {
        for (const t of opt.implies) impliedRegistry.add(t);
      }
    }
  }
  for (const opt of QUESTION_BY_ID.dealbreakers.options) {
    if (typeof opt.detectable !== 'boolean') {
      throw new Error(`Dealbreaker option "${opt.value}" missing "detectable" flag`);
    }
    if (opt.detectable && typeof opt.trait !== 'string') {
      throw new Error(`Dealbreaker option "${opt.value}" is detectable but has no "trait"`);
    }
    /* 4. Every detectable trait must be reachable via some option's implies */
    if (opt.detectable && !impliedRegistry.has(opt.trait)) {
      throw new Error(
        `Dealbreaker "${opt.value}" has trait "${opt.trait}" with no matching "implies" anywhere`
      );
    }
  }

  /* 5. Ordinal single-select: integer pos values forming exactly 0..n-1 */
  for (const q of QUESTIONNAIRE) {
    if (q.type !== 'single') continue;
    if (q.mode === 'categorical') continue;
    const positions = q.options.map(o => o.pos);
    positions.forEach((p, i) => {
      if (typeof p !== 'number' || !Number.isInteger(p)) {
        throw new Error(
          `Ordinal question "${q.id}" option "${q.options[i].value}" needs integer pos`
        );
      }
    });
    const sorted = [...positions].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i] !== i) {
        throw new Error(
          `Ordinal question "${q.id}" pos values must be 0..${sorted.length - 1}, got [${sorted.join(',')}]`
        );
      }
    }
  }

  /* 6. Proximity maps: anti-duplication check (only one of "a|b" or "b|a"),
        valid option values, numeric values in [0,1]. */
  for (const q of QUESTIONNAIRE) {
    if (!q.proximity) continue;
    const validValues = new Set(q.options.map(o => o.value));
    const seen = new Set();
    for (const [key, value] of Object.entries(q.proximity)) {
      const parts = key.split('|');
      if (parts.length !== 2) {
        throw new Error(`Proximity key for "${q.id}" must be "a|b": got "${key}"`);
      }
      for (const part of parts) {
        if (!validValues.has(part)) {
          throw new Error(
            `Proximity key "${key}" on "${q.id}" references unknown value "${part}"`
          );
        }
      }
      if (typeof value !== 'number' || value < 0 || value > 1) {
        throw new Error(
          `Proximity value for "${q.id}" key "${key}" must be a number in [0,1], got ${value}`
        );
      }
      const canonical = parts.slice().sort().join('|');
      if (seen.has(canonical)) {
        throw new Error(
          `Duplicate proximity entry for "${q.id}" — both "${key}" and its mirror exist`
        );
      }
      seen.add(canonical);
    }
  }

  /* 7. `implies` must be string[]; `suppressedByGate` must be a valid gate id */
  const VALID_GATE_IDS = new Set(['A', 'B', 'C', 'D']);
  for (const q of QUESTIONNAIRE) {
    for (const opt of q.options) {
      if (opt.implies !== undefined) {
        if (!Array.isArray(opt.implies) || opt.implies.some(t => typeof t !== 'string')) {
          throw new Error(
            `Option "${q.id}.${opt.value}" has invalid "implies" (must be string[])`
          );
        }
      }
      if (opt.suppressedByGate !== undefined && !VALID_GATE_IDS.has(opt.suppressedByGate)) {
        throw new Error(
          `Option "${q.id}.${opt.value}" has invalid suppressedByGate "${opt.suppressedByGate}"`
        );
      }
    }
  }
})();

/* ---------------- HELPERS ---------------- */

function toArray(v) {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function uniqueArray(arr) { return Array.from(new Set(arr)); }

function posOf(qid, value) {
  const q = QUESTION_BY_ID[qid];
  if (!q || value === undefined || value === null || value === '') return null;
  const opt = q.options.find(o => o.value === value);
  return opt && typeof opt.pos === 'number' ? opt.pos : null;
}

function labelOf(qid, value) {
  const q = QUESTION_BY_ID[qid];
  if (!q) return String(value);
  const opt = q.options.find(o => o.value === value);
  return opt ? opt.label : String(value);
}

function labelsOf(qid, values) { return toArray(values).map(v => labelOf(qid, v)); }

function isAnswered(q, ans) {
  const v = ans[q.id];
  if (v === undefined || v === null) return false;
  if (q.type === 'multi') return Array.isArray(v) && v.length > 0;
  return v !== '';
}

function fmtNumber(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/* ---------------- SIMILARITY ----------------
   Called only when both sides answered (guarded by isAnswered).
   Null/empty branches are defensive only. */

function ordinalSim(q, a, b) {
  const pa = posOf(q.id, a[q.id]);
  const pb = posOf(q.id, b[q.id]);
  if (pa === null || pb === null) return 0.5;         /* defensive */
  const maxDist = q.options.length - 1;
  if (maxDist <= 0) return 1;
  return 1 - Math.abs(pa - pb) / maxDist;
}

function categoricalSim(q, a, b) {
  const va = a[q.id], vb = b[q.id];
  if (va === undefined || vb === undefined) return 0.5; /* defensive */
  if (va === vb) return 1;
  if (q.proximity) {
    const sim = q.proximity[`${va}|${vb}`] ?? q.proximity[`${vb}|${va}`];
    if (typeof sim === 'number') return sim;
  }
  return 0;
}

function diceSimilarity(a, b) {
  const A = new Set(toArray(a));
  const B = new Set(toArray(b));
  if (A.size === 0 || B.size === 0) return 0;          /* defensive */
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return (2 * inter) / (A.size + B.size);
}

function questionSim(q, a, b) {
  if (q.type === 'multi') return diceSimilarity(a[q.id], b[q.id]);
  if (q.mode === 'categorical') return categoricalSim(q, a, b);
  return ordinalSim(q, a, b);
}

function hasOverlap(arrA, arrB) {
  const A = toArray(arrA), B = toArray(arrB);
  if (A.length === 0 || B.length === 0) return false;
  const setB = new Set(B);
  return A.some(x => setB.has(x));
}

/* ---------------- VALIDATION ---------------- */

function validateProfile(profile) {
  const errors = [];
  if (!profile || typeof profile !== 'object') return ['Profile must be an object'];
  if (!profile.name || typeof profile.name !== 'string') errors.push('Missing or invalid "name"');
  if (!profile.answers || typeof profile.answers !== 'object') {
    errors.push('Missing or invalid "answers" object');
    return errors;
  }

  for (const q of QUESTIONNAIRE) {
    const v = profile.answers[q.id];
    if (v === undefined || v === null) continue;

    /* Empty string is never a valid answer for any question type.
       Clients should omit the field or send null. */
    if (v === '') {
      errors.push(`"${q.id}" received empty string; omit the field or send null`);
      continue;
    }

    if (q.type === 'single') {
      if (!q.options.some(o => o.value === v)) {
        errors.push(`Invalid value for "${q.id}": ${JSON.stringify(v)}`);
      }
      continue;
    }

    /* multi */
    if (!Array.isArray(v)) {
      errors.push(`"${q.id}" must be an array`);
      continue;
    }
    if (v.length !== uniqueArray(v).length) {
      errors.push(`"${q.id}" contains duplicate values`);
    }
    if (q.maxPick && v.length > q.maxPick) {
      errors.push(`"${q.id}" allows max ${q.maxPick} picks, got ${v.length}`);
    }
    for (const item of v) {
      if (!q.options.some(o => o.value === item)) {
        errors.push(`Invalid option for "${q.id}": ${JSON.stringify(item)}`);
      }
    }
  }

  /* MIN_ANSWERED applies only to scored (weight > 0) questions */
  const answered = SCORED_QUESTIONS.filter(q => isAnswered(q, profile.answers)).length;
  if (answered < MIN_ANSWERED) {
    errors.push(
      `Insufficient scored answers: ${answered}/${SCORED_QUESTIONS.length} (min ${MIN_ANSWERED})`
    );
  }
  return errors;
}

function validatePair(a, b) {
  return [
    ...validateProfile(a).map(e => `${a?.name || 'A'}: ${e}`),
    ...validateProfile(b).map(e => `${b?.name || 'B'}: ${e}`),
  ];
}

/* ---------------- SECTION SCORING ----------------
   Skip = 0. Unanswered scored questions contribute 0 to their section.
   Section score is out of its full declared weight. */

function scoreSection(key, a, b) {
  const meta = SECTIONS[key];
  const qs = QUESTIONNAIRE.filter(q => q.section === key && q.weight > 0);
  const totalWeight = qs.reduce((s, q) => s + q.weight, 0);

  let earned = 0;
  let answeredWeight = 0;
  const details = [];

  for (const q of qs) {
    const bothAnswered = isAnswered(q, a) && isAnswered(q, b);
    if (!bothAnswered) {
      details.push({ id: q.id, text: q.text, skipped: true, weight: q.weight });
      continue;
    }
    const sim = questionSim(q, a, b);
    earned += sim * q.weight;
    answeredWeight += q.weight;
    details.push({
      id: q.id,
      text: q.text,
      similarity: +(sim * 100).toFixed(1),
      weight: q.weight,
      answerA: q.type === 'multi' ? labelsOf(q.id, a[q.id]) : labelOf(q.id, a[q.id]),
      answerB: q.type === 'multi' ? labelsOf(q.id, b[q.id]) : labelOf(q.id, b[q.id]),
    });
  }

  const rawPercent = (earned / meta.weight) * 100;
  return {
    label: meta.label,
    weight: meta.weight,
    score: +earned.toFixed(2),
    percent: Math.round(rawPercent),
    rawPercent: +rawPercent.toFixed(2),
    coverage: +(answeredWeight / totalWeight).toFixed(3),
    details,
  };
}

/* ---------------- IMPLIED TRAITS ----------------
   Reads `implies` metadata from every answered option. Cached per
   answers object (WeakMap) so repeated scoreMatch calls in a batch
   don't re-walk the questionnaire for the same profile.
   Cache assumes `answers` is not mutated after first lookup. */

const IMPLIED_TRAITS_CACHE = new WeakMap();

function impliedTraits(ans) {
  if (ans === null || typeof ans !== 'object') return new Set();
  const cached = IMPLIED_TRAITS_CACHE.get(ans);
  if (cached) return cached;

  const traits = new Set();
  for (const q of QUESTIONNAIRE) {
    const v = ans[q.id];
    if (v === undefined || v === null || v === '') continue;

    if (q.type === 'single') {
      const opt = q.options.find(o => o.value === v);
      if (opt && Array.isArray(opt.implies)) for (const t of opt.implies) traits.add(t);
    } else if (Array.isArray(v)) {
      for (const item of v) {
        const opt = q.options.find(o => o.value === item);
        if (opt && Array.isArray(opt.implies)) for (const t of opt.implies) traits.add(t);
      }
    }
  }
  IMPLIED_TRAITS_CACHE.set(ans, traits);
  return traits;
}

/* ---------------- MAIN SCORER ---------------- */

function scoreMatch(profileA, profileB) {
  const errors = validatePair(profileA, profileB);
  if (errors.length) return { error: errors.join('; ') };

  const a = profileA.answers, b = profileB.answers;

  /* 1. Sections */
  const sections = {};
  for (const key of Object.keys(SECTIONS)) {
    sections[key] = scoreSection(key, a, b);
  }

  /* 2. Raw total (see DESIGN NOTES — section weights sum to 100) */
  const rawSum = Object.values(sections).reduce((s, sec) => s + sec.score, 0);
  const normalizedTotal = rawSum;

  /* 3. Gates — each carries an id used for metadata-driven suppression */
  const gates = [];

  if (isAnswered(QUESTION_BY_ID.free_time, a) && isAnswered(QUESTION_BY_ID.free_time, b)) {
    if (!hasOverlap(a.free_time, b.free_time)) {
      gates.push({ id: 'A', cap: 35, reason: 'No overlap in free time' });
    }
  }

  const logAnswered = sections.logistics.details.filter(d => !d.skipped).length;
  if (logAnswered >= GATE_THRESHOLDS.minLogisticsAnswers) {
    const pct = sections.logistics.rawPercent;
    if (pct < GATE_THRESHOLDS.logisticsBad)         gates.push({ id: 'B', cap: 45, reason: 'Logistics badly mismatched' });
    else if (pct < GATE_THRESHOLDS.logisticsStrain) gates.push({ id: 'B', cap: 65, reason: 'Logistics strained' });
  }

  const availA = posOf('time_available', a.time_available);
  const availB = posOf('time_available', b.time_available);
  if (availA !== null && availB !== null && Math.abs(availA - availB) >= 2) {
    gates.push({ id: 'C', cap: 55, reason: 'Very different amounts of time available' });
  }

  const freqA = posOf('frequency', a.frequency);
  const freqB = posOf('frequency', b.frequency);
  if (freqA !== null && freqB !== null && Math.abs(freqA - freqB) >= 3) {
    gates.push({ id: 'D', cap: 60, reason: 'Very different contact needs' });
  }

  const gateMap = {};
  for (const g of gates) gateMap[g.id] = true;

  /* 4. Dealbreaker penalties (metadata-driven suppression) */
  const traitsA = impliedTraits(a);
  const traitsB = impliedTraits(b);
  const penalties = [];
  const manualReviewBy = { byA: [], byB: [] };

  const applyPenalty = (side, flaggingName, targetName, dealbreakerValue, targetTraits) => {
    const opt = QUESTION_BY_ID.dealbreakers.options.find(o => o.value === dealbreakerValue);
    if (!opt) return;
    if (!opt.detectable) {
      manualReviewBy[side].push({ flag: dealbreakerValue, label: opt.label });
      return;
    }
    if (!targetTraits.has(opt.trait)) return;
    /* Skip if a gate already covers the same offense */
    if (opt.suppressedByGate && gateMap[opt.suppressedByGate]) return;
    penalties.push(`${targetName} triggers ${flaggingName}'s dealbreaker: "${opt.label}"`);
  };

  for (const d of toArray(a.dealbreakers)) applyPenalty('byA', profileA.name, profileB.name, d, traitsB);
  for (const d of toArray(b.dealbreakers)) applyPenalty('byB', profileB.name, profileA.name, d, traitsA);

  const penaltyAmount = penalties.length * DEALBREAKER_PENALTY;
  const preClip = normalizedTotal - penaltyAmount;
  const postPenaltyTotal = Math.max(0, preClip);
  const penaltyClipped = preClip < 0;

  /* 5. Cap */
  const cap = gates.length ? Math.min(...gates.map(g => g.cap)) : 100;
  const preCapTotal = postPenaltyTotal;
  const total = Math.floor(Math.min(preCapTotal, cap));
  const capped = preCapTotal > cap;

  /* 6. Coverage + overlap */
  const answeredTogether = SCORED_QUESTIONS
    .filter(q => isAnswered(q, a) && isAnswered(q, b)).length;
  const totalScored = SCORED_QUESTIONS.length;
  const coverage = answeredTogether / totalScored;
  const lowConfidence = coverage < LOW_CONFIDENCE_COVERAGE;
  const lowCompletion = coverage < LOW_COMPLETION_BANNER;
  const noOverlap = answeredTogether === 0;

  /* 7. Band */
  const band = noOverlap
    ? 'Insufficient data'
    : BANDS.find(b => total >= b.min).label;

  /* 8. Alignment — non-overlapping slices, topN floor of 1 */
  const flat = [];
  for (const [key, sec] of Object.entries(sections)) {
    for (const d of sec.details) {
      if (!d.skipped) flat.push({ ...d, section: key });
    }
  }
  const sorted = [...flat].sort((x, y) => y.similarity - x.similarity);
  const topN = flat.length > 0
    ? Math.min(3, Math.max(1, Math.ceil(flat.length / 2)))
    : 0;
  const botN = Math.min(3, flat.length - topN);
  const highestAlignment = topN > 0 ? sorted.slice(0, topN) : [];
  const lowestAlignment  = botN > 0 ? sorted.slice(-botN).reverse() : [];

  return {
    pair: `${profileA.name} × ${profileB.name}`,
    total,
    normalizedTotal: +normalizedTotal.toFixed(2),
    penaltyAmount,
    penaltyClipped,
    postPenaltyTotal: +postPenaltyTotal.toFixed(2),
    preCapTotal: +preCapTotal.toFixed(2),
    capped,
    band,
    sections,
    gates,
    penalties,
    manualReviewBy,
    manualReviewTriggered: manualReviewBy.byA.length > 0 || manualReviewBy.byB.length > 0,
    highestAlignment,
    lowestAlignment,
    coverage: +(coverage * 100).toFixed(0),
    lowConfidence,
    lowCompletion,
    noOverlap,
  };
}

/* ---------------- BATCH MATCHER ---------------- */

function scoreBatch(subject, candidates, limit = 10) {
  /* Guard: null / undefined / non-array input */
  if (candidates === undefined || candidates === null) {
    return {
      results: [],
      errors: [{ index: -1, candidate: 'n/a', error: 'candidates is required' }],
      subjectManualFlags: [],
    };
  }

  /* Short-circuit: validate subject once. Avoids N duplicate error
     entries when the subject itself is invalid. */
  const subjectErrors = validateProfile(subject);
  if (subjectErrors.length) {
    return {
      results: [],
      errors: [{
        index: -1,
        candidate: subject?.name || 'subject',
        error: subjectErrors.join('; '),
      }],
      subjectManualFlags: [],
    };
  }

  if (!Array.isArray(candidates)) candidates = [candidates];

  const results = [];
  const errors = [];

  candidates.forEach((c, i) => {
    const r = scoreMatch(subject, c);
    if (r.error) errors.push({ index: i, candidate: c?.name || 'unknown', error: r.error });
    else results.push(r);
  });

  results.sort((x, y) => {
    if (y.total !== x.total) return y.total - x.total;
    return y.coverage - x.coverage;
  });

  /* Aggregate subject's manual-review flags once (not per-match).
     Clone entries to prevent aliasing with per-match results. */
  const flagMap = new Map();
  for (const r of results) {
    for (const f of r.manualReviewBy.byA) {
      if (!flagMap.has(f.flag)) flagMap.set(f.flag, { ...f });
    }
  }

  return {
    results: results.slice(0, limit),
    errors,
    subjectManualFlags: [...flagMap.values()],
  };
}

/* ---------------- REPORT ---------------- */

function padRight(s, n) {
  s = String(s);
  if (s.length >= n) return s.slice(0, n - 3) + '...';
  return s + ' '.repeat(n - s.length);
}

function report(r) {
  if (!r || r.error) return `ERROR: ${r?.error || 'no result'}`;

  const W = 70;
  const lines = [];
  const bar = pct => '#'.repeat(Math.round(pct / 5)).padEnd(20, '.');

  /* Column layout constants — keep section lines aligned */
  const PREFIX_SKIPPED = '    [skipped]'.padEnd(31);  /* 4 + "[skipped]" + 18 = 31 */
  const PREFIX_SCORED  = '    ';                      /* then bar(20) + " NNN%" + "  " = 31 */

  lines.push('='.repeat(W));
  lines.push(`  ${r.pair}`);
  lines.push('='.repeat(W));
  lines.push(`  SCORE: ${r.total}/100   →   ${r.band}`);

  /* Breakdown — two lines, second line indented to align "="
     under the numeric value in the first line. */
  if (r.penaltyAmount > 0 || r.capped) {
    let line1 = `  Breakdown: normalized ${r.normalizedTotal.toFixed(2)}`;
    if (r.penaltyAmount > 0) {
      line1 += ` − ${fmtNumber(r.penaltyAmount)} penalties`;
      if (r.penaltyClipped) line1 += ' (clipped at 0)';
    }
    lines.push(line1.trimEnd());

    const parts2 = [];
    if (r.penaltyAmount > 0) parts2.push(`= ${r.postPenaltyTotal.toFixed(2)}`);
    if (r.capped) parts2.push(`(capped at ${r.total})`);
    if (parts2.length > 0) lines.push(' '.repeat(24) + parts2.join(' '));
  }

  /* Status banners */
  if (r.noOverlap) {
    lines.push('  [!] No overlapping scored answers — nothing to compare.');
  } else {
    if (r.lowConfidence) {
      lines.push(`  [!] Low confidence — coverage ${r.coverage}% (below ${Math.round(LOW_CONFIDENCE_COVERAGE*100)}%)`);
    } else if (r.lowCompletion) {
      lines.push(`  [i] Partial completion ${r.coverage}% — band labels assume near-full forms`);
    }
  }
  lines.push('');

  /* Sections */
  lines.push('  Section breakdown:');
  for (const s of Object.values(r.sections)) {
    if (s.coverage === 0) {
      lines.push(`${PREFIX_SKIPPED}${padRight(s.label, 30)} (no data)`);
    } else {
      const scoreStr = `(${Math.round(s.score)}/${s.weight})`;
      lines.push(`${PREFIX_SCORED}${bar(s.percent)} ${String(s.percent).padStart(3)}%  `
        + `${padRight(s.label, 30)} ${scoreStr}`);
    }
  }

  if (r.gates.length) {
    lines.push(''); lines.push('  [!] Gates triggered:');
    r.gates.forEach(g => lines.push(`      • [${g.id}] ${g.reason}  →  capped at ${g.cap}`));
  }
  if (r.penalties.length) {
    lines.push(''); lines.push('  [!] Dealbreaker conflicts:');
    r.penalties.forEach(p => lines.push(`      • ${p}`));
  }
  if (r.manualReviewTriggered) {
    lines.push(''); lines.push('  [?] Manual review required:');
    r.manualReviewBy.byA.forEach(m =>
      lines.push(`      • A flagged: "${m.label}"`));
    r.manualReviewBy.byB.forEach(m =>
      lines.push(`      • B flagged: "${m.label}"`));
  }

  const printAlignment = (label, list) => {
    if (!list.length) return;
    lines.push(''); lines.push(`  ${label}`);
    list.forEach(s => {
      lines.push(`      ${String(s.similarity).padStart(5)}%  ${s.text}`);
      const aStr = Array.isArray(s.answerA) ? s.answerA.join(', ') : s.answerA;
      const bStr = Array.isArray(s.answerB) ? s.answerB.join(', ') : s.answerB;
      lines.push(`               A: ${aStr}`);
      lines.push(`               B: ${bStr}`);
    });
  };
  printAlignment('[+] Highest alignment:', r.highestAlignment);
  printAlignment('[-] Lowest alignment:',  r.lowestAlignment);

  lines.push('');
  return lines.join('\n');
}

/* ---------------- EXPORTS ---------------- */

const ENGINE = {
  QUESTIONNAIRE, SECTIONS, BANDS, MIN_ANSWERED,
  validateProfile, validatePair,
  scoreMatch, scoreBatch, report,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ENGINE;
} else if (typeof window !== 'undefined') {
  window.FriendMatchEngine = ENGINE;
      }
