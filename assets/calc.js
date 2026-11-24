/* Wiring for the booking page generator.
 *
 * All the arithmetic, all the link building and all the HTML generation live in
 * assets/booking.js. This file reads the form, asks that module for a quote, an
 * enquiry and a finished page, and puts the answers on the screen. It makes no
 * network request and runs no generated code: the preview is parsed as inert
 * markup, never executed.
 */
(function () {
  "use strict";

  var B = window.BookingPage;
  if (!B) { return; }

  function byId(id) { return document.getElementById(id); }
  function val(id) { var e = byId(id); return e ? e.value : ""; }
  function setVal(id, v) { var e = byId(id); if (e) { e.value = v === null || v === undefined ? "" : String(v); } }
  function text(id, s) { var e = byId(id); if (e) { e.textContent = s; } }

  var ROOMS = [1, 2, 3, 4];
  var SEASONS = [1, 2, 3];

  /* The example property the tool opens with, and what Reset puts back. The
   * contact fields are deliberately empty: a page should never ship with
   * somebody else's phone number in it. */
  function demoYear() {
    var now = new Date();
    var y = now.getFullYear();
    /* keep the example season in the future for most of the year */
    if (now.getMonth() + 1 === 12 && now.getDate() > 15) { y += 1; }
    return y;
  }

  function defaults() {
    var y = demoYear();
    return {
      "p-name": "Bougainvillea Homestay",
      "p-where": "Madikeri, Coorg · Karnataka",
      "p-lede": "Three rooms on a working coffee estate, ten minutes from town. Home-cooked meals, estate walks, and a veranda for the rain.",
      "c-cc": "91", "c-phone": "", "c-email": "",
      "c-pay-label": "", "c-pay-handle": "",
      "r1-name": "Garden room", "r1-rate": "2800", "r1-included": "2", "r1-max": "4", "r1-extra": "700", "r1-child": "350",
      "r2-name": "Estate cottage", "r2-rate": "4200", "r2-included": "2", "r2-max": "5", "r2-extra": "900", "r2-child": "450",
      "r3-name": "", "r3-rate": "", "r3-included": "", "r3-max": "", "r3-extra": "", "r3-child": "",
      "r4-name": "", "r4-rate": "", "r4-included": "", "r4-max": "", "r4-extra": "", "r4-child": "",
      "s1-name": "Peak — Christmas and New Year",
      "s1-from": y + "-12-20", "s1-to": (y + 1) + "-01-05", "s1-uplift": "35",
      "s2-name": "Monsoon", "s2-from": y + "-06-15", "s2-to": y + "-09-15", "s2-uplift": "-20",
      "s3-name": "", "s3-from": "", "s3-to": "", "s3-uplift": "",
      "p-tax-label": "GST", "p-tax-pct": "",
      "p-childfree": "5", "p-minnights": "2", "p-deposit": "30",
      "p-checkin": "1 pm", "p-checkout": "11 am",
      "p-cancel": "Free cancellation up to 7 days before arrival; the deposit is kept after that.",
      "p-notes": "Tariff includes breakfast. Cash, bank transfer or UPI on arrival.",
      "q-adults": "2", "q-ages": "7, 3",
      "q-guest": "", "q-note": ""
    };
  }

  /* the country code and tax name that go with each currency, so switching
   * currency moves them along unless they have been typed over */
  var BY_CURRENCY = {
    INR: { cc: "91", tax: "GST" },
    PHP: { cc: "63", tax: "VAT" }
  };

  var currency = "INR";
  var accent = "rose";
  var taxIncluded = false;
  var lastBlobUrl = "";

  /* ---------------- reading the form ---------------- */

  function readConfig() {
    var rooms = [];
    for (var i = 0; i < ROOMS.length; i++) {
      var n = ROOMS[i];
      rooms.push({
        name: val("r" + n + "-name"),
        baseRate: val("r" + n + "-rate"),
        includedGuests: val("r" + n + "-included"),
        maxGuests: val("r" + n + "-max"),
        extraAdultRate: val("r" + n + "-extra"),
        childRate: val("r" + n + "-child")
      });
    }
    var seasons = [];
    for (var s = 0; s < SEASONS.length; s++) {
      var m = SEASONS[s];
      seasons.push({
        name: val("s" + m + "-name"),
        from: val("s" + m + "-from"),
        to: val("s" + m + "-to"),
        upliftPct: val("s" + m + "-uplift")
      });
    }
    return {
      property: val("p-name"), where: val("p-where"), lede: val("p-lede"),
      currency: currency, accent: accent,
      cc: val("c-cc"), phone: val("c-phone"), email: val("c-email"),
      payLabel: val("c-pay-label"), payHandle: val("c-pay-handle"),
      rooms: rooms, seasons: seasons,
      childFreeUnder: val("p-childfree"),
      taxLabel: val("p-tax-label"), taxPct: val("p-tax-pct"), taxIncluded: taxIncluded,
      depositPct: val("p-deposit"), minNights: val("p-minnights"),
      checkinTime: val("p-checkin"), checkoutTime: val("p-checkout"),
      cancellation: val("p-cancel"), notes: val("p-notes"),
      generatedOn: todayISO()
    };
  }

  function todayISO() {
    var n = new Date();
    function pad(x) { return (x < 10 ? "0" : "") + x; }
    return n.getFullYear() + "-" + pad(n.getMonth() + 1) + "-" + pad(n.getDate());
  }

  /* ---------------- the room list in the test booking ---------------- */

  function syncRoomChoices(data) {
    var sel = byId("q-room");
    if (!sel) { return null; }
    var wanted = sel.value;
    var have = [];
    for (var i = 0; i < sel.options.length; i++) { have.push(sel.options[i].value); }
    var names = data.rooms.map(function (r) { return r.name; });
    if (have.join("\u0000") !== names.join("\u0000")) {
      while (sel.firstChild) { sel.removeChild(sel.firstChild); }
      for (var j = 0; j < data.rooms.length; j++) {
        var o = document.createElement("option");
        o.value = data.rooms[j].name;
        o.textContent = data.rooms[j].name + " · " +
          B.money(data.rooms[j].baseRate, data.currency) + " a night";
        sel.appendChild(o);
      }
      if (names.indexOf(wanted) >= 0) { sel.value = wanted; }
    } else {
      /* names unchanged, rates may not be */
      for (var k = 0; k < sel.options.length && k < data.rooms.length; k++) {
        sel.options[k].textContent = data.rooms[k].name + " · " +
          B.money(data.rooms[k].baseRate, data.currency) + " a night";
      }
    }
    for (var m = 0; m < data.rooms.length; m++) {
      if (data.rooms[m].name === sel.value) { return data.rooms[m]; }
    }
    return data.rooms.length ? data.rooms[0] : null;
  }

  /* ---------------- rendering ---------------- */

  function clear(el) { while (el && el.firstChild) { el.removeChild(el.firstChild); } }

  function addRow(tbody, label, value, cls) {
    var tr = document.createElement("tr");
    if (cls) { tr.className = cls; }
    var a = document.createElement("td");
    a.textContent = label;
    var b = document.createElement("td");
    b.className = "num";
    b.textContent = value;
    tr.appendChild(a); tr.appendChild(b);
    tbody.appendChild(tr);
  }

  function renderResult(q, e, data) {
    text("out-total", q.ok ? B.money(q.grandTotal, data.currency) : "—");
    text("out-sub", q.ok
      ? (q.nights + " " + (q.nights === 1 ? "night" : "nights") + " · " + q.roomName +
         " · " + B.guestLabel(q.adults, q.ages, q.childFreeUnder) +
         (q.taxPct > 0
           ? (q.taxIncluded ? " · " + q.taxLabel + " included" : " · with " + q.taxLabel)
           : " · no tax applied"))
      : "Fill in a room and some dates.");

    var rows = byId("out-rows");
    clear(rows);
    if (rows && q.nights > 0) {
      for (var g = 0; g < q.groups.length; g++) {
        var gr = q.groups[g];
        addRow(rows, gr.nights + " × " + B.money(gr.rate, data.currency) +
          (gr.season === "Standard rate" ? "" : " · " + gr.season),
          B.money(gr.amount, data.currency));
      }
      if (q.extraAdults > 0) {
        addRow(rows, "Extra adults, " + q.extraAdults + " for " + q.nights + " nights",
          B.money(q.extraAdultTotal, data.currency));
      }
      if (q.children > 0) {
        addRow(rows, "Children, " + q.payingChildren + " charged" +
          (q.freeChildren > 0 ? " and " + q.freeChildren + " free" : "") +
          " for " + q.nights + " nights",
          B.money(q.childTotal, data.currency));
      }
      if (q.taxPct > 0 || q.extraAdults > 0 || q.children > 0) {
        addRow(rows, q.taxIncluded ? "Subtotal, tax included" : "Subtotal",
          B.money(q.subtotal, data.currency), "sub");
      }
      if (q.taxPct > 0) {
        addRow(rows, q.taxLabel + " at " + q.taxPct + "%" +
          (q.taxIncluded ? ", already inside the rates" : ", added"),
          B.money(q.taxAmount, data.currency));
      }
      addRow(rows, "Total the guest pays", B.money(q.grandTotal, data.currency), "total");
      if (q.depositPct > 0) {
        addRow(rows, "Deposit to confirm, " + q.depositPct + "%", B.money(q.depositAmount, data.currency));
        addRow(rows, "Balance on arrival", B.money(q.balanceAmount, data.currency));
      }
      addRow(rows, "Average a night", B.money(q.perNight, data.currency), "sub");
    }

    var flags = byId("out-flags");
    if (flags) {
      var say = [];
      for (var p = 0; p < q.problems.length; p++) { say.push(q.problems[p].text); }
      for (var w = 0; w < q.warnings.length; w++) { say.push(q.warnings[w].text); }
      for (var v = 0; v < e.warnings.length; v++) { say.push(e.warnings[v].text); }
      clear(flags);
      for (var i = 0; i < say.length; i++) {
        var d = document.createElement("div");
        d.textContent = say[i];
        flags.appendChild(d);
      }
      flags.hidden = say.length === 0;
    }
  }

  function renderLinks(q, e) {
    var url = e.waUrl || e.mailUrl || "";
    text("out-url", url || "—");
    text("out-msg", e.message || "—");

    var note;
    if (!q.ok) {
      note = "No link is built while the test booking has a problem in it. A guest who taps a link with impossible dates in it is worse off than one who is told to change them.";
    } else if (e.waUrl) {
      note = "WhatsApp link, " + e.length + " characters, every part of the message percent-encoded.";
    } else if (e.mailUrl) {
      note = "No WhatsApp number yet, so this is the email version. Add a number above for the WhatsApp link.";
    } else {
      note = "Add a WhatsApp number or an email address above and the link appears here.";
    }
    text("out-linknote", note);

    setLink("wa-test", e.waUrl, "Open it in WhatsApp");
    setLink("mail-test", e.mailUrl, "Open it in email");
  }

  function setLink(id, url, label) {
    var a = byId(id);
    if (!a) { return; }
    a.textContent = label;
    if (url) {
      a.href = url;
      a.removeAttribute("aria-disabled");
    } else {
      a.removeAttribute("href");
      a.setAttribute("aria-disabled", "true");
    }
  }

  /* The preview is parsed, not executed: DOMParser builds an inert document,
   * so nothing in the generated markup can run here. */
  function renderPreview(cfg) {
    var box = byId("preview");
    if (!box) { return; }
    var holder = document.createElement("div");
    holder.className = "bp";
    holder.setAttribute("data-accent", B.accentOf(cfg));
    try {
      var parsed = new DOMParser().parseFromString("<body>" + B.previewHtml(cfg) + "</body>", "text/html");
      var node = parsed.body.firstChild;
      while (node) {
        var next = node.nextSibling;
        holder.appendChild(document.importNode(node, true));
        node = next;
      }
    } catch (err) {
      holder.textContent = "This browser cannot draw the preview. The download is unaffected.";
    }
    clear(box);
    box.appendChild(holder);
  }

  var currentHtml = "";
  var currentName = "booking.html";

  function compute() {
    var cfg = readConfig();
    var data = B.pageData(cfg);
    var room = syncRoomChoices(data);

    var q = B.quote({
      currency: data.currency,
      checkin: val("q-in"), checkout: val("q-out"),
      adults: val("q-adults"), ages: val("q-ages"),
      room: room, seasons: data.seasons,
      childFreeUnder: data.childFreeUnder,
      taxLabel: data.taxLabel, taxPct: data.taxPct, taxIncluded: data.taxIncluded,
      depositPct: data.depositPct, minNights: data.minNights
    });

    var e = B.enquiry(q, {
      property: data.property, currency: data.currency,
      cc: data.cc, phone: data.phone, email: data.email,
      guestName: val("q-guest"), guestPhone: "", notes: val("q-note")
    });

    renderResult(q, e, data);
    renderLinks(q, e);

    currentHtml = B.buildPage(cfg);
    currentName = B.fileNameFor(cfg);
    text("out-source", currentHtml);
    text("out-filemeta", currentName + " · " +
      Math.max(1, Math.round(currentHtml.length / 1024)) + " KB · one file, no dependencies");
    renderPreview(cfg);
  }

  /* ---------------- currency, colour, tax mode ---------------- */

  function applyCurrency(code, moveDefaults) {
    currency = B.CURRENCIES[code] ? code : "INR";
    var sym = B.CURRENCIES[currency].symbol;
    var marks = document.querySelectorAll(".pre.cur");
    for (var i = 0; i < marks.length; i++) { marks[i].textContent = sym; }
    var segs = document.querySelectorAll("[data-cur]");
    for (var j = 0; j < segs.length; j++) {
      segs[j].setAttribute("aria-pressed", segs[j].getAttribute("data-cur") === currency ? "true" : "false");
    }
    if (moveDefaults) {
      var other = currency === "INR" ? "PHP" : "INR";
      if (val("c-cc") === BY_CURRENCY[other].cc || val("c-cc") === "") {
        setVal("c-cc", BY_CURRENCY[currency].cc);
      }
      if (val("p-tax-label") === BY_CURRENCY[other].tax || val("p-tax-label") === "") {
        setVal("p-tax-label", BY_CURRENCY[currency].tax);
      }
    }
  }

  function applyAccent(name) {
    accent = B.ACCENTS.indexOf(name) >= 0 ? name : "rose";
    var segs = document.querySelectorAll("button[data-accent]");
    for (var i = 0; i < segs.length; i++) {
      segs[i].setAttribute("aria-pressed", segs[i].getAttribute("data-accent") === accent ? "true" : "false");
    }
  }

  function applyTaxMode(mode) {
    taxIncluded = mode === "included";
    var segs = document.querySelectorAll("[data-tax]");
    for (var i = 0; i < segs.length; i++) {
      segs[i].setAttribute("aria-pressed",
        segs[i].getAttribute("data-tax") === (taxIncluded ? "included" : "extra") ? "true" : "false");
    }
  }

  /* ---------------- the download ---------------- */

  function saveFile() {
    if (!currentHtml) { return; }
    var said = byId("out-saved");
    try {
      var blob = new Blob([currentHtml], { type: "text/html;charset=utf-8" });
      if (lastBlobUrl) { URL.revokeObjectURL(lastBlobUrl); }
      lastBlobUrl = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = lastBlobUrl;
      a.download = currentName;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      if (said) {
        said.textContent = "Saved as " + currentName + ". Open it from your downloads to check it, then upload that one file.";
        said.hidden = false;
      }
    } catch (err) {
      if (said) {
        said.textContent = "This browser would not start the download. Open “The whole file, as text” below, copy it, and save it yourself as " + currentName + ".";
        said.hidden = false;
      }
    }
  }

  function copyHtml() {
    var said = byId("out-saved");
    function fallback() {
      if (said) {
        said.textContent = "Copying is blocked in this browser. Open “The whole file, as text” below and copy it from there.";
        said.hidden = false;
      }
    }
    if (!navigator.clipboard || !navigator.clipboard.writeText) { fallback(); return; }
    navigator.clipboard.writeText(currentHtml).then(function () {
      if (said) {
        said.textContent = "The whole file is on your clipboard. Paste it into a text editor and save it as " + currentName + ".";
        said.hidden = false;
      }
    }, fallback);
  }

  /* ---------------- wiring ---------------- */

  function seedTestDates() {
    /* a stay that runs into the example season, so the night-by-night split is
     * visible on the first screen */
    var from = B.isoToDays(val("s1-from"));
    if (from === null) {
      var t = B.isoToDays(todayISO());
      setVal("q-in", B.daysToISO(t + 1));
      setVal("q-out", B.daysToISO(t + 4));
      return;
    }
    setVal("q-in", B.daysToISO(from - 2));
    setVal("q-out", B.daysToISO(from + 2));
  }

  function loadDefaults() {
    var d = defaults();
    for (var k in d) {
      if (Object.prototype.hasOwnProperty.call(d, k)) { setVal(k, d[k]); }
    }
    applyCurrency("INR", false);
    applyAccent("rose");
    applyTaxMode("extra");
    seedTestDates();
  }

  function wire() {
    var inputs = document.querySelectorAll("input, select");
    for (var i = 0; i < inputs.length; i++) {
      inputs[i].addEventListener("input", compute);
      inputs[i].addEventListener("change", compute);
    }

    var curs = document.querySelectorAll("[data-cur]");
    for (var c = 0; c < curs.length; c++) {
      curs[c].addEventListener("click", function (ev) {
        applyCurrency(ev.currentTarget.getAttribute("data-cur"), true);
        compute();
      });
    }

    var accs = document.querySelectorAll("button[data-accent]");
    for (var a = 0; a < accs.length; a++) {
      accs[a].addEventListener("click", function (ev) {
        applyAccent(ev.currentTarget.getAttribute("data-accent"));
        compute();
      });
    }

    var taxes = document.querySelectorAll("[data-tax]");
    for (var t = 0; t < taxes.length; t++) {
      taxes[t].addEventListener("click", function (ev) {
        applyTaxMode(ev.currentTarget.getAttribute("data-tax"));
        compute();
      });
    }

    var printBtn = byId("print");
    if (printBtn) { printBtn.addEventListener("click", function () { window.print(); }); }

    var resetBtn = byId("reset");
    if (resetBtn) {
      resetBtn.addEventListener("click", function () {
        var said = byId("out-saved");
        if (said) { said.hidden = true; }
        loadDefaults();
        compute();
      });
    }

    var dl = byId("download");
    if (dl) { dl.addEventListener("click", saveFile); }

    var cp = byId("copy");
    if (cp) { cp.addEventListener("click", copyHtml); }
  }

  loadDefaults();
  wire();
  compute();
})();
