/* Table-driven tests for the booking engine and the page builder.
 *
 *   node tests/booking.test.js       headless, the whole suite
 *   tests/index.html                 the same suite in a browser, minus the
 *                                    two groups that need the file system
 *
 * No framework, no dependencies. Every expected figure below was worked out by
 * hand from the stated rule and is written as the arithmetic it is, so the
 * sums stay readable.
 *
 * The last two groups are the ones that matter most in practice:
 *
 *   - LINKS. A booking lost to a broken link is lost silently: nobody
 *     complains, the message simply never arrives. So every awkward payload is
 *     round-tripped back out of the finished URL with a real URL parser, which
 *     is what catches the classic mistake of a literal + in a query string
 *     coming back as a space.
 *
 *   - THE GENERATED PAGE. The page carries its own copy of the engine, written
 *     out of this very source. The bundle is parsed with node --check, loaded,
 *     and run against every scenario in the table above, so the arithmetic a
 *     guest's phone does is proved to be the arithmetic tested here.
 */
"use strict";

/* The same file runs headless and in a browser. Two groups need a file system
 * and a child process; in a browser they are reported as skipped. */
var ON_NODE = typeof process === "object" && typeof require === "function" &&
  typeof module === "object" && !!module;

var fs = null, os = null, path = null, cp = null, B = null;
if (ON_NODE) {
  fs = require("fs");
  os = require("os");
  path = require("path");
  cp = require("child_process");
  B = require("../assets/booking.js");
} else {
  B = (typeof window !== "undefined" ? window : this).BookingPage;
}

var skipped = [];
var pass = 0, fail = 0;
var failures = [];
var groups = [];

function check(label, ok, detail) {
  if (ok) { pass++; return true; }
  fail++;
  failures.push(label + (detail ? "  — " + detail : ""));
  return false;
}

function near(a, b) {
  if (typeof a !== "number" || typeof b !== "number") { return false; }
  if (!isFinite(a) || !isFinite(b)) { return a === b; }
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

function eq(label, actual, expected) {
  if (typeof expected === "number") {
    return check(label, near(actual, expected), "got " + actual + ", expected " + expected);
  }
  return check(label, actual === expected,
    "got " + JSON.stringify(actual) + ", expected " + JSON.stringify(expected));
}

function deepSame(a, b) {
  if (typeof a === "number" && typeof b === "number") { return near(a, b); }
  if (a === b) { return true; }
  if (!a || !b || typeof a !== "object" || typeof b !== "object") { return false; }
  var ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) { return false; }
  for (var i = 0; i < ka.length; i++) {
    if (kb.indexOf(ka[i]) < 0) { return false; }
    if (!deepSame(a[ka[i]], b[ka[i]])) { return false; }
  }
  return true;
}

function group(name) { groups.push({ name: name, at: pass + fail }); }
function closeGroup() {
  var g = groups[groups.length - 1];
  if (g) { g.asserts = (pass + fail) - g.at; }
}

/* ================================================================== *
 * 1. Numbers
 * ================================================================== */
group("numeric helpers");

[
  ["", 0], [null, 0], [undefined, 0], ["abc", 0], ["NaN", 0],
  [0, 0], [12, 12], ["12", 12], ["12.5", 12.5], [" 2 800 ", 2800],
  ["2,800", 2800], ["2\u00a0800", 2800], ["-5", -5], ["1e3", 1000],
  [Infinity, 0], [-Infinity, 0], [NaN, 0], ["12abc", 12], [true, 0]
].forEach(function (r) {
  eq("num(" + JSON.stringify(r[0]) + ")", B.num(r[0]), r[1]);
});

[["", 0], ["-5", 0], [-0.1, 0], ["7", 7], [null, 0]].forEach(function (r) {
  eq("nonNeg(" + JSON.stringify(r[0]) + ")", B.nonNeg(r[0]), r[1]);
});

[[0, 0], [1.005, 1.01], [1747.2, 1747.2], [2.675, 2.68], [-1.005, -1.01],
 [1 / 3, 0.33], [Infinity, 0], [NaN, 0]].forEach(function (r) {
  eq("round2(" + r[0] + ")", B.round2(r[0]), r[1]);
});

[["", 0], [35, 35], [-20, -20], [-100, -100], [-150, -100], [500, 500]].forEach(function (r) {
  eq("clampPct(" + JSON.stringify(r[0]) + ")", B.clampPct(r[0]), r[1]);
});

[["+91 98765-43210", "919876543210"], ["", ""], [null, ""], ["abc", ""],
 ["(0917) 000 0000", "09170000000"]].forEach(function (r) {
  eq("digitsOf(" + JSON.stringify(r[0]) + ")", B.digitsOf(r[0]), r[1]);
});
closeGroup();

/* ================================================================== *
 * 2. Dates, with no Date object anywhere near them
 * ================================================================== */
group("dates");

[["1970-01-01", 0], ["1970-01-02", 1], ["1969-12-31", -1],
 ["2000-01-01", 10957], ["2000-03-01", 11017], ["2024-02-29", 19782]
].forEach(function (r) {
  eq("isoToDays(" + r[0] + ")", B.isoToDays(r[0]), r[1]);
});

/* every day across four years, including two leap days, must survive the
 * round trip date -> day number -> date */
var rtFrom = B.isoToDays("2024-01-01"), rtTo = B.isoToDays("2028-01-01"), rtBad = 0;
for (var dd = rtFrom; dd <= rtTo; dd++) {
  var iso = B.daysToISO(dd);
  if (B.isoToDays(iso) !== dd) { rtBad++; }
}
check("day-number round trip over 2024-2028 (" + (rtTo - rtFrom + 1) + " days)", rtBad === 0,
  rtBad + " mismatches");

[
  ["2026-12-24", true], ["2024-02-29", true], ["2000-02-29", true],
  ["2026-02-30", false], ["2027-02-29", false], ["2100-02-29", false],
  ["2026-13-01", false], ["2026-00-10", false], ["2026-01-00", false],
  ["2026-1-4", false], ["24/12/2026", false], ["2026-12-24T10:00", false],
  ["", false], [null, false], ["  2026-12-24  ", true], ["20261224", false]
].forEach(function (r) {
  eq("parseISO(" + JSON.stringify(r[0]) + ") valid", B.parseISO(r[0]) !== null, r[1]);
});

[["1970-01-01", "Thu 1 Jan 1970"], ["2000-02-29", "Tue 29 Feb 2000"],
 ["2026-12-25", "Fri 25 Dec 2026"], ["2027-01-01", "Fri 1 Jan 2027"],
 ["2026-12-18", "Fri 18 Dec 2026"], ["bad", ""]
].forEach(function (r) {
  eq("formatDate(" + r[0] + ")", B.formatDate(r[0]), r[1]);
});

[
  ["2026-12-24", "2026-12-27", 3],
  ["2026-12-24", "2026-12-25", 1],
  ["2026-12-24", "2026-12-24", 0],
  ["2026-12-27", "2026-12-24", -3],
  ["2026-12-28", "2027-01-02", 5],
  ["2024-02-27", "2024-03-01", 3],
  ["2027-02-27", "2027-03-01", 2],
  ["", "2026-12-27", null],
  ["2026-12-24", "nope", null]
].forEach(function (r) {
  eq("nightsBetween(" + r[0] + "," + r[1] + ")", B.nightsBetween(r[0], r[1]), r[2]);
});
closeGroup();

