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
4. In the **Settings** tab, type the team PIN in cell **B2**. Use at least 8
   characters, mixing letters and numbers (for example `Kitchen#2026`). Optionally type an
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

## Keeping it safe

- **Team PIN:** use 8 or more characters. A short PIN is locked for 15 minutes
  after 30 wrong tries, so it can't be guessed. A strong PIN is never locked,
  so nobody can lock the team out by typing wrong PINs, but each wrong try is
  slowed down more and more. After 30 wrong tries in 15 minutes the alert email
  in Settings!B3 gets a warning. If you get one, change the PIN.
- **The Google Sheet:** keep it shared only with people on the team. Anyone who
  can open the sheet can see every founder's phone number and the team PIN.
- **After changing `Code.gs`:** paste it into Apps Script again, then use Deploy >
  Manage deployments > Edit (pencil) > Version: New version > Deploy. The website
  keeps working with the old version until you do.
- **Nothing secret lives on GitHub.** The Web app URL in `assets/config.js` is
  meant to be public. The PIN and alert email stay in the sheet.

## Backups

`setup` turns on a nightly backup. Every night between 2 and 3 am (India time) a
full copy of the sheet is saved in the Google Drive folder **Startup Kitchen
backups**. The newest 30 daily copies are kept, plus the copy from the 1st of
each month for the last 12 months. Older copies go to the Drive bin.

If you set the sheet up before backups existed, open Apps Script, choose
**installBackup** in the function list, click **Run**, and allow the new Drive
permission. To make a backup straight away, run **backup**.

**Test a restore once a month.** In Apps Script, run **restoreLatestBackup**. It
copies the Requests tab from the newest backup into a new tab called
"Restored <date>" and doesn't touch the live Requests tab. Check that the
requests look right, then delete that tab. To really restore after a mistake,
copy the rows you need from the restored tab back into **Requests**.

## Request history

The planner never deletes a request. Requests that won't go ahead are marked
**Declined**, **Cancelled** or **No show**, so the full history stays in the
sheet.

When the team confirms a booking with **Send confirmation**, the sheet records
when the email was sent, the address it went to, and whether it was **Sent** or
**Failed** (last three columns of Requests).
