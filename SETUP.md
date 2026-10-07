# The Startup Kitchen: how requests work

Founders send a request on the website. The team sees every request in the
Kitchen planner (startupkitchenbypistahouse.com/planner.html), calls or
WhatsApps the founder, and confirms the slot.

Everything runs for free on GitHub Pages and a Google Sheet. There is no server
to pay for.

## Where things live

- `index.html`: the public website and request form
- `planner.html`: the team planner (PIN-protected)
- `assets/config.js`: the address of the Google Sheet connection (`API_URL`)
- `apps-script/Code.gs`: the code that connects the website to the Google Sheet

Requests are saved in the **Requests** tab of the "Startup Kitchen Requests"
Google Sheet. The team PIN and the alert email are in its **Settings** tab.

## One-time setup (about 10 minutes)

1. Go to **sheets.google.com** and create a blank spreadsheet named
   **Startup Kitchen Requests**.
2. In the sheet, click **Extensions > Apps Script**. Delete the sample code,
   paste everything from `apps-script/Code.gs`, and press **Ctrl + S**.
3. In the function list at the top, choose **setup** and click **Run**. Allow the
   permissions Google asks for. The sheet now has **Requests** and **Settings** tabs.
4. In the **Settings** tab, type the team PIN in cell **B2**. Optionally type an
   email in **B3** to get an alert for every new request.
5. Back in Apps Script, click **Deploy > New deployment**. Click the gear icon and
   choose **Web app**. Set **Execute as: Me** and **Who has access: Anyone**, then
   click **Deploy** and copy the **Web app URL** (it ends in `/exec`).
6. On GitHub, open `assets/config.js`, click the pencil, paste the URL between the
   quotes of `API_URL: ""`, and click **Commit changes**.

Open the planner, enter the PIN, and you're done.

To change the PIN later, just edit Settings!B2. After editing `Code.gs`, use
**Deploy > Manage deployments > Edit (pencil) > Version: New version > Deploy**
so the URL stays the same.

## Using the planner

1. New website requests appear under **Requests**.
2. Tap **Call** or **WhatsApp**, then **Mark contacted**.
3. Tap **Confirm** and set the date, slot and mentor. The website then shows
   that slot as booked. The planner warns you if the slot is already taken.
4. Tap **Send confirmation** to send the WhatsApp confirmation. If the founder
   gave an email, they also get a confirmation email.
5. After the slot: **Mark done** or **No show**. Phone bookings: **Add booking**.
6. **Download** saves every request as a spreadsheet file. You can also open the
   Google Sheet directly to see every request.