/* ================================================================== *
 * 3. Seasons
 * ================================================================== */
group("seasons");

var SEASONS = [
  { name: "Peak", from: "2026-12-20", to: "2027-01-05", upliftPct: 35 },
  { name: "Monsoon", from: "2026-06-15", to: "2026-09-15", upliftPct: -20 },
  { name: "Broad", from: "2026-01-01", to: "2027-12-31", upliftPct: 10 }
];

[
  ["2026-12-19", "Broad"], ["2026-12-20", "Peak"], ["2027-01-05", "Peak"],
  ["2027-01-06", "Broad"], ["2026-06-15", "Monsoon"], ["2026-09-15", "Monsoon"],
  ["2026-09-16", "Broad"], ["2025-12-31", null], ["bad", null]
].forEach(function (r) {
  var s = B.seasonForNight(r[0], SEASONS);
  eq("seasonForNight(" + r[0] + ")", s ? s.name : null, r[1]);
});

check("a season with unusable dates is skipped",
  B.seasonForNight("2026-03-01", [{ name: "Junk", from: "nope", to: "", upliftPct: 50 }]) === null);
check("a season that ends before it starts is skipped",
  B.seasonForNight("2026-03-01", [{ name: "Back", from: "2026-04-01", to: "2026-02-01", upliftPct: 50 }]) === null);
check("a nameless season is skipped",
  B.seasonForNight("2026-03-01", [{ name: "", from: "2026-01-01", to: "2026-12-31", upliftPct: 50 }]) === null);
closeGroup();

/* ================================================================== *
 * 4. The quote
 * ================================================================== */
group("quote scenarios");

var GARDEN = { name: "Garden room", baseRate: 2800, includedGuests: 2, maxGuests: 4, extraAdultRate: 700, childRate: 350 };
var COTTAGE = { name: "Estate cottage", baseRate: 4200, includedGuests: 2, maxGuests: 5, extraAdultRate: 900, childRate: 450 };
var PEAK = [{ name: "Peak", from: "2026-12-20", to: "2027-01-05", upliftPct: 35 }];
var MONSOON = [{ name: "Monsoon", from: "2026-06-15", to: "2026-09-15", upliftPct: -20 }];

function base(over) {
  var q = {
    currency: "INR", checkin: "2026-11-02", checkout: "2026-11-05",
    adults: 2, ages: "", room: GARDEN, seasons: [], childFreeUnder: 5,
    taxLabel: "GST", taxPct: 0, taxIncluded: false, depositPct: 0, minNights: 0
  };
  for (var k in (over || {})) { if (Object.prototype.hasOwnProperty.call(over, k)) { q[k] = over[k]; } }
  return q;
}

var CASES = [
  {
    label: "three plain nights",
    input: base(),
    want: { ok: true, nights: 3, roomTotal: 3 * 2800, extraAdultTotal: 0, childTotal: 0,
            subtotal: 8400, taxAmount: 0, grandTotal: 8400, perNight: 2800, groupCount: 1 }
  },
  {
    label: "one extra adult, three nights",
    input: base({ adults: 3 }),
    want: { ok: true, extraAdults: 1, extraAdultTotal: 1 * 700 * 3,
            subtotal: 8400 + 2100, grandTotal: 10500 }
  },
  {
    label: "two extra adults in the cottage",
    input: base({ room: COTTAGE, adults: 4 }),
    want: { ok: true, extraAdults: 2, extraAdultTotal: 2 * 900 * 3,
            roomTotal: 3 * 4200, subtotal: 12600 + 5400, grandTotal: 18000 }
  },
  {
    label: "one child charged, one child free",
    input: base({ ages: "7, 3" }),
    want: { ok: true, children: 2, payingChildren: 1, freeChildren: 1,
            childTotal: 1 * 350 * 3, subtotal: 8400 + 1050, grandTotal: 9450, occupancy: 4 }
  },
  {
    label: "a child exactly at the free-age cut-off pays",
    input: base({ ages: "5", childFreeUnder: 5 }),
    want: { ok: true, payingChildren: 1, freeChildren: 0, childTotal: 1050 }
  },
  {
    label: "no free-child age set, so every child pays",
    input: base({ ages: "2", childFreeUnder: 0 }),
    want: { ok: true, payingChildren: 1, freeChildren: 0, childTotal: 1050 }
  },
  {
    label: "season uplift on every night",
    input: base({ checkin: "2026-12-24", checkout: "2026-12-27", seasons: PEAK }),
    want: { ok: true, nights: 3, roomTotal: 3 * 3780, grandTotal: 11340, groupCount: 1,
            seasonsUsed: 1 }
  },
  {
    label: "a stay that crosses into the season is split night by night",
    input: base({ checkin: "2026-12-18", checkout: "2026-12-22", seasons: PEAK }),
    want: { ok: true, nights: 4, roomTotal: 2 * 2800 + 2 * 3780, grandTotal: 13160,
            groupCount: 2, seasonsUsed: 1 }
  },
  {
    label: "an off-season discount is a negative uplift",
    input: base({ checkin: "2026-07-01", checkout: "2026-07-04", seasons: MONSOON }),
    want: { ok: true, roomTotal: 3 * 2240, grandTotal: 6720 }
  },
  {
    label: "a rate change below -100% is clamped, so a night is free and never negative",
    input: base({ seasons: [{ name: "Oops", from: "2026-11-01", to: "2026-11-30", upliftPct: -400 }] }),
    want: { ok: true, roomTotal: 0, subtotal: 0, grandTotal: 0 }
  },
  {
    label: "tax added on top",
    input: base({ taxPct: 12 }),
    want: { ok: true, subtotal: 8400, taxAmount: 1008, netOfTax: 8400, grandTotal: 9408 }
  },
  {
    label: "tax already inside the rate is backed out, not added",
    input: base({ taxPct: 12, taxIncluded: true }),
    want: { ok: true, subtotal: 8400, taxAmount: 900, netOfTax: 7500, grandTotal: 8400 }
  },
  {
    label: "tax on everything, extras included",
    input: base({ adults: 3, ages: "7", taxPct: 18 }),
    want: { ok: true, subtotal: 8400 + 2100 + 1050, taxAmount: 11550 * 0.18, grandTotal: 11550 * 1.18 }
  },
  {
    label: "deposit and balance",
    input: base({ taxPct: 12, depositPct: 30 }),
    want: { ok: true, grandTotal: 9408, depositAmount: 2822.4, balanceAmount: 6585.6 }
  },
  {
    label: "a deposit over 100% is held at the whole total",
    input: base({ depositPct: 150 }),
    want: { ok: true, depositPct: 100, depositAmount: 8400, balanceAmount: 0 }
  },
  {
    label: "GUARD departure before arrival",
    input: base({ checkin: "2026-11-05", checkout: "2026-11-02" }),
    want: { ok: false, nights: 0, grandTotal: 0, problem: "checkout_before_checkin" }
  },
  {
    label: "GUARD arrival and departure on the same day",
    input: base({ checkout: "2026-11-02" }),
    want: { ok: false, nights: 0, grandTotal: 0, problem: "zero_nights" }
  },
  {
    label: "GUARD more guests than the room sleeps",
    input: base({ adults: 3, ages: "7, 3" }),
    want: { ok: false, occupancy: 5, maxGuests: 4, problem: "over_occupancy" }
  },
  {
    label: "GUARD occupancy counts children, free ones too",
    input: base({ adults: 2, ages: "4, 3, 2" }),
    want: { ok: false, occupancy: 5, freeChildren: 3, problem: "over_occupancy" }
  },
  {
    label: "GUARD no adult on the booking",
    input: base({ adults: 0, ages: "7" }),
    want: { ok: false, problem: "no_adults" }
  },
  {
    label: "GUARD no room chosen",
    input: base({ room: null }),
    want: { ok: false, problem: "no_room" }
  },
  {
    label: "GUARD arrival date missing",
    input: base({ checkin: "" }),
    want: { ok: false, nights: 0, problem: "bad_checkin" }
  },
  {
    label: "GUARD arrival date impossible",
    input: base({ checkin: "2026-02-30" }),
    want: { ok: false, problem: "bad_checkin" }
  },
  {
    label: "nothing entered at all",
    input: {},
    want: { ok: false, nights: 0, roomTotal: 0, subtotal: 0, grandTotal: 0, depositAmount: 0 }
  },
  {
    label: "blank room fields are read generously and reported",
    input: base({ room: { name: "Bare", baseRate: 1500 }, adults: 3 }),
    want: { ok: true, includedGuests: 1, extraAdults: 2, extraAdultTotal: 0,
            roomTotal: 4500, warning: "max_guests_unset" }
  },
  {
    label: "no tax rate set is reported, because there is no built-in rate",
    input: base(),
    want: { ok: true, warning: "tax_not_set" }
  },
  {
    label: "a stay below the minimum is a warning, not a refusal",
    input: base({ checkout: "2026-11-03", minNights: 3 }),
    want: { ok: true, nights: 1, warning: "below_min_nights" }
  },
  {
    label: "overlapping seasons are reported and the first listed wins",
    input: base({
      checkin: "2026-12-24", checkout: "2026-12-26",
      seasons: [{ name: "Christmas", from: "2026-12-24", to: "2026-12-26", upliftPct: 50 },
                { name: "Winter", from: "2026-11-01", to: "2027-02-28", upliftPct: 10 }]
    }),
    want: { ok: true, roomTotal: 2 * 4200, warning: "overlapping_seasons" }
  },
  {
    label: "a long stay across the new year, two seasons, extras and tax",
    input: base({
      checkin: "2026-12-29", checkout: "2027-01-08", adults: 3, ages: "9, 4",
      room: COTTAGE, seasons: PEAK, taxPct: 12, depositPct: 25, minNights: 2
    }),
    /* 29, 30, 31 Dec and 1-5 Jan are peak (8 nights at 4200x1.35=5670),
     * 6 and 7 Jan are standard (2 nights at 4200) */
    want: { ok: true, nights: 10, roomTotal: 8 * 5670 + 2 * 4200, groupCount: 2,
            extraAdults: 1, extraAdultTotal: 1 * 900 * 10,
            payingChildren: 1, childTotal: 1 * 450 * 10,
            subtotal: 53760 + 9000 + 4500, taxAmount: 8071.2, grandTotal: 75331.2 }
  },
  {
    label: "ninety nights does not drift",
    input: base({ checkin: "2026-11-02", checkout: "2027-01-31", seasons: PEAK }),
    want: { ok: true, nights: 90 }
  }
];

