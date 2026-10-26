# Contractor Schedule in Siddhi
## How it works, and how we are keeping it solid

A short briefing for anyone who needs to understand the dual-schedule change we are rolling out. Written in simple words. Share it as-is.

---

## What we are adding

- A second schedule to Siddhi, from the contractor team.
- Our in-house schedule stays as it is, with its buffers.
- Siddhi compares the two and flags danger per activity.

---

## The monthly flow

- Each contractor sends one Excel per month at the activity level: which villa, which activity, their planned start and end.
- Vandana uploads it to Siddhi.
- Siddhi matches each row to the right activity on the in-house schedule using the villa and the activity name.
- Siddhi then compares the two end dates for every activity.

---

## The colour signal, per activity

- 🟢 **Green** — the contractor's planned end is comfortably inside our in-house window.
- 🟠 **Orange** — the contractor's planned end is within 5 to 10 days of ours. Warning, buffer is thinning.
- 🔴 **Red** — the contractor's planned end has reached or passed ours. Our buffer is gone. Project will slip.
- ⚪ **Blank** — the contractor has not planned this activity for this month. Not comparable yet.

The signal is relational. It is not about raw dates. It is about the gap between the two schedules.

---

## Weekly digest

- Vandana gets an email every Monday morning summarising all orange and red items for the week.
- Vandana handles the follow-ups. Shraddha gets looped in if a red sits unresolved for more than a week.

---

## What is not changing

- The site team's daily use of Siddhi is unchanged.
- The in-house schedule itself is unchanged.
- Sales milestone payments still fire on in-house dates. Nothing moves there.
- The current app, the screens, the flows stay exactly the same for everyone until we test and roll out slowly.

---

## How we are keeping it solid for years

- **Base built carefully.** The data structure is the hardest thing to change later. Extra time spent here, tested against a bigger imaginary project, made sure it will not crack.
- **Settings stay flexible, not baked in.** Alert thresholds, email recipients, timing rules all live as per-project settings. A new project onboards by filling a form, not by rewriting code.
- **Nothing in the code says Amanvana.** Works for the next project out of the box.
- **Every upload is logged.** Who uploaded, when, what filename, how many rows. If something reads wrong six months later, we trace back to the exact file in two clicks.
- **Colour logic is tested.** Each edge case (same-day end, next-day end, no plan at all, overdue by one day) has a test. A rare date combination cannot silently flip a signal to green when it should be red.
- **Preview before saving.** Every upload shows the parsed file inside Siddhi first. Vandana confirms each row, then commits. A bad file never reaches the dashboard.

---

## Timing

- No fixed deadline. The work goes on a separate development branch.
- Nothing you use day to day will break while we build.
- Realistic estimate is 5 to 8 weeks from the time we receive the first contractor schedule.
