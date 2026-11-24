/* Commission-free direct booking page — rates engine and page builder.
 *
 * Two halves live in this file.
 *
 *   1. THE ENGINE (num … enquiry). Pure functions: plain values in, plain
 *      values out. No DOM, no network, no Date, no dependencies. These are the
 *      functions the tool computes with, and the *same function sources* are
 *      written verbatim into every page this tool generates (see guestBundle),
 *      so the page a guest uses and the quote the owner tested are the same
 *      arithmetic — not two copies of it.
 *
 *   2. THE PAGE BUILDER (escapeHtml … buildPage). Turns the owner's property,
 *      rooms, seasons and policies into one self-contained HTML file: its own
 *      stylesheet, its own copy of the engine, no external request of any kind,
 *      and a Content-Security-Policy that makes that a rule and not a promise.
 *
 * Dates are handled as YYYY-MM-DD strings and converted to day numbers with
 * integer arithmetic. No Date object is used anywhere in the engine: a booking
 * calendar must never shift by a day because of a time zone or a DST change.
 *
 * Tests: node tests/booking.test.js
 */
(function (root) {
  "use strict";

  /* ------------------------------------------------------------------ *
   * Constants. These are also written into the generated page, as JSON,
   * because the emitted engine functions refer to them by name.
   * ------------------------------------------------------------------ */

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  var WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  /* Only two currencies, because this tool serves two markets. The locale is
   * what gives ₹1,16,480 its Indian grouping and ₱116,480 its western one. */
  var CURRENCIES = {
    INR: { code: "INR", symbol: "\u20b9", locale: "en-IN", country: "India", cc: "91" },
    PHP: { code: "PHP", symbol: "\u20b1", locale: "en-PH", country: "Philippines", cc: "63" }
  };

  /* Length of a national number, country code stripped, for the two country
   * codes this tool knows. Used only to work out whether the owner typed the
   * country code into the number field as well — never to reject a number. */
  var NATIONAL_DIGITS = { "91": [10], "63": [10] };

  /* ================================================================== *
   * THE ENGINE — emitted verbatim into every generated page.
   * ================================================================== */

  /* Anything blank, junk or non-finite is 0. A booking page that prints NaN
   * has lost the booking. */
  function num(v) {
    if (typeof v === "number") { return isFinite(v) ? v : 0; }
    if (v === null || v === undefined) { return 0; }
    var s = String(v).replace(/[\s,\u00a0\u202f]/g, "");
    if (s === "") { return 0; }
    var n = parseFloat(s);
    return isFinite(n) ? n : 0;
  }

  function nonNeg(v) { var n = num(v); return n > 0 ? n : 0; }

  function round2(n) {
    if (!isFinite(n)) { return 0; }
    return Math.round((n + (n < 0 ? -1e-9 : 1e-9)) * 100) / 100;
  }

  /* A rate change of -100% would make a night free; anything below that would
   * make it negative, which is not a discount, it is a mistake. */
  function clampPct(v) { var n = num(v); if (n < -100) { return -100; } return n; }

  function digitsOf(v) { return String(v === null || v === undefined ? "" : v).replace(/[^0-9]/g, ""); }

  /* Days since 1970-01-01 from a civil date, and back. Howard Hinnant's
   * algorithm: exact for any year, no Date object, no time zone. */
  function daysFromCivil(y, m, d) {
    var yy = y - (m <= 2 ? 1 : 0);
    var era = Math.floor(yy / 400);
    var yoe = yy - era * 400;
    var doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
    var doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
    return era * 146097 + doe - 719468;
  }

  function civilFromDays(z) {
    var zz = z + 719468;
    var era = Math.floor(zz / 146097);
    var doe = zz - era * 146097;
    var yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) -
      Math.floor(doe / 146096)) / 365);
    var y = yoe + era * 400;
    var doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
    var mp = Math.floor((5 * doy + 2) / 153);
    var d = doy - Math.floor((153 * mp + 2) / 5) + 1;
    var m = mp + (mp < 10 ? 3 : -9);
    return { y: y + (m <= 2 ? 1 : 0), m: m, d: d };
  }

  /* Strict YYYY-MM-DD only, and the date has to be real: 2026-02-30 and
   * 2027-02-29 are rejected by round-tripping through the day number. */
  function parseISO(s) {
    var m = /^\s*(\d{4})-(\d{2})-(\d{2})\s*$/.exec(String(s === null || s === undefined ? "" : s));
    if (!m) { return null; }
    var y = parseInt(m[1], 10), mo = parseInt(m[2], 10), d = parseInt(m[3], 10);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) { return null; }
    var days = daysFromCivil(y, mo, d);
    var back = civilFromDays(days);
    if (back.y !== y || back.m !== mo || back.d !== d) { return null; }
    return { y: y, m: mo, d: d, days: days };
  }

  function isoToDays(s) { var p = parseISO(s); return p ? p.days : null; }

  function daysToISO(n) {
    var c = civilFromDays(n);
    return c.y + "-" + (c.m < 10 ? "0" : "") + c.m + "-" + (c.d < 10 ? "0" : "") + c.d;
  }

  /* "Thu 24 Dec 2026" — fixed English, no locale, so the message a guest sends
   * and the message the owner tested read identically on every device. */
  function formatDate(s) {
    var p = parseISO(s);
    if (!p) { return ""; }
    var wd = ((p.days + 4) % 7 + 7) % 7;
    return WEEKDAYS[wd] + " " + p.d + " " + MONTHS[p.m - 1] + " " + p.y;
  }

  /* Nights, not days: 24th to 27th is three nights. null when either end is
   * not a real date; negative when the departure is before the arrival, which
   * the caller reports rather than silently fixes. */
  function nightsBetween(checkin, checkout) {
    var a = isoToDays(checkin), b = isoToDays(checkout);
    if (a === null || b === null) { return null; }
    return b - a;
  }

  /* First listed season that covers the night wins, so the owner can put a
   * narrow period above a broad one and get the obvious result. The night is
   * the date slept, from the arrival date to the day before departure. */
  function seasonForNight(iso, seasons) {
    var day = isoToDays(iso);
    if (day === null || !seasons) { return null; }
    for (var i = 0; i < seasons.length; i++) {
      var s = seasons[i];
      if (!s || !s.name) { continue; }
      var from = isoToDays(s.from), to = isoToDays(s.to);
      if (from === null || to === null || to < from) { continue; }
      if (day >= from && day <= to) { return s; }
    }
    return null;
  }

  /* "7, 3" or "7 3" or [7, "3"] — anything the guest might type. Ages above
   * 120 are junk; more than ten children is not a room booking. */
  function parseAges(v) {
    var parts;
    if (Object.prototype.toString.call(v) === "[object Array]") { parts = v; }
    else { parts = String(v === null || v === undefined ? "" : v).split(/[^0-9.]+/); }
    var out = [];
    for (var i = 0; i < parts.length && out.length < 10; i++) {
      var s = String(parts[i]).replace(/\s/g, "");
      if (s === "") { continue; }
      var n = Math.floor(num(s));
      if (n < 0 || n > 120) { continue; }
      out.push(n);
    }
    return out;
  }

  /* ---------------- the quote ---------------- */

  /* Nights priced one at a time at that night's seasonal rate, then the people
   * the base rate does not cover, then the tax the owner set. Everything the
   * guest will actually pay, and nothing hidden. */
  function quote(input) {
    var q = input || {};
    var problems = [];
    var warnings = [];
    function problem(code, text) { problems.push({ code: code, text: text }); }
    function warn(code, text) { warnings.push({ code: code, text: text }); }

    var room = q.room || null;
    var roomName = room && room.name ? String(room.name) : "";
    if (!roomName) { problem("no_room", "Choose a room."); }

    /* dates */
    var inDays = isoToDays(q.checkin);
    var outDays = isoToDays(q.checkout);
    if (inDays === null) { problem("bad_checkin", "Pick an arrival date."); }
    if (outDays === null) { problem("bad_checkout", "Pick a departure date."); }
    var nights = 0;
    if (inDays !== null && outDays !== null) {
      var span = outDays - inDays;
      if (span < 0) {
        problem("checkout_before_checkin",
          "The departure date is before the arrival date.");
      } else if (span === 0) {
        problem("zero_nights",
          "Arrival and departure are the same day, which is no nights. Pick a later departure date.");
      } else {
        nights = span;
      }
    }

    /* people */
    var adults = Math.floor(nonNeg(q.adults));
    var ages = parseAges(q.ages);
    var children = ages.length;
    var occupancy = adults + children;
    if (adults < 1) { problem("no_adults", "At least one adult has to be on the booking."); }

    var included = Math.floor(nonNeg(room && room.includedGuests));
    if (included < 1) {
      included = 1;
      if (roomName) { warn("included_guests_unset", "Rate includes is blank for " + roomName + ", so it is read as one adult."); }
    }
    var maxGuests = Math.floor(nonNeg(room && room.maxGuests));
    if (roomName && maxGuests < 1) {
      warn("max_guests_unset", "Sleeps is blank for " + roomName + ", so the occupancy limit is not checked.");
    } else if (maxGuests >= 1 && occupancy > maxGuests) {
      problem("over_occupancy", roomName + " sleeps " + maxGuests + ", and this is " +
        occupancy + " " + (occupancy === 1 ? "guest" : "guests") + ". Ask about a second room.");
    }

    /* nights, one at a time, grouped for the breakdown */
    var baseRate = nonNeg(room && room.baseRate);
    if (roomName && baseRate <= 0) { warn("no_rate", "No nightly rate is set for " + roomName + "."); }
    var nightLines = [];
    var groups = [];
    var roomTotal = 0;
    var seasonsUsed = [];
    for (var i = 0; i < nights; i++) {
      var iso = daysToISO(inDays + i);
      var season = seasonForNight(iso, q.seasons);
      var uplift = season ? clampPct(season.upliftPct) : 0;
      var rate = round2(baseRate * (1 + uplift / 100));
      var label = season ? String(season.name) : "Standard rate";
      nightLines.push({ date: iso, season: label, rate: rate, upliftPct: uplift });
      roomTotal = round2(roomTotal + rate);
      if (season && seasonsUsed.indexOf(label) < 0) { seasonsUsed.push(label); }
      var g = groups.length ? groups[groups.length - 1] : null;
      if (g && g.season === label && g.rate === rate) {
        g.nights += 1;
        g.amount = round2(g.amount + rate);
        g.to = iso;
      } else {
        groups.push({ season: label, rate: rate, nights: 1, amount: rate, from: iso, to: iso });
      }
    }

    /* the people the base rate does not cover */
    var extraAdultRate = nonNeg(room && room.extraAdultRate);
    var extraAdults = adults > included ? adults - included : 0;
    var extraAdultTotal = round2(extraAdults * extraAdultRate * nights);

    var freeUnder = nonNeg(q.childFreeUnder);
    var childRate = nonNeg(room && room.childRate);
    var payingChildren = 0, freeChildren = 0;
    for (var c = 0; c < ages.length; c++) {
      if (ages[c] < freeUnder) { freeChildren += 1; } else { payingChildren += 1; }
    }
    var childTotal = round2(payingChildren * childRate * nights);

    var subtotal = round2(roomTotal + extraAdultTotal + childTotal);

    /* tax, at whatever rate the owner entered — there is no built-in rate */
    var taxPct = nonNeg(q.taxPct);
    var taxIncluded = !!q.taxIncluded;
    var taxLabel = q.taxLabel ? String(q.taxLabel) : "Tax";
    var taxAmount, netOfTax, grandTotal;
    if (taxIncluded) {
      grandTotal = subtotal;
      taxAmount = taxPct > 0 ? round2(subtotal * taxPct / (100 + taxPct)) : 0;
      netOfTax = round2(subtotal - taxAmount);
    } else {
      taxAmount = round2(subtotal * taxPct / 100);
      netOfTax = subtotal;
      grandTotal = round2(subtotal + taxAmount);
    }
    if (taxPct <= 0) {
      warn("tax_not_set", "No tax rate is set. Accommodation tax differs by state in India and by city or municipality in the Philippines, so enter your own rate if one applies to you.");
    }

    /* deposit */
    var depositPct = nonNeg(q.depositPct);
    if (depositPct > 100) { depositPct = 100; }
    var depositAmount = round2(grandTotal * depositPct / 100);
    var balanceAmount = round2(grandTotal - depositAmount);

    var minNights = Math.floor(nonNeg(q.minNights));
    if (nights > 0 && minNights > 1 && nights < minNights) {
      warn("below_min_nights", "Minimum stay is " + minNights + " nights, and this is " +
        nights + ".");
    }

    /* seasons the owner got wrong, reported once */
    var seasons = q.seasons || [];
    for (var s1 = 0; s1 < seasons.length; s1++) {
      var a = seasons[s1];
      if (!a || !a.name) { continue; }
      var af = isoToDays(a.from), at = isoToDays(a.to);
      if (af === null || at === null) {
        warn("bad_season_dates", "Season \u201c" + a.name + "\u201d has no usable dates and is ignored.");
        continue;
      }
      if (at < af) {
        warn("bad_season_dates", "Season \u201c" + a.name + "\u201d ends before it starts and is ignored.");
        continue;
      }
      for (var s2 = s1 + 1; s2 < seasons.length; s2++) {
        var b = seasons[s2];
        if (!b || !b.name) { continue; }
        var bf = isoToDays(b.from), bt = isoToDays(b.to);
        if (bf === null || bt === null || bt < bf) { continue; }
        if (af <= bt && bf <= at) {
          warn("overlapping_seasons", "Seasons \u201c" + a.name + "\u201d and \u201c" + b.name +
            "\u201d overlap. Nights in the overlap take \u201c" + a.name + "\u201d, the one listed first.");
        }
      }
    }

    var ok = problems.length === 0 && nights > 0;

    return {
      ok: ok,
      problems: problems,
      warnings: warnings,

      roomName: roomName,
      checkin: inDays === null ? "" : daysToISO(inDays),
      checkout: outDays === null ? "" : daysToISO(outDays),
      nights: nights,
      nightLines: nightLines,
      groups: groups,
      seasonsUsed: seasonsUsed,

      adults: adults,
      ages: ages,
      children: children,
      occupancy: occupancy,
      maxGuests: maxGuests,
      includedGuests: included,
      extraAdults: extraAdults,
      payingChildren: payingChildren,
      freeChildren: freeChildren,
      childFreeUnder: freeUnder,

      roomTotal: roomTotal,
      extraAdultTotal: extraAdultTotal,
      childTotal: childTotal,
      subtotal: subtotal,

      taxLabel: taxLabel,
      taxPct: taxPct,
      taxIncluded: taxIncluded,
      taxAmount: taxAmount,
      netOfTax: netOfTax,

      grandTotal: grandTotal,
      perNight: nights > 0 ? round2(grandTotal / nights) : 0,
      depositPct: depositPct,
      depositAmount: depositAmount,
      balanceAmount: balanceAmount
    };
  }

  /* ---------------- money and wording ---------------- */

  /* Whole amounts print whole, because a tariff is quoted as ₹2,800 and not
   * ₹2,800.00; anything with paise or centavos in it prints both places,
   * because ₹1,747.2 is not how money is written. */
  function money(amount, currencyCode) {
    var cur = CURRENCIES[currencyCode] ? CURRENCIES[currencyCode] : CURRENCIES.INR;
    var n = isFinite(amount) ? round2(amount) : 0;
    var places = Math.round(n * 100) % 100 === 0 ? 0 : 2;
    try {
      return new Intl.NumberFormat(cur.locale, {
        style: "currency", currency: cur.code,
        minimumFractionDigits: places, maximumFractionDigits: places
      }).format(n);
    } catch (e) {
      return cur.symbol + n.toFixed(places);
    }
  }

  function guestLabel(adults, ages, freeUnder) {
    var bits = [];
    var a = Math.floor(nonNeg(adults));
    bits.push(a + " " + (a === 1 ? "adult" : "adults"));
    var list = parseAges(ages);
    if (list.length) {
      var shown = [];
      for (var i = 0; i < list.length; i++) {
        shown.push(list[i] + (list[i] < nonNeg(freeUnder) ? ", free" : ""));
      }
      bits.push(list.length + " " + (list.length === 1 ? "child" : "children") +
        " (age " + shown.join("; age ") + ")");
    }
    return bits.join(", ");
  }

  /* The message that lands in the owner's WhatsApp. Every line is
   * "Label: value" on purpose, so a human reads it at a glance and a
   * spreadsheet or a script can pull it apart later. */
  function message(q, ctx) {
    var c = ctx || {};
    var cur = c.currency || "INR";
    var L = [];
    L.push("Booking enquiry" + (c.property ? " \u2014 " + c.property : ""));
    L.push("");
    L.push("Check-in: " + (q.checkin ? formatDate(q.checkin) : "-"));
    L.push("Check-out: " + (q.checkout ? formatDate(q.checkout) : "-"));
    L.push("Nights: " + q.nights);
    L.push("Room: " + (q.roomName || "-"));
    L.push("Guests: " + guestLabel(q.adults, q.ages, q.childFreeUnder));
    L.push("");
    L.push("Room (" + q.nights + " " + (q.nights === 1 ? "night" : "nights") + "): " +
      money(q.roomTotal, cur));
    if (q.extraAdultTotal > 0) {
      L.push("Extra adults (" + q.extraAdults + "): " + money(q.extraAdultTotal, cur));
    }
    if (q.childTotal > 0) {
      L.push("Children (" + q.payingChildren + "): " + money(q.childTotal, cur));
    }
    if (q.taxPct > 0) {
      L.push(q.taxLabel + " " + q.taxPct + "%" + (q.taxIncluded ? " (included)" : "") +
        ": " + money(q.taxAmount, cur));
    }
    L.push("Total: " + money(q.grandTotal, cur));
    if (q.depositPct > 0) {
      L.push("Deposit to confirm (" + q.depositPct + "%): " + money(q.depositAmount, cur));
    }
    L.push("");
    if (c.guestName) { L.push("Name: " + c.guestName); }
    if (c.guestPhone) { L.push("Phone: " + c.guestPhone); }
    if (c.notes) { L.push("Notes: " + c.notes); }
    if (c.guestName || c.guestPhone || c.notes) { L.push(""); }
    L.push("Sent from the booking page" + (c.property ? " of " + c.property : "") + ".");
    return L.join("\n");
  }

  function subjectLine(q, ctx) {
    var c = ctx || {};
    var s = "Booking enquiry" + (c.property ? " \u2014 " + c.property : "");
    if (q.checkin && q.checkout && q.nights > 0) {
      s += " \u2014 " + q.checkin + " to " + q.checkout + " (" + q.nights +
        " " + (q.nights === 1 ? "night" : "nights") + ")";
    }
    return s;
  }

  /* ---------------- the links ---------------- */

  /* wa.me wants digits only: no plus, no spaces, no dashes, country code
   * first. Getting this wrong is the single commonest reason a booking link
   * silently does nothing, so the work is done here and reported.
   *
   * A leading + or 00 means the owner typed the full international number, so
   * the country code box is not applied again. A leading 0 is a national trunk
   * prefix and is dropped. If what is left already starts with the country
   * code AND the rest is a full national number, it is taken as already
   * international — that is what tells 9198765432 (a real ten-digit Indian
   * mobile) apart from 919876543210 (the same number with 91 in front). */
  function waDigits(cc, local) {
    var raw = String(local === null || local === undefined ? "" : local);
    var hadPlus = /^\s*\+/.test(raw);
    var code = digitsOf(cc);
    var loc = digitsOf(raw);
    var note = "";
    var full;

    if (loc === "") { return { digits: "", ok: false, note: "No number yet." }; }

    if (hadPlus) {
      full = loc;
    } else if (loc.length > 2 && loc.slice(0, 2) === "00") {
      full = loc.slice(2);
    } else {
      var trimmed = loc.replace(/^0+/, "");
      if (trimmed === "") { return { digits: "", ok: false, note: "That is only zeros." }; }
      var lens = NATIONAL_DIGITS[code] || null;
      var national = lens && lens.indexOf(trimmed.length) >= 0;
      var alreadyIntl = code !== "" && trimmed.indexOf(code) === 0 &&
        (lens ? lens.indexOf(trimmed.length - code.length) >= 0
              : trimmed.length - code.length >= 8);
      if (national) { full = code + trimmed; }
      else if (alreadyIntl) {
        full = trimmed;
        note = "Read as already including the country code.";
      } else { full = code + trimmed; }
    }

    full = full.replace(/^0+/, "");
    if (full === "") { return { digits: "", ok: false, note: "That is only zeros." }; }
    if (full.length < 8 || full.length > 15) {
      return {
        digits: full, ok: false,
        note: "That is " + full.length + " digits with the country code. A mobile number is 8 to 15."
      };
    }
    var lens2 = NATIONAL_DIGITS[full.slice(0, 2)];
    if (lens2 && lens2.indexOf(full.length - 2) < 0) {
      note = "Unusual length for +" + full.slice(0, 2) + ". Check it before you publish.";
    }
    return { digits: full, ok: true, note: note };
  }

  /* encodeURIComponent is the right tool and the only one: it escapes the
   * space, the ampersand, the plus, the hash and the newline, and turns
   * everything outside ASCII into UTF-8 percent escapes. A literal + left in a
   * query string is read back as a space, which is how a name like "Jo+Ann" or
   * a note with a + quietly corrupts a booking. */
  function waLink(digits, text) {
    var d = digitsOf(digits);
    if (!d) { return ""; }
    return "https://wa.me/" + d + "?text=" + encodeURIComponent(String(text === null || text === undefined ? "" : text));
  }

  /* Mail clients are happiest with CRLF line endings in a mailto body, so the
   * newlines are converted before encoding. */
  function mailtoLink(email, subject, body) {
    var addr = String(email === null || email === undefined ? "" : email).replace(/\s/g, "");
    if (!addr || addr.indexOf("@") < 1) { return ""; }
    var b = String(body === null || body === undefined ? "" : body).replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
    return "mailto:" + encodeURI(addr) +
      "?subject=" + encodeURIComponent(String(subject === null || subject === undefined ? "" : subject)) +
      "&body=" + encodeURIComponent(b);
  }

  function telLink(digits) {
    var d = digitsOf(digits);
    return d ? "tel:+" + d : "";
  }

  /* Everything a channel needs, or an honest reason why there is no link.
   * A quote with a problem in it never gets a link: a guest who taps through
   * with impossible dates and a plausible-looking total is worse than one who
   * is told to fix the dates. */
  function enquiry(q, ctx) {
    var c = ctx || {};
    var phone = waDigits(c.cc, c.phone);
    var warnings = [];
    /* a number that has not been typed yet is the next step, not a fault; a
     * number that has been typed and is wrong is worth saying out loud */
    if (phone.note && digitsOf(c.phone) !== "") {
      warnings.push({ code: "phone", text: phone.note });
    }

    if (!q || !q.ok) {
      return {
        ok: false, message: "", subject: "",
        waUrl: "", mailUrl: "", telUrl: phone.ok ? telLink(phone.digits) : "",
        phone: phone, length: 0, warnings: warnings
      };
    }

    var text = message(q, c);
    var subject = subjectLine(q, c);
    var waUrl = phone.ok ? waLink(phone.digits, text) : "";
    var mailUrl = mailtoLink(c.email, subject, text);

    if (waUrl && waUrl.length > 1800) {
      warnings.push({
        code: "url_too_long",
        text: "The link is " + waUrl.length + " characters. Shorten the notes: some browsers truncate a link past about two thousand."
      });
    }
    if (!waUrl && !mailUrl) {
      warnings.push({ code: "no_channel", text: "Add a WhatsApp number or an email address, or the page has no way to reach you." });
    }

    return {
      ok: !!(waUrl || mailUrl),
      message: text, subject: subject,
      waUrl: waUrl, mailUrl: mailUrl,
      telUrl: phone.ok ? telLink(phone.digits) : "",
      phone: phone,
      length: waUrl.length,
      warnings: warnings
    };
  }

  /* ---------------- the generated page's own wiring ---------------- */

  /* Runs only in the generated page. Everything above it is pure; this is the
   * one function that touches a document. Without it the page still shows
   * rooms, rates, policies and a plain enquiry link per room — the live total
   * is an addition, not a dependency. */
  function boot(data, doc) {
    if (!data || !doc) { return; }
    function el(id) { return doc.getElementById(id); }
    function pad(n) { return (n < 10 ? "0" : "") + n; }

    var panel = el("bp-panel");
    if (!panel) { return; }
    panel.hidden = false;

    var fIn = el("bp-in"), fOut = el("bp-out"), fRoom = el("bp-room");
    var fAd = el("bp-adults"), fAges = el("bp-ages");
    var fName = el("bp-name"), fPhone = el("bp-phone"), fNotes = el("bp-notes");
    var outTotal = el("bp-total"), outSub = el("bp-sub"), outLines = el("bp-lines");
    var outMsg = el("bp-msg"), outText = el("bp-text");
    var aWa = el("bp-wa"), aMail = el("bp-mail");

    /* Sensible first dates: tomorrow, for the minimum stay. Local clock is
     * fine for a default the guest can change; the arithmetic that follows
     * never touches it. */
    var now = new Date();
    var today = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
    var start = daysToISO(isoToDays(today) + 1);
    var stay = Math.max(1, Math.floor(num(data.minNights)) || 1);
    if (fIn && !fIn.value) { fIn.value = start; }
    if (fIn) { fIn.min = today; }
    if (fOut && !fOut.value) { fOut.value = daysToISO(isoToDays(start) + stay); }
    if (fOut) { fOut.min = start; }

    function roomByName(name) {
      var rooms = data.rooms || [];
      for (var i = 0; i < rooms.length; i++) {
        if (rooms[i].name === name) { return rooms[i]; }
      }
      return rooms.length ? rooms[0] : null;
    }

    function render() {
      var q = quote({
        currency: data.currency,
        checkin: fIn ? fIn.value : "",
        checkout: fOut ? fOut.value : "",
        adults: fAd ? fAd.value : 0,
        ages: fAges ? fAges.value : "",
        room: roomByName(fRoom ? fRoom.value : ""),
        seasons: data.seasons,
        childFreeUnder: data.childFreeUnder,
        taxLabel: data.taxLabel,
        taxPct: data.taxPct,
        taxIncluded: data.taxIncluded,
        depositPct: data.depositPct,
        minNights: data.minNights
      });

      var e = enquiry(q, {
        property: data.property, currency: data.currency,
        cc: data.cc, phone: data.phone, email: data.email,
        guestName: fName ? fName.value : "",
        guestPhone: fPhone ? fPhone.value : "",
        notes: fNotes ? fNotes.value : ""
      });

      if (outTotal) {
        outTotal.textContent = q.ok ? money(q.grandTotal, data.currency) : "\u2014";
      }
      if (outSub) {
        outSub.textContent = q.ok
          ? (q.nights + " " + (q.nights === 1 ? "night" : "nights") + " \u00b7 " + q.roomName +
             " \u00b7 " + guestLabel(q.adults, q.ages, q.childFreeUnder) +
             (q.taxPct > 0 ? (q.taxIncluded ? " \u00b7 " + data.taxLabel + " included" : " \u00b7 with " + data.taxLabel) : ""))
          : "Pick your dates to see the total.";
      }

      if (outLines) {
        while (outLines.firstChild) { outLines.removeChild(outLines.firstChild); }
        function row(label, value, cls) {
          var tr = doc.createElement("tr");
          if (cls) { tr.className = cls; }
          var td1 = doc.createElement("td");
          td1.textContent = label;
          var td2 = doc.createElement("td");
          td2.className = "bp-num";
          td2.textContent = value;
          tr.appendChild(td1); tr.appendChild(td2);
          outLines.appendChild(tr);
          return tr;
        }
        if (q.nights > 0) {
          for (var g = 0; g < q.groups.length; g++) {
            var gr = q.groups[g];
            row(gr.nights + " \u00d7 " + money(gr.rate, data.currency) +
              (gr.season === "Standard rate" ? "" : " \u00b7 " + gr.season),
              money(gr.amount, data.currency));
          }
          if (q.extraAdultTotal > 0) {
            row("Extra adults (" + q.extraAdults + " \u00d7 " + q.nights + " nights)",
              money(q.extraAdultTotal, data.currency));
          }
          if (q.childTotal > 0) {
            row("Children (" + q.payingChildren + " \u00d7 " + q.nights + " nights)",
              money(q.childTotal, data.currency));
          }
          if (q.taxPct > 0) {
            row(data.taxLabel + " " + q.taxPct + "%" + (q.taxIncluded ? ", included above" : ""),
              money(q.taxAmount, data.currency));
          }
          row("Total", money(q.grandTotal, data.currency), "bp-tr-total");
          if (q.depositPct > 0) {
            row("Deposit to confirm (" + q.depositPct + "%)", money(q.depositAmount, data.currency));
            row("Balance on arrival", money(q.balanceAmount, data.currency));
          }
        }
      }

      if (outMsg) {
        var say = [];
        for (var p = 0; p < q.problems.length; p++) { say.push(q.problems[p].text); }
        for (var w = 0; w < q.warnings.length; w++) {
          if (q.warnings[w].code === "below_min_nights") { say.push(q.warnings[w].text); }
        }
        outMsg.textContent = say.join(" ");
        outMsg.hidden = say.length === 0;
      }

      if (outText) { outText.textContent = e.message || ""; }

      function setLink(a, url, label) {
        if (!a) { return; }
        if (url) {
          a.href = url;
          a.removeAttribute("aria-disabled");
          a.className = a.className.replace(/\s*bp-off/g, "");
          a.textContent = label;
        } else {
          a.removeAttribute("href");
          a.setAttribute("aria-disabled", "true");
          if (a.className.indexOf("bp-off") < 0) { a.className += " bp-off"; }
        }
      }
      setLink(aWa, e.waUrl, "Send this enquiry on WhatsApp");
      setLink(aMail, e.mailUrl, "Send it by email");
    }

    var fields = [fIn, fOut, fRoom, fAd, fAges, fName, fPhone, fNotes];
    for (var i = 0; i < fields.length; i++) {
      if (!fields[i]) { continue; }
      fields[i].addEventListener("input", render);
      fields[i].addEventListener("change", render);
    }
    render();
  }

  /* ================================================================== *
   * THE PAGE BUILDER — tool side only.
   * ================================================================== */

  /* The engine, in dependency order, written into the generated page exactly
   * as it is written above. Order matters only for readability: function
   * declarations hoist. */
  var ENGINE = [
    num, nonNeg, round2, clampPct, digitsOf,
    daysFromCivil, civilFromDays, parseISO, isoToDays, daysToISO, formatDate,
    nightsBetween, seasonForNight, parseAges,
    quote, money, guestLabel, message, subjectLine,
    waDigits, waLink, mailtoLink, telLink, enquiry
  ];

  var ENGINE_CONSTANTS = {
    MONTHS: MONTHS, WEEKDAYS: WEEKDAYS,
    CURRENCIES: CURRENCIES, NATIONAL_DIGITS: NATIONAL_DIGITS
  };

  function engineSource(withBoot) {
    var out = [];
    var keys = ["MONTHS", "WEEKDAYS", "CURRENCIES", "NATIONAL_DIGITS"];
    for (var k = 0; k < keys.length; k++) {
      out.push("var " + keys[k] + " = " + JSON.stringify(ENGINE_CONSTANTS[keys[k]]) + ";");
    }
    out.push("");
    for (var i = 0; i < ENGINE.length; i++) { out.push(ENGINE[i].toString()); out.push(""); }
    if (withBoot) { out.push(boot.toString()); out.push(""); }
    return out.join("\n");
  }

  /* The script that goes into the page: the engine, the wiring, the property's
   * own data, and nothing else. No loader, no library, no request. The data is
   * escaped so no property name can close the script element early. */
  function guestBundle(data) {
    return "(function () {\n\"use strict\";\n\n" +
      engineSource(true) +
      "var DATA = " + jsonForScript(data, 1) + ";\n\n" +
      "boot(DATA, document);\n" +
      "})();\n";
  }

  /* The same engine sources, loadable by the test runner, so what the tests
   * exercise is what the page runs. */
  function guestBundleForNode() {
    return "(function (root) {\n\"use strict\";\n\n" +
      engineSource(false) +
      "var api = {};\n" +
      "var names = " + JSON.stringify(ENGINE.map(function (f) { return f.name; })) + ";\n" +
      "var fns = [" + ENGINE.map(function (f) { return f.name; }).join(", ") + "];\n" +
      "for (var i = 0; i < names.length; i++) { api[names[i]] = fns[i]; }\n" +
      "if (typeof module === \"object\" && module && module.exports) { module.exports = api; }\n" +
      "else { root.BookingEngine = api; }\n" +
      "})(typeof globalThis !== \"undefined\" ? globalThis : this);\n";
  }

  /* ---------------- escaping ---------------- */

  function escapeHtml(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* JSON is not safe inside a <script> element until the characters that could
   * close the element early, or end the line early, can no longer do so. A
   * property called "</script><img src=x>" has to come out as data. */
  function jsonForScript(v, indent) {
    return JSON.stringify(v, null, indent || 0)
      .replace(/</g, "\\u003c").replace(/>/g, "\\u003e")
      .replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  }

  /* ---------------- the generated page's stylesheet ---------------- *
   * Every selector is under .bp so this exact text can also be loaded into
   * the tool to render a faithful preview without touching the tool's own
   * design. assets/page.css is this string, byte for byte.
   * -------------------------------------------------------------------- */

  var PAGE_CSS = [
    "/* Direct booking page — self-contained stylesheet. Light and dark, no",
    "   webfont, no external request. Everything is scoped under .bp. */",
    "",
    ".bp, .bp *, .bp *::before, .bp *::after { box-sizing: border-box; }",
    ".bp {",
    "  --bp-bg: #fbfaf8; --bp-surface: #ffffff; --bp-surface-2: #f4f2ee;",
    "  --bp-ink: #1a1a1f; --bp-ink-2: #46444e; --bp-ink-3: #6f6c79;",
    "  --bp-line: #e4e1da; --bp-line-2: #d2cfc6;",
    "  --bp-accent: #be185d; --bp-accent-text: #be185d;",
    "  --bp-ok: #15803d; --bp-bad: #b91c1c;",
    "  --bp-sans: -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, Helvetica, Arial, system-ui, sans-serif;",
    "  --bp-mono: ui-monospace, \"SF Mono\", SFMono-Regular, Menlo, Consolas, monospace;",
    "  margin: 0; padding: 0;",
    "  background: var(--bp-bg); color: var(--bp-ink);",
    "  font-family: var(--bp-sans); font-size: 16px; line-height: 1.55;",
    "  -webkit-text-size-adjust: 100%;",
    "}",
    ".bp[data-accent=\"rose\"] { --bp-accent: #be185d; --bp-accent-text: #be185d; }",
    ".bp[data-accent=\"teal\"] { --bp-accent: #0f766e; --bp-accent-text: #0f766e; }",
    ".bp[data-accent=\"indigo\"] { --bp-accent: #4338ca; --bp-accent-text: #4338ca; }",
    ".bp[data-accent=\"ochre\"] { --bp-accent: #b45309; --bp-accent-text: #b45309; }",
    ".bp[data-accent=\"forest\"] { --bp-accent: #15803d; --bp-accent-text: #15803d; }",
    ".bp[data-accent=\"slate\"] { --bp-accent: #334155; --bp-accent-text: #334155; }",
    "",
    "@media (prefers-color-scheme: dark) {",
    "  :root:not([data-theme=\"light\"]) .bp {",
    "    --bp-bg: #131217; --bp-surface: #1b1a20; --bp-surface-2: #232128;",
    "    --bp-ink: #f3f1ef; --bp-ink-2: #c5c2cc; --bp-ink-3: #95929f;",
    "    --bp-line: #2d2b34; --bp-line-2: #3a3740;",
    "    --bp-accent-text: color-mix(in srgb, var(--bp-accent) 55%, white);",
    "    --bp-ok: #57c98a; --bp-bad: #f28b82;",
    "  }",
    "}",
    ":root[data-theme=\"dark\"] .bp {",
    "  --bp-bg: #131217; --bp-surface: #1b1a20; --bp-surface-2: #232128;",
    "  --bp-ink: #f3f1ef; --bp-ink-2: #c5c2cc; --bp-ink-3: #95929f;",
    "  --bp-line: #2d2b34; --bp-line-2: #3a3740;",
    "  --bp-accent-text: color-mix(in srgb, var(--bp-accent) 55%, white);",
    "  --bp-ok: #57c98a; --bp-bad: #f28b82;",
    "}",
    "",
    ".bp .bp-wrap { max-width: 760px; margin: 0 auto; padding: 0 16px; }",
    ".bp a { color: var(--bp-accent-text); }",
    ".bp h1, .bp h2, .bp h3 { letter-spacing: -0.02em; }",
    "",
    ".bp .bp-head { padding: 40px 0 26px; }",
    ".bp .bp-kicker { font-family: var(--bp-mono); font-size: 0.74rem; font-weight: 600;",
    "  letter-spacing: 0.06em; text-transform: uppercase; color: var(--bp-accent-text); }",
    ".bp .bp-head h1 { margin: 10px 0 6px; font-size: clamp(1.9rem, 1.2rem + 3vw, 2.8rem);",
    "  line-height: 1.05; font-weight: 800; }",
    ".bp .bp-where { margin: 0; font-size: 0.95rem; color: var(--bp-ink-3); }",
    ".bp .bp-lede { margin: 14px 0 0; font-size: 1.05rem; color: var(--bp-ink-2); max-width: 58ch; }",
    "",
    ".bp .bp-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 20px; }",
    ".bp .bp-btn { display: inline-block; font: inherit; font-size: 0.92rem; font-weight: 600;",
    "  text-decoration: none; padding: 11px 17px; border-radius: 9px;",
    "  border: 1px solid var(--bp-line-2); background: var(--bp-surface); color: var(--bp-ink); }",
    ".bp .bp-btn:hover { border-color: var(--bp-ink-3); }",
    ".bp .bp-btn.bp-primary { background: var(--bp-accent); border-color: var(--bp-accent); color: #fff; }",
    ".bp .bp-btn.bp-off { opacity: 0.5; cursor: not-allowed; }",
    "",
    ".bp .bp-card { background: var(--bp-surface); border: 1px solid var(--bp-line);",
    "  border-radius: 12px; padding: 20px; margin: 18px 0; }",
    ".bp .bp-card h2 { margin: 0 0 4px; font-size: 1.15rem; }",
    ".bp .bp-card .bp-sub { margin: 0 0 14px; font-size: 0.88rem; color: var(--bp-ink-3); }",
    "",
    ".bp .bp-grid { display: grid; grid-template-columns: 1fr; gap: 12px; }",
    "@media (min-width: 560px) { .bp .bp-grid2 { grid-template-columns: 1fr 1fr; } }",
    ".bp .bp-f > span { display: block; font-size: 0.82rem; font-weight: 600;",
    "  color: var(--bp-ink-2); margin-bottom: 5px; }",
    ".bp input, .bp select, .bp textarea { width: 100%; font: inherit; font-size: 0.95rem;",
    "  padding: 10px 12px; border-radius: 9px; border: 1px solid var(--bp-line-2);",
    "  background: var(--bp-surface); color: var(--bp-ink); }",
    ".bp input:focus, .bp select:focus, .bp textarea:focus { outline: 2px solid var(--bp-accent);",
    "  outline-offset: 1px; border-color: var(--bp-accent); }",
    "",
    ".bp .bp-total { margin: 18px 0 2px; padding: 16px 18px; border-radius: 10px;",
    "  background: color-mix(in srgb, var(--bp-accent) 8%, var(--bp-surface));",
    "  border: 1px solid color-mix(in srgb, var(--bp-accent) 30%, var(--bp-line)); }",
    ".bp .bp-total .bp-k { font-size: 0.78rem; color: var(--bp-ink-3); }",
    ".bp .bp-total .bp-v { font-size: 2rem; font-weight: 800; letter-spacing: -0.02em;",
    "  font-variant-numeric: tabular-nums; color: var(--bp-accent-text); }",
    ".bp .bp-total .bp-s { font-size: 0.85rem; color: var(--bp-ink-2); margin-top: 2px; }",
    "",
    ".bp .bp-scroll { overflow-x: auto; }",
    ".bp .bp-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; margin-top: 12px; }",
    ".bp .bp-table th, .bp .bp-table td { text-align: left; padding: 8px 4px;",
    "  border-bottom: 1px solid var(--bp-line); }",
    ".bp .bp-table th { font-size: 0.78rem; color: var(--bp-ink-3); font-weight: 600; }",
    ".bp .bp-table .bp-num { text-align: right; font-family: var(--bp-mono);",
    "  font-variant-numeric: tabular-nums; white-space: nowrap; }",
    ".bp .bp-table .bp-tr-total td { font-weight: 700; border-top: 2px solid var(--bp-line-2);",
    "  border-bottom: none; }",
    ".bp .bp-table td .bp-roomlink { font-size: 0.82rem; }",
    "",
    ".bp .bp-warn { margin: 12px 0 0; font-size: 0.88rem; color: var(--bp-bad);",
    "  background: var(--bp-surface-2); border: 1px solid var(--bp-line);",
    "  border-left: 3px solid var(--bp-bad); border-radius: 8px; padding: 10px 12px; }",
    "",
    ".bp .bp-dl { margin: 0; display: grid; grid-template-columns: 1fr; gap: 2px 18px; }",
    "@media (min-width: 560px) { .bp .bp-dl { grid-template-columns: 11rem 1fr; } }",
    ".bp .bp-dl dt { font-size: 0.82rem; font-weight: 600; color: var(--bp-ink-3);",
    "  padding-top: 9px; }",
    ".bp .bp-dl dd { margin: 0; font-size: 0.93rem; color: var(--bp-ink-2);",
    "  padding-bottom: 9px; border-bottom: 1px solid var(--bp-line); }",
    "@media (min-width: 560px) { .bp .bp-dl dt { border-bottom: 1px solid var(--bp-line);",
    "  padding-bottom: 9px; } }",
    "",
    ".bp details.bp-copy { margin-top: 14px; font-size: 0.86rem; }",
    ".bp details.bp-copy summary { cursor: pointer; color: var(--bp-ink-2); font-weight: 600; }",
    ".bp pre.bp-pre { white-space: pre-wrap; word-break: break-word; font-family: var(--bp-mono);",
    "  font-size: 0.8rem; line-height: 1.5; background: var(--bp-surface-2);",
    "  border: 1px solid var(--bp-line); border-radius: 8px; padding: 12px; margin: 10px 0 0;",
    "  color: var(--bp-ink-2); }",
    "",
    ".bp .bp-foot { border-top: 1px solid var(--bp-line); margin-top: 30px; padding: 22px 0 46px; }",
    ".bp .bp-foot p { margin: 0 0 8px; font-size: 0.86rem; color: var(--bp-ink-3); }",
    ".bp .bp-foot .bp-direct { color: var(--bp-ink-2); font-weight: 600; }",
    "",
    "@media print {",
    "  .bp .bp-actions, .bp details.bp-copy { display: none; }",
    "  .bp { background: #fff; }",
    "  .bp .bp-card { border: none; padding: 0; }",
    "}",
    ""
  ].join("\n");

  /* ---------------- the generated page ---------------- */

  function roomsOf(cfg) {
    var out = [];
    var rooms = (cfg && cfg.rooms) || [];
    for (var i = 0; i < rooms.length; i++) {
      var r = rooms[i];
      if (!r || !String(r.name || "").replace(/\s/g, "")) { continue; }
      out.push({
        name: String(r.name).trim(),
        baseRate: nonNeg(r.baseRate),
        includedGuests: Math.max(1, Math.floor(nonNeg(r.includedGuests))),
        maxGuests: Math.floor(nonNeg(r.maxGuests)),
        extraAdultRate: nonNeg(r.extraAdultRate),
        childRate: nonNeg(r.childRate)
      });
    }
    return out;
  }

  function seasonsOf(cfg) {
    var out = [];
    var seasons = (cfg && cfg.seasons) || [];
    for (var i = 0; i < seasons.length; i++) {
      var s = seasons[i];
      if (!s || !String(s.name || "").replace(/\s/g, "")) { continue; }
      if (isoToDays(s.from) === null || isoToDays(s.to) === null) { continue; }
      if (isoToDays(s.to) < isoToDays(s.from)) { continue; }
      out.push({
        name: String(s.name).trim(), from: String(s.from).trim(),
        to: String(s.to).trim(), upliftPct: clampPct(s.upliftPct)
      });
    }
    return out;
  }

  /* The data the page carries: the property, its rooms, its seasons and its
   * policies. Nothing about any guest, because the page never stores one. */
  function pageData(cfg) {
    var c = cfg || {};
    return {
      property: String(c.property || "").trim(),
      currency: CURRENCIES[c.currency] ? c.currency : "INR",
      cc: digitsOf(c.cc),
      phone: String(c.phone || "").trim(),
      email: String(c.email || "").trim(),
      rooms: roomsOf(c),
      seasons: seasonsOf(c),
      childFreeUnder: nonNeg(c.childFreeUnder),
      taxLabel: String(c.taxLabel || "Tax").trim() || "Tax",
      taxPct: nonNeg(c.taxPct),
      taxIncluded: !!c.taxIncluded,
      depositPct: Math.min(100, nonNeg(c.depositPct)),
      minNights: Math.max(0, Math.floor(nonNeg(c.minNights)))
    };
  }

  var ACCENT_HEX = {
    rose: "#be185d", teal: "#0f766e", indigo: "#4338ca",
    ochre: "#b45309", forest: "#15803d", slate: "#334155"
  };

  function accentOf(cfg) {
    var a = String((cfg && cfg.accent) || "rose");
    var allowed = ["rose", "teal", "indigo", "ochre", "forest", "slate"];
    return allowed.indexOf(a) >= 0 ? a : "rose";
  }

  /* A tab icon drawn into the page itself. Without one a browser goes looking
   * for /favicon.ico, which is a request to somewhere — and the whole point of
   * this file is that it asks for nothing. */
  function faviconFor(accent) {
    var svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>" +
      "<rect width='32' height='32' rx='7' fill='" + ACCENT_HEX[accent] + "'/>" +
      "<path d='M7 17.5 16 9.5l9 8V24H7z' fill='#ffffff'/></svg>";
    return "data:image/svg+xml," + encodeURIComponent(svg);
  }

  function fileNameFor(cfg) {
    var base = String((cfg && cfg.property) || "booking").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (!base) { base = "booking"; }
    return base.slice(0, 48) + "-booking.html";
  }

  /* A plain enquiry link for one room, with no dates in it. This is what a
   * guest gets with the script switched off, and what the rooms table offers:
   * fewer details, but it always works. */
  function roomEnquiryUrl(data, room) {
    var phone = waDigits(data.cc, data.phone);
    if (!phone.ok) { return ""; }
    var lines = [];
    lines.push("Booking enquiry" + (data.property ? " \u2014 " + data.property : ""));
    lines.push("");
    lines.push("Room: " + room.name);
    lines.push("Rate a night: " + money(room.baseRate, data.currency));
    lines.push("Check-in: ");
    lines.push("Check-out: ");
    lines.push("Guests: ");
    return waLink(phone.digits, lines.join("\n"));
  }

  function buildPage(cfg) {
    var c = cfg || {};
    var data = pageData(c);
    var accent = accentOf(c);
    var cur = CURRENCIES[data.currency];
    var phone = waDigits(data.cc, data.phone);
    var H = [];
    function p(s) { H.push(s); }

    var title = (data.property || "Direct booking") +
      (c.where ? " \u2014 " + String(c.where).trim() : "") + " \u2014 book direct";
    var desc = c.lede ? String(c.lede).trim()
      : ("Rooms, rates and policies for " + (data.property || "the property") +
         ". Enquire direct, no booking fee.");

    p("<!doctype html>");
    p("<html lang=\"en\">");
    p("<head>");
    p("<meta charset=\"utf-8\">");
    p("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">");
    /* Nothing may be loaded and nothing may be sent: no script, style, font,
     * frame or connection from anywhere else, and no form target. Images are
     * allowed from beside the file so photographs can be added by hand. */
    p("<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; " +
      "img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; " +
      "base-uri 'none'; form-action 'none'\">");
    p("<meta name=\"referrer\" content=\"no-referrer\">");
    p("<meta name=\"color-scheme\" content=\"light dark\">");
    p("<link rel=\"icon\" href=\"" + escapeAttr(faviconFor(accent)) + "\" type=\"image/svg+xml\">");
    p("<title>" + escapeHtml(title) + "</title>");
    p("<meta name=\"description\" content=\"" + escapeAttr(desc) + "\">");
    p("<meta property=\"og:title\" content=\"" + escapeAttr(title) + "\">");
    p("<meta property=\"og:description\" content=\"" + escapeAttr(desc) + "\">");
    p("<meta property=\"og:type\" content=\"website\">");
    p("<style>");
    p(PAGE_CSS);
    p("</style>");
    p("</head>");
    p("<body class=\"bp\" data-accent=\"" + escapeAttr(accent) + "\">");
    p("<div class=\"bp-wrap\">");

    /* header */
    p("<header class=\"bp-head\">");
    p("  <div class=\"bp-kicker\">Book direct \u00b7 no booking fee</div>");
    p("  <h1>" + escapeHtml(data.property || "Your property") + "</h1>");
    if (c.where) { p("  <p class=\"bp-where\">" + escapeHtml(String(c.where).trim()) + "</p>"); }
    if (c.lede) { p("  <p class=\"bp-lede\">" + escapeHtml(String(c.lede).trim()) + "</p>"); }
    p("  <div class=\"bp-actions\">");
    if (phone.ok) {
      p("    <a class=\"bp-btn bp-primary\" href=\"" +
        escapeAttr(waLink(phone.digits, "Booking enquiry" +
          (data.property ? " \u2014 " + data.property : "") + "\n\nCheck-in: \nCheck-out: \nRoom: \nGuests: ")) +
        "\">Enquire on WhatsApp</a>");
      p("    <a class=\"bp-btn\" href=\"" + escapeAttr(telLink(phone.digits)) + "\">Call " +
        escapeHtml("+" + phone.digits) + "</a>");
    }
    if (data.email) {
      p("    <a class=\"bp-btn\" href=\"" + escapeAttr("mailto:" + encodeURI(data.email)) +
        "\">" + escapeHtml(data.email) + "</a>");
    }
    p("  </div>");
    if (!phone.ok && !data.email) {
      p("  <p class=\"bp-warn\">No WhatsApp number or email address has been set on this page yet.</p>");
    }
    p("</header>");

    /* live quote panel — revealed by the script, absent without it */
    p("<section class=\"bp-card\" id=\"bp-panel\" hidden>");
    p("  <h2>Your dates, your total</h2>");
    p("  <p class=\"bp-sub\">Everything is worked out on your own phone. Nothing is sent until you tap through to WhatsApp or email.</p>");
    p("  <div class=\"bp-grid bp-grid2\">");
    p("    <label class=\"bp-f\"><span>Check-in</span><input type=\"date\" id=\"bp-in\"></label>");
    p("    <label class=\"bp-f\"><span>Check-out</span><input type=\"date\" id=\"bp-out\"></label>");
    p("  </div>");
    p("  <div class=\"bp-grid bp-grid2\">");
    p("    <label class=\"bp-f\"><span>Room</span><select id=\"bp-room\">");
    for (var r1 = 0; r1 < data.rooms.length; r1++) {
      p("      <option value=\"" + escapeAttr(data.rooms[r1].name) + "\">" +
        escapeHtml(data.rooms[r1].name) + " \u00b7 " + escapeHtml(money(data.rooms[r1].baseRate, data.currency)) +
        " a night</option>");
    }
    p("    </select></label>");
    p("    <label class=\"bp-f\"><span>Adults</span><input type=\"number\" id=\"bp-adults\" value=\"2\" min=\"1\" max=\"20\" step=\"1\" inputmode=\"numeric\"></label>");
    p("  </div>");
    p("  <div class=\"bp-grid bp-grid2\">");
    p("    <label class=\"bp-f\"><span>Children&rsquo;s ages, if any</span><input type=\"text\" id=\"bp-ages\" placeholder=\"7, 3\" inputmode=\"numeric\"></label>");
    p("    <label class=\"bp-f\"><span>Your name</span><input type=\"text\" id=\"bp-name\" autocomplete=\"name\"></label>");
    p("  </div>");
    p("  <div class=\"bp-grid bp-grid2\">");
    p("    <label class=\"bp-f\"><span>Your phone, if you want a call back</span><input type=\"text\" id=\"bp-phone\" inputmode=\"tel\" autocomplete=\"tel\"></label>");
    p("    <label class=\"bp-f\"><span>Anything we should know</span><input type=\"text\" id=\"bp-notes\"></label>");
    p("  </div>");
    p("  <div class=\"bp-total\">");
    p("    <div class=\"bp-k\">Total for the stay</div>");
    p("    <div class=\"bp-v\" id=\"bp-total\">\u2014</div>");
    p("    <div class=\"bp-s\" id=\"bp-sub\">Pick your dates to see the total.</div>");
    p("  </div>");
    p("  <p class=\"bp-warn\" id=\"bp-msg\" hidden></p>");
    p("  <table class=\"bp-table\"><tbody id=\"bp-lines\"></tbody></table>");
    p("  <div class=\"bp-actions\">");
    p("    <a class=\"bp-btn bp-primary bp-off\" id=\"bp-wa\" aria-disabled=\"true\">Send this enquiry on WhatsApp</a>");
    p("    <a class=\"bp-btn bp-off\" id=\"bp-mail\" aria-disabled=\"true\">Send it by email</a>");
    p("  </div>");
    p("  <details class=\"bp-copy\"><summary>Or copy the message and send it yourself</summary>");
    p("    <pre class=\"bp-pre\" id=\"bp-text\"></pre></details>");
    p("</section>");

    /* rooms */
    p("<section class=\"bp-card\">");
    p("  <h2>Rooms and rates</h2>");
    p("  <p class=\"bp-sub\">Rate a night" + (data.taxPct > 0
      ? (data.taxIncluded
          ? ", " + escapeHtml(data.taxLabel) + " at " + data.taxPct + "% included"
          : ", before " + escapeHtml(data.taxLabel) + " at " + data.taxPct + "%")
      : "") + ".</p>");
    if (!data.rooms.length) {
      p("  <p class=\"bp-warn\">No rooms have been added to this page yet.</p>");
    } else {
      p("  <div class=\"bp-scroll\">");
      p("  <table class=\"bp-table\">");
      p("    <thead><tr><th>Room</th><th>Sleeps</th><th class=\"bp-num\">A night</th>" +
        "<th class=\"bp-num\">Extra adult</th><th class=\"bp-num\">Child</th></tr></thead>");
      p("    <tbody>");
      for (var r2 = 0; r2 < data.rooms.length; r2++) {
        var rm = data.rooms[r2];
        var link = roomEnquiryUrl(data, rm);
        p("      <tr>");
        p("        <td>" + escapeHtml(rm.name) +
          (link ? "<br><a class=\"bp-roomlink\" href=\"" + escapeAttr(link) + "\">Enquire about this room</a>" : "") +
          "</td>");
        p("        <td>" + (rm.maxGuests > 0 ? rm.maxGuests : "\u2014") +
          "<br><span class=\"bp-roomlink\">rate covers " + rm.includedGuests + "</span></td>");
        p("        <td class=\"bp-num\">" + escapeHtml(money(rm.baseRate, data.currency)) + "</td>");
        p("        <td class=\"bp-num\">" + (rm.extraAdultRate > 0 ? escapeHtml(money(rm.extraAdultRate, data.currency)) : "\u2014") + "</td>");
        p("        <td class=\"bp-num\">" + (rm.childRate > 0 ? escapeHtml(money(rm.childRate, data.currency)) : "\u2014") + "</td>");
        p("      </tr>");
      }
      p("    </tbody>");
      p("  </table>");
      p("  </div>");
    }
    p("</section>");

    /* seasons */
    if (data.seasons.length) {
      p("<section class=\"bp-card\">");
      p("  <h2>Season rates</h2>");
      p("  <p class=\"bp-sub\">Each night is charged at the rate for that night, so a stay that crosses a season is split.</p>");
      p("  <div class=\"bp-scroll\">");
      p("  <table class=\"bp-table\">");
      p("    <thead><tr><th>Season</th><th>Nights covered</th><th class=\"bp-num\">Rate</th></tr></thead>");
      p("    <tbody>");
      for (var s = 0; s < data.seasons.length; s++) {
        var se = data.seasons[s];
        var sign = se.upliftPct > 0 ? "+" : "";
        p("      <tr><td>" + escapeHtml(se.name) + "</td><td>" +
          escapeHtml(formatDate(se.from)) + " to " + escapeHtml(formatDate(se.to)) +
          "</td><td class=\"bp-num\">" +
          (se.upliftPct === 0 ? "as standard" : sign + se.upliftPct + "%") + "</td></tr>");
      }
      p("    </tbody>");
      p("  </table>");
      p("  </div>");
      p("</section>");
    }

    /* policies */
    p("<section class=\"bp-card\">");
    p("  <h2>What to expect</h2>");
    p("  <dl class=\"bp-dl\">");
    function dl(k, v) {
      if (!v) { return; }
      p("    <dt>" + escapeHtml(k) + "</dt><dd>" + escapeHtml(v) + "</dd>");
    }
    dl("Check-in", c.checkinTime ? String(c.checkinTime).trim() : "");
    dl("Check-out", c.checkoutTime ? String(c.checkoutTime).trim() : "");
    if (data.minNights > 1) { dl("Minimum stay", data.minNights + " nights"); }
    dl("Children", data.childFreeUnder > 0
      ? ("Under " + data.childFreeUnder + " stay free. Older children are charged the child rate for the room, and every child counts towards how many the room sleeps.")
      : "Children are charged the child rate for the room, and count towards how many the room sleeps.");
    if (data.taxPct > 0) {
      dl(data.taxLabel, data.taxPct + "%" + (data.taxIncluded
        ? ", already included in the rates above"
        : ", added to the rates above"));
    }
    if (data.depositPct > 0) {
      dl("To confirm", data.depositPct + "% of the total as a deposit, the balance on arrival"
        + (c.payLabel && c.payHandle ? ". Pay by " + String(c.payLabel).trim() + ": " + String(c.payHandle).trim() : ""));
    } else if (c.payLabel && c.payHandle) {
      dl("Paying", String(c.payLabel).trim() + ": " + String(c.payHandle).trim());
    }
    dl("Cancellation", c.cancellation ? String(c.cancellation).trim() : "");
    dl("Good to know", c.notes ? String(c.notes).trim() : "");
    p("  </dl>");
    p("</section>");

    /* footer */
    p("<footer class=\"bp-foot\">");
    p("  <p class=\"bp-direct\">Booking direct means the whole tariff goes to " +
      escapeHtml(data.property || "the property") + ", and you talk to the people who run it.</p>");
    p("  <p>This page cannot take a payment or hold a room. Your enquiry goes straight to " +
      escapeHtml(data.property || "the property") +
      " on WhatsApp or by email, and the stay is booked when they reply to confirm it.</p>");
    p("  <p>Rates and policies as shown on " +
      escapeHtml(c.generatedOn ? formatDate(c.generatedOn) || String(c.generatedOn) : "this page") +
      ". " + escapeHtml(cur.symbol + " " + cur.code) + ".</p>");
    p("</footer>");

    p("</div>");
    p("<script>");
    p(guestBundle(data));
    p("</" + "script>");
    p("</body>");
    p("</html>");
    p("");
    return H.join("\n");
  }

  /* The body markup only, for the preview inside the tool: same builder, same
   * stylesheet, script left out so the preview cannot run anything. */
  function previewHtml(cfg) {
    var full = buildPage(cfg);
    var start = full.indexOf("<div class=\"bp-wrap\">");
    var end = full.lastIndexOf("</div>\n<script>");
    if (start < 0 || end < 0) { return ""; }
    return full.slice(start, end + "</div>".length);
  }

  var BookingPage = {
    MONTHS: MONTHS, WEEKDAYS: WEEKDAYS,
    CURRENCIES: CURRENCIES, NATIONAL_DIGITS: NATIONAL_DIGITS,
    ACCENTS: ["rose", "teal", "indigo", "ochre", "forest", "slate"],
    PAGE_CSS: PAGE_CSS,

    num: num, nonNeg: nonNeg, round2: round2, clampPct: clampPct, digitsOf: digitsOf,
    daysFromCivil: daysFromCivil, civilFromDays: civilFromDays,
    parseISO: parseISO, isoToDays: isoToDays, daysToISO: daysToISO, formatDate: formatDate,
    nightsBetween: nightsBetween, seasonForNight: seasonForNight, parseAges: parseAges,
    quote: quote, money: money, guestLabel: guestLabel,
    message: message, subjectLine: subjectLine,
    waDigits: waDigits, waLink: waLink, mailtoLink: mailtoLink, telLink: telLink,
    enquiry: enquiry,

    escapeHtml: escapeHtml, escapeAttr: escapeAttr, jsonForScript: jsonForScript,
    pageData: pageData, roomsOf: roomsOf, seasonsOf: seasonsOf,
    accentOf: accentOf, fileNameFor: fileNameFor,
    buildPage: buildPage, previewHtml: previewHtml,
    engineSource: engineSource, guestBundle: guestBundle, guestBundleForNode: guestBundleForNode
  };

  if (typeof module === "object" && module && module.exports) { module.exports = BookingPage; }
  root.BookingPage = BookingPage;
})(typeof globalThis !== "undefined" ? globalThis : this);