var NULLABLE_NUMBERS = [];

CASES.forEach(function (c) {
  var r = B.quote(c.input);
  var w = c.want;

  Object.keys(w).forEach(function (k) {
    if (k === "problem") {
      var codes = r.problems.map(function (p) { return p.code; });
      check(c.label + " / problem " + w.problem, codes.indexOf(w.problem) >= 0,
        "got [" + codes.join(", ") + "]");
      return;
    }
    if (k === "warning") {
      var wcodes = r.warnings.map(function (p) { return p.code; });
      check(c.label + " / warning " + w.warning, wcodes.indexOf(w.warning) >= 0,
        "got [" + wcodes.join(", ") + "]");
      return;
    }
    if (k === "groupCount") { eq(c.label + " / rate groups", r.groups.length, w.groupCount); return; }
    if (k === "seasonsUsed") { eq(c.label + " / seasons used", r.seasonsUsed.length, w.seasonsUsed); return; }
    eq(c.label + " / " + k, r[k], w[k]);
  });

  /* every number finite, always */
  Object.keys(r).forEach(function (k) {
    if (typeof r[k] === "number" && NULLABLE_NUMBERS.indexOf(k) < 0) {
      check(c.label + " / finite " + k, isFinite(r[k]), "got " + r[k]);
    }
  });

  /* invariants that have to hold for every row */
  check(c.label + " / inv: parts add to the subtotal",
    near(r.subtotal, B.round2(r.roomTotal + r.extraAdultTotal + r.childTotal)));
  if (r.taxIncluded) {
    check(c.label + " / inv: inclusive tax does not change the total", near(r.grandTotal, r.subtotal));
    check(c.label + " / inv: net plus tax is the subtotal", near(r.subtotal, B.round2(r.netOfTax + r.taxAmount)));
  } else {
    check(c.label + " / inv: subtotal plus tax is the total", near(r.grandTotal, B.round2(r.subtotal + r.taxAmount)));
  }
  check(c.label + " / inv: deposit plus balance is the total",
    near(r.grandTotal, B.round2(r.depositAmount + r.balanceAmount)));
  check(c.label + " / inv: one line per night", r.nightLines.length === r.nights);
  check(c.label + " / inv: nightly lines add to the room total",
    near(r.roomTotal, B.round2(r.nightLines.reduce(function (s, l) { return s + l.rate; }, 0))));
  check(c.label + " / inv: groups add to the room total",
    near(r.roomTotal, B.round2(r.groups.reduce(function (s, g) { return s + g.amount; }, 0))));
  check(c.label + " / inv: groups hold every night",
    r.groups.reduce(function (s, g) { return s + g.nights; }, 0) === r.nights);
  check(c.label + " / inv: no money is negative",
    r.roomTotal >= 0 && r.subtotal >= 0 && r.taxAmount >= 0 && r.grandTotal >= 0 &&
    r.depositAmount >= 0 && r.balanceAmount >= 0);
  check(c.label + " / inv: ok means no problems and at least one night",
    r.ok === (r.problems.length === 0 && r.nights > 0));
});
closeGroup();

/* ================================================================== *
 * 5. Guests, in words
 * ================================================================== */
group("ages and wording");

[
  ["", []], ["7", [7]], ["7, 3", [7, 3]], ["7 3", [7, 3]], ["7;3", [7, 3]],
  [[7, "3"], [7, 3]], ["0", [0]], ["-4", [4]], ["200", []], ["7.9", [7]],
  ["1,2,3,4,5,6,7,8,9,10,11,12", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]],
  [null, []], ["abc", []]
].forEach(function (r) {
  eq("parseAges(" + JSON.stringify(r[0]) + ")", JSON.stringify(B.parseAges(r[0])), JSON.stringify(r[1]));
});

[
  [1, "", 5, "1 adult"],
  [2, "", 5, "2 adults"],
  [2, "7", 5, "2 adults, 1 child (age 7)"],
  [2, "7,3", 5, "2 adults, 2 children (age 7; age 3, free)"],
  [0, "", 5, "0 adults"]
].forEach(function (r) {
  eq("guestLabel(" + r[0] + "," + JSON.stringify(r[1]) + ")", B.guestLabel(r[0], r[1], r[2]), r[3]);
});

