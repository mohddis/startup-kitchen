# The Startup Kitchen: how requests work

Founders send a request on the website. The team sees every request in the
Kitchen planner (startupkitchenbypistahouse.com/planner.html), calls or
WhatsApps the founder, and confirms the slot.

## Where things live

- `index.html`: the public website and request form
- `planner.html`: the team planner (PIN-protected)
- `assets/config.js`: the address of the planner server (`API_URL`)
- `server/`: the planner server, hosted on Render as **startup-kitchen-planner**.
  Requests are stored in the Render Postgres database, table `sk_requests`.

## Render settings (service: startup-kitchen-planner)

- `DATABASE_URL`: the database's Internal Database URL
- `TEAM_PIN`: the PIN the team uses to open the planner. Change it here any time;
  the planner picks it up after the service restarts.

## Using the planner

1. New website requests appear under **Requests**.
2. Tap **Call** or **WhatsApp**, then **Mark contacted**.
3. Tap **Confirm** and set the date, slot and mentor. The website then shows
   that slot as booked.
4. Tap **Send confirmation** to send the WhatsApp confirmation.
5. After the slot: **Mark done** or **No show**. Phone bookings: **Add booking**.
6. **Download** saves every request as a spreadsheet file (opens in Excel or Google Sheets).
