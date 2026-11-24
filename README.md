# Direct booking page generator for homestays and small hotels

A free tool that turns your rooms, rates and policies into **one standalone
booking page** you can host anywhere for nothing — with a WhatsApp enquiry link
that arrives already carrying the dates, the room, the guest count and the
total.

Every booking taken through a travel site pays that site a commission. A small
property that wants direct bookings instead usually has nothing to point a
guest at: a social media page with rates in the bio, and a conversation that
starts from "how much for 2 nights?" and takes eleven messages to get to a
number. This builds the missing page.

## What it does

Enter your property once:

- **Rooms** — up to four, each with a nightly rate, how many guests the rate
  covers, how many the room sleeps, an extra-adult rate and a child rate.
- **Seasons** — up to three date ranges, each with a percentage change to every
  room's rate. Peak, monsoon, shoulder.
- **Policies** — check-in and check-out times, minimum stay, the age below
  which children are free, the deposit that confirms a booking, cancellation
  terms, and anything else a guest should know.
- **Tax** — its name and **your own rate**, and whether your rates already
  include it.
- **How a guest reaches you** — a WhatsApp number, an email address, or both.

Out comes a single HTML file. Save it, upload it, done: GitHub Pages, Netlify,
Cloudflare Pages, a folder on your existing site, or just sent to a guest as an
attachment. There is no account, no monthly fee and no developer.

### The maths it does

Nights are priced one at a time. Each night from arrival to the night before
departure is looked up against your seasons, and the first season covering it
sets that night's rate. **A stay that runs into a peak period is split** — two
nights at the standard rate and two at the peak rate, not four at whichever
rate applied on the day of arrival.

Then the people the rate does not cover: adults beyond the included number at
your extra-adult rate per night, and children at your child rate per night
except those below the free age. Then tax, at your rate, added on top or worked
backwards out of a tax-inclusive rate. Then the deposit, as a percentage of
the total.

It refuses to quote, and builds no enquiry link, when the departure is before
the arrival, when both dates are the same day, when no adult is on the booking,
when a date is not a real date, or when the party is larger than the room.

### The link is the product

A WhatsApp link only works if it is built exactly right: `wa.me` takes digits
with the country code and nothing else, and the message has to be
percent-encoded in full. Get it wrong and nothing visible happens — the guest
taps, sees an error or an empty chat, and goes back to the travel site. Nobody
ever tells you.

So the number is normalised properly (a leading `+` or `00` is a full
international number, a leading `0` is a trunk prefix, and a ten-digit Indian or
Philippine number that happens to begin with its own country code is not
mistaken for one that already carries it), the whole message is encoded so that
a space, an ampersand, a plus sign, a newline, an emoji, `₹`, `ñ` or a name in
Devanagari, Kannada or Tamil survives the trip, and **the finished link is shown
to you in full before you publish it**. An email version is built the same way,
with the line endings mail clients expect.

The message arrives as labelled lines — `Check-in:`, `Nights:`, `Room:`,
`Guests:`, `Total:` — so it reads at a glance and can be pulled apart later.

### The page you get

- **One file.** No stylesheet to upload, no script, no font, no image, no
  library.
- **Makes no request to anywhere.** Its own Content-Security-Policy is
  `default-src 'none'`, which leaves it no way to fetch, send or embed
  anything. That is enforced by the browser, not promised in a footer.
- **No tracking, no cookies, no analytics, no storage.** It collects nothing
  from your guests, because it has nowhere to put it.
- Works at 360px wide, follows the phone's light or dark setting, prints
  cleanly, and carries no inline event handlers.
- Readable and editable: open it in any text editor and change a rate.
- Shows rooms, rates, policies and a per-room enquiry link **even with
  JavaScript switched off**; the live date picker and running total are an
  addition on top.

## Who it is for

Homestays, farmstays, small hotels, guest houses and resorts in India and the
Philippines — anywhere from two rooms to a dozen — that want enquiries to come
to them instead of through an intermediary. Also useful for anyone quoting a
stay by hand on WhatsApp twenty times a week.

## Standards and rules it follows

No statute governs a brochure page, and this tool makes no filing and takes no
payment, so there is no regulation to comply with. What it does follow:

- **WhatsApp click-to-chat link format** — `https://wa.me/<number>?text=<text>`,
  with the number as digits including the country code and no `+`, spaces or
  dashes.
- **RFC 3986 percent-encoding** for the message in that link, and **RFC 6068**
  for the `mailto:` version.
- **E.164** as the shape a telephone number has to end up in: 8 to 15 digits,
  country code first.
- **No built-in tax rate, deliberately.** Accommodation tax is set by the state
  in India (GST on hotel accommodation, by tariff) and by the city or
  municipality in the Philippines (local taxes under the Local Government
  Code), and both change. The rate and its name are yours to enter. Anything
  hardcoded here would be wrong somewhere, and would be wrong everywhere
  eventually.

## How to run it

It is a static page. Clone or download, then:

```sh
python3 -m http.server 8137
```

and open <http://localhost:8137/>. Any free port will do; if 8137 is taken,
pick another. Opening `index.html` straight from the file system works too.

Tests:

```sh
node tests/booking.test.js
```

That runs the rate maths, the seasonal split, both tax modes, every guard,
phone normalisation and the link encoding against a table of awkward input, and
then loads the engine out of a freshly generated page and re-runs every
scenario through it — so the arithmetic a guest's phone does is the arithmetic
the tests checked. `tests/index.html` runs the same suite in a browser.

## Honest about what this is not

**It is not a booking engine.** There is no server, so nothing can hold a room,
check availability against your calendar, stop two guests booking the same
night, or take a payment. The page states your rates and hands you a complete
enquiry; the booking exists when you reply to confirm it. Anything that claimed
otherwise without a server would be lying to your guests.

**The numbers are only as right as what you type.** Check a quote against your
own tariff card before you publish, and confirm your tax position with your
accountant or your local authority — the tool applies the rate you give it and
has no opinion about whether it is the right one.

**Rates on a published page are a price list, not a contract**, and a guest may
read one that is out of date. Regenerate and re-upload the file when your rates
change, and keep the date shown in the footer honest.

**Nothing you enter here leaves your device**, and the page you download
collects nothing from your guests. That is a property of there being no server
at either end, not a policy that could change.

MIT licensed.