[[2800, "INR", "2,800"], [1747.2, "INR", "1,747.20"], [0, "INR", "0"],
 [2800, "PHP", "2,800"], [16307.2, "PHP", "16,307.20"]
].forEach(function (r) {
  var s = B.money(r[0], r[1]);
  check("money(" + r[0] + "," + r[1] + ") shows " + r[2], s.indexOf(r[2]) >= 0, "got " + s);
});
check("money uses the rupee sign for INR", B.money(10, "INR").indexOf("\u20b9") >= 0, B.money(10, "INR"));
check("money uses the peso sign for PHP", B.money(10, "PHP").indexOf("\u20b1") >= 0, B.money(10, "PHP"));
check("money never prints NaN", B.money(NaN, "INR").indexOf("NaN") < 0, B.money(NaN, "INR"));
check("money never prints Infinity", B.money(Infinity, "INR").indexOf("Inf") < 0, B.money(Infinity, "INR"));
closeGroup();

/* ================================================================== *
 * 6. The number wa.me will actually accept
 * ================================================================== */
group("phone normalisation");

var PHONES = [
  ["91", "98765 43210", "919876543210", true],
  ["91", "9876543210", "919876543210", true],
  ["91", "09876543210", "919876543210", true],
  ["91", "+91 98765 43210", "919876543210", true],
  ["91", "0091-98765-43210", "919876543210", true],
  ["91", "919876543210", "919876543210", true],
  ["91", "(98765) 43210", "919876543210", true],
  /* a real ten-digit Indian mobile that happens to start 91 must not be
   * mistaken for a number that already carries the country code */
  ["91", "9198765432", "919198765432", true],
  ["63", "0917 000 0000", "639170000000", true],
  ["63", "9170000000", "639170000000", true],
  ["63", "+63 917 000 0000", "639170000000", true],
  ["63", "639170000000", "639170000000", true],
  ["+91", "98765 43210", "919876543210", true],
  ["91", "123", "91123", false],
  ["91", "", "", false],
  ["91", "0000", "", false],
  ["91", "abc", "", false],
  ["", "919876543210", "919876543210", true],
  ["91", "9876543210987654321", "", false]
];

PHONES.forEach(function (r) {
  var got = B.waDigits(r[0], r[1]);
  eq("waDigits(" + JSON.stringify(r[0]) + "," + JSON.stringify(r[1]) + ") ok", got.ok, r[3]);
  if (r[3]) { eq("waDigits(" + JSON.stringify(r[1]) + ") digits", got.digits, r[2]); }
  check("waDigits(" + JSON.stringify(r[1]) + ") digits only",
    /^[0-9]*$/.test(got.digits), "got " + got.digits);
  check("waDigits(" + JSON.stringify(r[1]) + ") explains a refusal",
    got.ok || got.note.length > 0);
});
check("a plausible number carries no warning note", B.waDigits("91", "98765 43210").note === "");
check("a number that already had the country code says so",
  B.waDigits("91", "919876543210").note.length > 0);
closeGroup();

/* ================================================================== *
 * 7. THE LINK. Awkward input, round-tripped out of a real URL parser.
 * ================================================================== */
group("link encoding");

var AWKWARD = [
  ["a plain line", "Booking enquiry"],
  ["spaces", "Garden room for two"],
  ["ampersand", "Bed & breakfast, tea & coffee"],
  ["plus", "Jo+Ann, 2+2 guests, rate 2800+GST"],
  ["hash and question", "Room #2? Rate #1 best?"],
  ["equals and slash", "rate=2800/night a=b"],
  ["newlines", "Line one\nLine two\n\nLine four"],
  ["carriage returns", "Line one\r\nLine two"],
  ["emoji", "Beach cottage \ud83c\udfd6\ufe0f with a view \ud83d\ude4f"],
  ["rupee and peso signs", "\u20b913,160 or \u20b18,400"],
  ["devanagari", "\u0936\u094d\u0930\u0940 \u0928\u093f\u0935\u093e\u0938 \u0917\u0947\u0938\u094d\u091f \u0939\u093e\u0909\u0938"],
  ["kannada", "\u0ca8\u0cae\u0cb8\u0ccd\u0c95\u0cbe\u0cb0 \u0cae\u0ca6\u0cbf\u0c95\u0cc7\u0cb0\u0cbf"],
  ["tagalog with enye", "Ni\u00f1o Dela Cruz, Pe\u00f1afrancia St."],
  ["tamil", "\u0ba4\u0bae\u0bbf\u0bb4\u0bcd \u0bb5\u0bbf\u0b9f\u0bc1\u0ba4\u0bbf"],
  ["quotes and apostrophes", "The \"Garden\" room, owner's choice"],
  ["angle brackets", "<script>alert(1)</script> & <b>bold</b>"],
  ["percent sign", "100% full, 12% GST, 50%% odd"],
  ["backslash", "C:\\rooms\\garden"],
  ["semicolon and colon", "Check-in: 1 pm; check-out: 11 am"],
  ["tab", "Room\tRate\t2800"],
  ["non-breaking space", "\u20b92\u00a0800 a night"],
  ["zero width joiner", "family \ud83d\udc69\u200d\ud83d\udc67 of three"],
  ["everything at once", "Ni\u00f1o & Jo+Ann \u2014 \u20b913,160 #2 \ud83c\udfd6\ufe0f\n\u0936\u094d\u0930\u0940 100%\there?"]
];

AWKWARD.forEach(function (r) {
  var label = r[0], text = r[1];
  var url = B.waLink("919876543210", text);

  check("wa " + label + ": shape", /^https:\/\/wa\.me\/919876543210\?text=/.test(url), url.slice(0, 60));

  var query = url.slice(url.indexOf("?text=") + 6);
  check("wa " + label + ": no raw space", query.indexOf(" ") < 0);
  check("wa " + label + ": no raw newline", query.indexOf("\n") < 0 && query.indexOf("\r") < 0);
  check("wa " + label + ": no raw tab", query.indexOf("\t") < 0);
  check("wa " + label + ": no raw ampersand", query.indexOf("&") < 0);
  check("wa " + label + ": no raw plus", query.indexOf("+") < 0);
  check("wa " + label + ": no raw hash", query.indexOf("#") < 0);
  check("wa " + label + ": ascii only", /^[\x21-\x7e]*$/.test(query));

  /* the test that matters: a real parser has to hand the message back
   * unchanged, which is what catches a + read as a space */
  var parsed = new URL(url).searchParams.get("text");
  check("wa " + label + ": round trips through a URL parser", parsed === text,
    "got " + JSON.stringify(parsed));
  check("wa " + label + ": round trips through decodeURIComponent",
    decodeURIComponent(query) === text);

  /* and the same message by email, where the body wants CRLF */
  var mail = B.mailtoLink("stay@example.com", "Subject " + label, text);
  check("mail " + label + ": shape", /^mailto:stay@example\.com\?subject=/.test(mail), mail.slice(0, 50));
  check("mail " + label + ": params are separated once", mail.split("&body=").length === 2);
  var mp = new URL(mail).searchParams;
  check("mail " + label + ": subject round trips", mp.get("subject") === "Subject " + label);
  check("mail " + label + ": body round trips with CRLF",
    mp.get("body") === text.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n"),
    "got " + JSON.stringify(mp.get("body")));
});

/* the exact escapes, spelled out, so a regression is obvious */
[
  [" ", "%20"], ["&", "%26"], ["+", "%2B"], ["#", "%23"], ["?", "%3F"],
  ["=", "%3D"], ["\n", "%0A"], ["\r", "%0D"], ["\t", "%09"], ["%", "%25"],
  ["\"", "%22"], ["<", "%3C"], [">", "%3E"], ["\\", "%5C"], [";", "%3B"],
  ["\u20b9", "%E2%82%B9"], ["\u00f1", "%C3%B1"], ["\u00a0", "%C2%A0"],
  ["\ud83c\udfd6", "%F0%9F%8F%96"], ["\u0936", "%E0%A4%B6"]
].forEach(function (r) {
  var url = B.waLink("919876543210", "x" + r[0] + "y");
  check("escape " + JSON.stringify(r[0]) + " as " + r[1],
    url.indexOf("text=x" + r[1] + "y") > 0, url.slice(url.indexOf("?text=")));
});

check("no number means no link", B.waLink("", "hello") === "");
check("a link is built from digits only", B.waLink("+91 98765 43210", "hi").indexOf("wa.me/919876543210?") > 0);
check("no address means no mailto", B.mailtoLink("", "s", "b") === "");
check("a bare word is not an address", B.mailtoLink("nope", "s", "b") === "");
check("an address starting with @ is not an address", B.mailtoLink("@x.com", "s", "b") === "");
check("spaces are stripped from an address", B.mailtoLink(" stay@example.com ", "s", "b").indexOf("mailto:stay@example.com?") === 0);
check("tel carries the plus", B.telLink("919876543210") === "tel:+919876543210");
check("tel of nothing is nothing", B.telLink("") === "");
closeGroup();

/* ================================================================== *
 * 8. The enquiry as a whole
 * ================================================================== */
group("enquiry");

var okQuote = B.quote(base({ taxPct: 12, depositPct: 30, ages: "7" }));
var ctx = {
  property: "Bougainvillea Homestay", currency: "INR", cc: "91", phone: "98765 43210",
  email: "stay@example.com", guestName: "Ni\u00f1o", guestPhone: "+63 917 000 0000", notes: "late & hungry"
};
var e1 = B.enquiry(okQuote, ctx);
check("a good quote gets a WhatsApp link", /^https:\/\/wa\.me\//.test(e1.waUrl));
check("a good quote gets a mailto link", /^mailto:/.test(e1.mailUrl));
check("a good quote gets a tel link", e1.telUrl === "tel:+919876543210");
check("the message carries the dates", e1.message.indexOf("Check-in: Mon 2 Nov 2026") > 0, e1.message);
check("the message carries the room", e1.message.indexOf("Room: Garden room") > 0);
check("the message carries the guests", e1.message.indexOf("Guests: 2 adults, 1 child (age 7)") > 0);
check("the message carries the total", e1.message.indexOf("Total: \u20b910,584") > 0, e1.message);
check("the message carries the deposit", e1.message.indexOf("Deposit to confirm (30%)") > 0);
check("the message carries the guest's name", e1.message.indexOf("Name: Ni\u00f1o") > 0);
check("every message line is Label: value or blank",
  e1.message.split("\n").every(function (l) {
    return l === "" || /^[^:]+: ?.*$/.test(l) || l.indexOf("Booking enquiry") === 0 ||
      l.indexOf("Sent from") === 0;
  }));
check("the subject carries the ISO dates",
  e1.subject.indexOf("2026-11-02 to 2026-11-05") > 0, e1.subject);

var badQuote = B.quote(base({ checkout: "2026-11-01" }));
var e2 = B.enquiry(badQuote, ctx);
check("GUARD a quote with a problem builds no WhatsApp link", e2.waUrl === "");
check("GUARD a quote with a problem builds no mailto link", e2.mailUrl === "");
check("GUARD a quote with a problem is not ok", e2.ok === false);
check("GUARD a quote with a problem still has no message to send", e2.message === "");

var e3 = B.enquiry(okQuote, { property: "X", currency: "INR", cc: "", phone: "", email: "" });
check("no channel at all is reported", e3.warnings.some(function (w) { return w.code === "no_channel"; }));
check("no channel at all is not ok", e3.ok === false);

var e4 = B.enquiry(okQuote, { property: "X", currency: "INR", cc: "91", phone: "", email: "stay@example.com" });
check("email alone is enough", e4.ok === true && e4.waUrl === "" && e4.mailUrl !== "");

var longNotes = new Array(70).join("a very long note about the arrival time ");
var e5 = B.enquiry(okQuote, {
  property: "X", currency: "INR", cc: "91", phone: "98765 43210", notes: longNotes
});
check("an over-long link is reported before it is published",
  e5.warnings.some(function (w) { return w.code === "url_too_long"; }), "length " + e5.length);
check("an over-long link still round trips",
  new URL(e5.waUrl).searchParams.get("text") === e5.message);
check("a bad number is reported",
  B.enquiry(okQuote, { property: "X", cc: "91", phone: "123" }).warnings
    .some(function (w) { return w.code === "phone"; }));
closeGroup();

/* ================================================================== *
 * 9. Escaping, because the owner's own words become HTML
 * ================================================================== */
group("escaping");

[
  ["plain", "plain"],
  ["a & b", "a &amp; b"],
  ["<b>", "&lt;b&gt;"],
  ["</script>", "&lt;/script&gt;"],
  ["&amp;", "&amp;amp;"],
  ["", ""]
].forEach(function (r) {
  eq("escapeHtml(" + JSON.stringify(r[0]) + ")", B.escapeHtml(r[0]), r[1]);
});

[
  ["say \"hi\"", "say &quot;hi&quot;"],
  ["owner's", "owner&#39;s"],
  ["\" onmouseover=alert(1) x=\"", "&quot; onmouseover=alert(1) x=&quot;"]
].forEach(function (r) {
  eq("escapeAttr(" + JSON.stringify(r[0]) + ")", B.escapeAttr(r[0]), r[1]);
});

var js = B.jsonForScript({ name: "</script><img src=x onerror=alert(1)>", sep: "a\u2028b" });
check("jsonForScript closes no script element", js.indexOf("</script") < 0, js);
check("jsonForScript escapes the line separator", js.indexOf("\\u2028") > 0 && js.indexOf("\u2028") < 0);
check("jsonForScript is still JSON", deepSame(JSON.parse(js.replace(/\\u003c/g, "<").replace(/\\u003e/g, ">")),
  { name: "</script><img src=x onerror=alert(1)>", sep: "a\u2028b" }));
closeGroup();

/* ================================================================== *
 * 10. The generated page as a document
 * ================================================================== */
group("generated page");

var CFG = {
  property: "Bougainvillea Homestay", where: "Madikeri, Coorg \u00b7 Karnataka",
  lede: "Three rooms on a working coffee estate, ten minutes from town.",
  currency: "INR", cc: "91", phone: "98765 43210", email: "stay@example.com",
  rooms: [GARDEN, COTTAGE, { name: "", baseRate: 999 }],
  seasons: PEAK.concat([{ name: "", from: "2026-01-01", to: "2026-01-02", upliftPct: 5 }]),
  childFreeUnder: 5, taxLabel: "GST", taxPct: 12, taxIncluded: false,
  depositPct: 30, minNights: 2, checkinTime: "1 pm", checkoutTime: "11 am",
  cancellation: "Free up to 7 days before arrival; the deposit is kept after that.",
  notes: "Tariff includes breakfast.", payLabel: "UPI", payHandle: "estate@bank",
  accent: "forest", generatedOn: "2026-11-24"
};

var page = B.buildPage(CFG);

/* The owner's own words land in this page as text and in attribute values.
 * Text that reads "onerror=alert(1)" is harmless, and so is an attribute whose
 * *value* reads that way; an attribute whose *name* is onerror is not. So the
 * markup is taken apart properly: the script and the stylesheet are set aside
 * (their contents are code, not tags), every tag is split into attributes with
 * the quoting respected, and the rule is applied to attribute names. */
function withoutEmbedded(html) {
  return html.replace(/<script>[\s\S]*?<\/script>/g, "<script></script>")
    .replace(/<style>[\s\S]*?<\/style>/g, "<style></style>");
}

function tagInteriors(html) {
  var src = withoutEmbedded(html);
  var out = [], i = 0;
  while (i < src.length) {
    var a = src.indexOf("<", i);
    if (a < 0) { break; }
    var b = src.indexOf(">", a);
    if (b < 0) { break; }
    out.push(src.slice(a, b + 1));
    i = b + 1;
  }
  return out;
}

/* [{ name, value }] for one tag, quoting respected. */
function attrsOf(tag) {
  var s = tag.replace(/^<\/?/, "").replace(/\/?>$/, "");
  var i = 0, out = [];
  while (i < s.length && !/\s/.test(s[i])) { i++; }   /* the element name */
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) { i++; }
    if (i >= s.length) { break; }
    var name = "";
    while (i < s.length && !/[\s=]/.test(s[i])) { name += s[i]; i++; }
    while (i < s.length && /\s/.test(s[i])) { i++; }
    var value = "";
    if (s[i] === "=") {
      i++;
      while (i < s.length && /\s/.test(s[i])) { i++; }
      var q = s[i];
      if (q === "\"" || q === "'") {
        i++;
        while (i < s.length && s[i] !== q) { value += s[i]; i++; }
        i++;
      } else {
        while (i < s.length && !/\s/.test(s[i])) { value += s[i]; i++; }
      }
    }
    if (name) { out.push({ name: name, value: value }); }
  }
  return out;
}

/* Everything that is not inside a tag and not inside the script element: the
 * words a reader sees. */
function renderedText(html) {
  var body = html.slice(0, html.indexOf("<script>") < 0 ? html.length : html.indexOf("<script>"));
  return body.replace(/<[^>]*>/g, " ");
}

function scriptOf(html) {
  var s = html.indexOf("<script>");
  var e = html.lastIndexOf("</script>");
  return s < 0 || e < 0 ? "" : html.slice(s + "<script>".length, e);
}

function noHandlers(label, html) {
  var handlers = [], jsUrls = [], tags = 0;
  tagInteriors(html).forEach(function (t) {
    tags++;
    attrsOf(t).forEach(function (a) {
      if (/^on/i.test(a.name)) { handlers.push(t); }
      if (/^\s*javascript:/i.test(a.value)) { jsUrls.push(t); }
    });
  });
  check(label + ": tags were found to check", tags > 20, tags + " tags");
  check(label + ": no attribute is an event handler", handlers.length === 0,
    handlers.slice(0, 3).join(" "));
  check(label + ": no attribute is a javascript: URL", jsUrls.length === 0,
    jsUrls.slice(0, 3).join(" "));
}

check("page starts with a doctype", page.indexOf("<!doctype html>") === 0);
check("page declares a language", page.indexOf("<html lang=\"en\">") > 0);
check("page declares utf-8 first", page.indexOf("<meta charset=\"utf-8\">") > 0);
check("page is responsive", page.indexOf("width=device-width") > 0);
check("page declares both colour schemes", page.indexOf("content=\"light dark\"") > 0);
check("page has a title", /<title>[^<]+<\/title>/.test(page));
check("page has a description", page.indexOf("<meta name=\"description\"") > 0);
check("page sends no referrer to WhatsApp", page.indexOf("name=\"referrer\" content=\"no-referrer\"") > 0);

/* the policy: nothing may be fetched, nothing may be posted */
check("page carries a CSP", page.indexOf("Content-Security-Policy") > 0);
check("CSP blocks everything by default", page.indexOf("default-src 'none'") > 0);
check("CSP pins the base URI", page.indexOf("base-uri 'none'") > 0);
check("CSP allows no form target", page.indexOf("form-action 'none'") > 0);
check("CSP has no connect-src, so nothing can be sent", page.indexOf("connect-src") < 0);
check("CSP has no frame-src, so nothing can be embedded", page.indexOf("frame-src") < 0);

/* self-contained */
check("page loads no external resource", page.indexOf(" src=\"http") < 0 && page.indexOf(" src='http") < 0);
check("page loads no script file at all", !/<script[^>]+src=/.test(page));
check("page links no stylesheet", page.indexOf("rel=\"stylesheet\"") < 0);
check("the only link is the tab icon, drawn into the file",
  page.split("<link").length === 2 && page.indexOf("rel=\"icon\" href=\"data:image/svg+xml,") > 0);
check("no link reaches outside the file", !/<link[^>]+href="https?:/.test(page));
check("the tab icon takes the page's own colour",
  B.buildPage({ accent: "teal" }).indexOf(encodeURIComponent("#0f766e")) > 0 ||
  B.buildPage({ accent: "teal" }).indexOf("%230f766e") > 0);
check("page imports no stylesheet", page.indexOf("@import") < 0);
check("page fetches no CSS asset", !/url\(\s*["']?http/.test(page));
check("page embeds exactly one stylesheet", page.split("<style>").length === 2);
check("page embeds exactly one script", page.split("<script>").length === 2);
check("page closes exactly one script", page.split("</script>").length === 2);
check("page makes no request of its own",
  page.indexOf("fetch(") < 0 && page.indexOf("XMLHttpRequest") < 0 &&
  page.indexOf("navigator.sendBeacon") < 0 && page.indexOf("new Image") < 0);
check("page runs no dynamic code", !/\beval\s*\(/.test(page) && !/new\s+Function/.test(page));
check("page stores nothing on the device", page.indexOf("localStorage") < 0 &&
  page.indexOf("sessionStorage") < 0 && page.indexOf("document.cookie") < 0);

/* no inline handler anywhere in it */
noHandlers("page", page);

/* content */
check("page shows the property", page.indexOf("Bougainvillea Homestay") > 0);
check("page shows where it is", page.indexOf("Madikeri") > 0);
check("page lists the rooms", page.indexOf("Garden room") > 0 && page.indexOf("Estate cottage") > 0);
check("page drops a nameless room", page.indexOf("999") < 0);
check("page lists the season", page.indexOf("Peak") > 0 && page.indexOf("+35%") > 0);
check("page states the tax it was given", page.indexOf("GST") > 0 && page.indexOf("12%") > 0);
check("page states the deposit", page.indexOf("30%") > 0);
check("page states the minimum stay", page.indexOf("2 nights") > 0);
check("page states the child policy", page.indexOf("Under 5 stay free") > 0);
check("page states the payment handle", page.indexOf("estate@bank") > 0);
check("page admits it cannot take a payment",
  page.indexOf("cannot take a payment or hold a room") > 0);
check("page carries a working WhatsApp link", page.indexOf("https://wa.me/919876543210?text=") > 0);
check("page carries a per-room enquiry link", page.split("https://wa.me/").length >= 4);
check("page carries a call link", page.indexOf("tel:+919876543210") > 0);
check("page carries a mail link", page.indexOf("mailto:stay@example.com") > 0);
check("page escapes the ampersand in a mailto", page.indexOf("&amp;body=") > 0 || page.indexOf("mailto:stay@example.com\"") > 0);
check("the live panel is hidden until the script reveals it",
  page.indexOf("id=\"bp-panel\" hidden") > 0);
check("the rooms table works with no script at all",
  page.indexOf("Enquire about this room") > 0);

/* a page built from nothing at all must still be a page */
var empty = B.buildPage({});
check("an empty configuration still yields a document", empty.indexOf("<!doctype html>") === 0);
check("an empty configuration says there are no rooms", empty.indexOf("No rooms have been added") > 0);
check("an empty configuration says there is no contact", empty.indexOf("No WhatsApp number or email") > 0);
check("an empty configuration prints no NaN", renderedText(empty).indexOf("NaN") < 0);
check("an empty configuration prints no undefined", renderedText(empty).indexOf("undefined") < 0);
check("an empty configuration prints no null", renderedText(empty).indexOf("null") < 0);
check("a full page prints no NaN", renderedText(page).indexOf("NaN") < 0);
check("a full page prints no undefined", renderedText(page).indexOf("undefined") < 0);

/* hostile owner input: the owner's words are data, never markup */
var HOSTILE = {
  property: "</script><img src=x onerror=alert(1)>",
  where: "\"><svg onload=alert(2)>",
  lede: "A & B <b>bold</b> 'quoted' \"double\"",
  currency: "PHP", cc: "63", phone: "0917 000 0000", email: "a\"b@example.com",
  rooms: [{ name: "The \"Garden\" & <Lawn> room", baseRate: 2500, includedGuests: 2, maxGuests: 3, extraAdultRate: 500, childRate: 250 }],
  seasons: [{ name: "</style><script>alert(3)</script>", from: "2026-12-01", to: "2026-12-10", upliftPct: 20 }],
  childFreeUnder: 4, taxLabel: "VAT & LGU tax", taxPct: 12,
  cancellation: "Line one\u2028line two", notes: "u\u2029v",
  accent: "<script>", generatedOn: "2026-11-24"
};
var hp = B.buildPage(HOSTILE);
check("HOSTILE no injected script element", hp.split("<script").length === 2, hp.split("<script").length + " found");
check("HOSTILE no injected script closer", hp.split("</script").length === 2);
check("HOSTILE no injected style element", hp.split("<style").length === 2);
check("HOSTILE no injected image", hp.indexOf("<img") < 0);
check("HOSTILE no injected svg", hp.indexOf("<svg") < 0);
noHandlers("HOSTILE", hp);
check("HOSTILE the hostile text is still shown, escaped",
  hp.indexOf("&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;") > 0);
check("HOSTILE a quote in an attribute cannot break out",
  hp.indexOf("&quot;") > 0 && !/content="[^"]*"[^">]*=/.test(hp));
check("HOSTILE an unknown accent falls back", hp.indexOf("data-accent=\"rose\"") > 0);
/* U+2028 and U+2029 are ordinary characters in HTML text and would be line
 * breaks inside a JavaScript string, so they have to be escaped in the script
 * and may stay as they are in the prose. */
check("HOSTILE the line separator is escaped in the script", scriptOf(hp).indexOf("\u2028") < 0);
check("HOSTILE the paragraph separator is escaped in the script", scriptOf(hp).indexOf("\u2029") < 0);
check("HOSTILE the separators survive in the prose as text",
  hp.indexOf("Line one\u2028line two") > 0);
check("HOSTILE the hostile season name is data inside the script",
  scriptOf(hp).indexOf("\\u003c/style\\u003e") > 0, scriptOf(hp).slice(-400));
check("HOSTILE the peso currency carried through", hp.indexOf("\u20b1") > 0);

/* the file name offered for download */
[
  [{ property: "Bougainvillea Homestay" }, "bougainvillea-homestay-booking.html"],
  [{ property: "  " }, "booking-booking.html"],
  [{ property: "Caf\u00e9 & Rooms!!" }, "caf-rooms-booking.html"],
  [{}, "booking-booking.html"]
].forEach(function (r) {
  eq("fileNameFor(" + JSON.stringify(r[0]) + ")", B.fileNameFor(r[0]), r[1]);
});

/* the preview is the same page without the script */
var prev = B.previewHtml(CFG);
check("the preview is body markup", prev.indexOf("<div class=\"bp-wrap\">") === 0);
check("the preview carries no script", prev.indexOf("<script") < 0);
check("the preview ends cleanly", prev.slice(-6) === "</div>");
check("the preview shows the same rooms", prev.indexOf("Garden room") > 0);
closeGroup();

/* ================================================================== *
 * 11. The stylesheet cannot escape the preview
 * ================================================================== */
group("stylesheet");

if (ON_NODE) {
  var cssOnDisk = fs.readFileSync(path.join(__dirname, "..", "assets", "page.css"), "utf8");
  check("assets/page.css is the generated page's stylesheet, byte for byte",
    cssOnDisk === B.PAGE_CSS,
    "disk " + cssOnDisk.length + " bytes, module " + B.PAGE_CSS.length + " bytes");
} else {
  skipped.push("assets/page.css matches the module byte for byte (needs the file system)");
}

/* Collect every selector, at the top level and inside @media, and insist each
 * one is confined to a .bp subtree: the tool loads this very file to render
 * the preview, so a stray selector would restyle the tool itself. */
(function () {
  var src = B.PAGE_CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  var depth = 0, buf = "", selectors = [], bad = [];
  for (var i = 0; i < src.length; i++) {
    var ch = src[i];
    if (ch === "{") {
      var head = buf.trim();
      buf = "";
      if (head.charAt(0) !== "@") { selectors.push(head); }
      depth++;
    } else if (ch === "}") { depth--; buf = ""; } else { buf += ch; }
  }
  check("the stylesheet's braces balance", depth === 0, "depth " + depth);
  check("the stylesheet has selectors to check", selectors.length > 20, selectors.length + " found");
  selectors.forEach(function (sel) {
    sel.split(",").forEach(function (part) {
      var t = part.trim();
      if (!t) { return; }
      if (!/\.bp\b/.test(t)) { bad.push(t); return; }
      if (/[+~]/.test(t)) { bad.push(t); }
    });
  });
  check("every selector is confined to a .bp subtree", bad.length === 0,
    bad.slice(0, 4).join(" | "));
  check("the stylesheet declares no font to download",
    B.PAGE_CSS.indexOf("@font-face") < 0 && B.PAGE_CSS.indexOf("googleapis") < 0);
  check("the stylesheet asks for no serif",
    !/\bserif\b/.test(B.PAGE_CSS.replace(/sans-serif/g, "")));
  check("the stylesheet handles dark mode",
    B.PAGE_CSS.indexOf("prefers-color-scheme: dark") > 0);
  check("the stylesheet prints", B.PAGE_CSS.indexOf("@media print") > 0);
})();
closeGroup();

/* ================================================================== *
 * 12. The engine stays pure
 * ================================================================== */
group("purity");

var PURE_SOURCE = B.engineSource(false);
[
  ["document", /\bdocument\b/],
  ["window", /\bwindow\b/],
  ["Date", /\bDate\b/],
  ["fetch", /\bfetch\s*\(/],
  ["XMLHttpRequest", /XMLHttpRequest/],
  ["eval", /\beval\s*\(/],
  ["new Function", /new\s+Function/],
  ["localStorage", /localStorage/],
  ["setTimeout", /setTimeout/],
  ["require", /\brequire\s*\(/],
  ["import", /\bimport\s*\(/]
].forEach(function (r) {
  check("the engine never mentions " + r[0], !r[1].test(PURE_SOURCE));
});
check("the engine ran with no DOM at all", typeof document === "undefined");

var BOOT_SOURCE = B.engineSource(true).slice(PURE_SOURCE.length);
[
  ["fetch", /\bfetch\s*\(/], ["XMLHttpRequest", /XMLHttpRequest/],
  ["eval", /\beval\s*\(/], ["new Function", /new\s+Function/],
  ["localStorage", /localStorage/], ["innerHTML", /innerHTML/],
  ["document.write", /document\s*\.\s*write/]
].forEach(function (r) {
  check("the page's wiring never uses " + r[0], !r[1].test(BOOT_SOURCE));
});
closeGroup();

/* ================================================================== *
 * 13. The arithmetic the generated page itself does
 *
 * The page carries the engine. The bundle it carries is parsed, loaded, and
 * run against every scenario above, so what a guest's phone computes is what
 * these tests computed.
 * ================================================================== */
group("the page's own engine");

if (!ON_NODE) {
  skipped.push("the generated page's own engine is loaded and re-run against every scenario (needs a file system and node --check)");
} else {
var tmp = fs.mkdtempSync(path.join(os.tmpdir(), "booking-engine-"));
var bundlePath = path.join(tmp, "engine.js");
fs.writeFileSync(bundlePath, B.guestBundleForNode());

var parsed = true;
try {
  cp.execFileSync(process.execPath, ["--check", bundlePath], { stdio: "pipe" });
} catch (err) {
  parsed = false;
  check("the bundle written into the page is valid JavaScript", false,
    String(err.stderr || err.message).split("\n").slice(0, 3).join(" "));
}
if (parsed) {
  check("the bundle written into the page is valid JavaScript", true);

  var pageHtml = B.buildPage(CFG);
  var scriptStart = pageHtml.indexOf("<script>") + "<script>".length;
  var scriptEnd = pageHtml.lastIndexOf("</script>");
  var inPage = pageHtml.slice(scriptStart, scriptEnd);
  var livePath = path.join(tmp, "in-page.js");
  fs.writeFileSync(livePath, inPage);
  try {
    cp.execFileSync(process.execPath, ["--check", livePath], { stdio: "pipe" });
    check("the script inside the finished page is valid JavaScript", true);
  } catch (err2) {
    check("the script inside the finished page is valid JavaScript", false,
      String(err2.stderr || err2.message).split("\n").slice(0, 3).join(" "));
  }
  check("the page's script carries the whole engine",
    ["function quote(", "function enquiry(", "function waLink(", "function boot("]
      .every(function (f) { return inPage.indexOf(f) > 0; }));
  check("the page's script carries the property's own data",
    inPage.indexOf("\"Bougainvillea Homestay\"") > 0);
  check("the page's script runs itself", inPage.indexOf("boot(DATA, document);") > 0);

  var E = require(bundlePath);

  var drift = 0, driftNote = "";
  CASES.forEach(function (c) {
    var mine = B.quote(c.input);
    var theirs = E.quote(c.input);
    if (!deepSame(mine, theirs)) {
      drift++;
      if (!driftNote) { driftNote = c.label; }
    }
  });
  check("the page computes every scenario exactly as the tool does (" + CASES.length + " rows)",
    drift === 0, drift + " differ, first: " + driftNote);

  var linkDrift = 0;
  AWKWARD.forEach(function (r) {
    if (B.waLink("919876543210", r[1]) !== E.waLink("919876543210", r[1])) { linkDrift++; }
    if (B.mailtoLink("a@b.com", "s", r[1]) !== E.mailtoLink("a@b.com", "s", r[1])) { linkDrift++; }
  });
  check("the page encodes every awkward payload exactly as the tool does", linkDrift === 0,
    linkDrift + " differ");

  var phoneDrift = 0;
  PHONES.forEach(function (r) {
    if (!deepSame(B.waDigits(r[0], r[1]), E.waDigits(r[0], r[1]))) { phoneDrift++; }
  });
  check("the page normalises every number exactly as the tool does", phoneDrift === 0,
    phoneDrift + " differ");

  var msgDrift = 0;
  CASES.forEach(function (c) {
    var mine = B.quote(c.input);
    if (!mine.ok) { return; }
    if (B.message(mine, ctx) !== E.message(mine, ctx)) { msgDrift++; }
    if (!deepSame(B.enquiry(mine, ctx), E.enquiry(mine, ctx))) { msgDrift++; }
  });
  check("the page composes every message exactly as the tool does", msgDrift === 0,
    msgDrift + " differ");
}
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* a temp dir */ }
}
closeGroup();

/* ---- report ---- */
failures.forEach(function (f) { console.log("FAIL  " + f); });
if (failures.length) { console.log(""); }
groups.forEach(function (g) {
  console.log("  " + g.name + ": " + g.asserts + " assertions");
});
skipped.forEach(function (s) { console.log("  skipped: " + s); });
console.log("");
console.log("scenarios: " + CASES.length + " quotes, " + AWKWARD.length + " link payloads, " +
  PHONES.length + " numbers");
console.log("asserts:   " + (pass + fail) + "   passed: " + pass + "   failed: " + fail);
console.log(fail === 0 ? "RESULT: PASS" : "RESULT: FAIL");

if (ON_NODE) {
  process.exit(fail === 0 ? 0 : 1);
} else if (typeof document !== "undefined") {
  var head = document.getElementById("summary");
  if (head) {
    head.textContent = fail === 0
      ? "PASS — " + pass + " assertions"
      : "FAIL — " + fail + " of " + (pass + fail) + " assertions";
  }
  var body = document.getElementById("rows");
  if (body) {
    groups.forEach(function (g) {
      var tr = document.createElement("tr");
      var a = document.createElement("td"); a.textContent = g.name;
      var b = document.createElement("td"); b.className = "num"; b.textContent = g.asserts;
      tr.appendChild(a); tr.appendChild(b);
      body.appendChild(tr);
    });
    skipped.forEach(function (s) {
      var tr = document.createElement("tr"); tr.className = "sub";
      var a = document.createElement("td"); a.textContent = "skipped here: " + s;
      var b = document.createElement("td"); b.className = "num"; b.textContent = "—";
      tr.appendChild(a); tr.appendChild(b);
      body.appendChild(tr);
    });
    var tr2 = document.createElement("tr"); tr2.className = "total";
    var a2 = document.createElement("td"); a2.textContent = fail === 0 ? "all passed" : "failures, see the console";
    var b2 = document.createElement("td"); b2.className = "num"; b2.textContent = pass + "/" + (pass + fail);
    tr2.appendChild(a2); tr2.appendChild(b2);
    body.appendChild(tr2);
  }
  var det = document.getElementById("fails");
  if (det && failures.length) {
    det.textContent = failures.join("\n");
    det.hidden = false;
  }
}
