# The Startup Kitchen: request system setup

Founders send a request on the website. Your team sees every request in the
Kitchen planner (startupkitchenbypistahouse.com/planner.html), calls or
WhatsApps the founder, and confirms the slot. Everything is saved in a Google Sheet.

## One-time setup (about 10 minutes)

1. Go to sheets.google.com and create a blank sheet named **Startup Kitchen Requests**.
2. In the sheet: **Extensions > Apps Script**. Delete the sample code, paste everything
   from `apps-script/Code.gs`, and press Ctrl + S. Name the project **startup kitchen planner**.
3. Click the gear icon (**Project Settings**) > **Script Properties > Add script property**:
   - `TEAM_PIN`: the PIN your team will use to open the planner (6 to 8 digits)
   - `TEAM_EMAIL`: email that gets an alert for every new request (optional)
   Click **Save script properties**. Keep the PIN only here, never on GitHub.
4. Back in the editor, choose **setup** in the function list at the top and click **Run**.
   Allow the permissions Google asks for.
5. Click **Deploy > New deployment**, gear icon > **Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
   Click **Deploy** and copy the **Web app URL** (it ends in `/exec`).
6. On GitHub, open `assets/config.js` > pencil > paste the URL between the quotes of
   `API_URL: ""` > **Commit changes**.

Open startupkitchenbypistahouse.com/planner.html and enter the team PIN.

After editing Code.gs later: **Deploy > Manage deployments > edit > Version: New version > Deploy**.
The URL stays the same.

## How it works

1. A founder picks a preferred date and slot and sends a request. They get a request
   number (for example SK-1053) and the message that it is not confirmed yet.
2. The request appears in the planner under **Requests** (and an email alert goes out).
3. Your team taps **Call** or **WhatsApp**, then **Mark contacted**.
4. Tap **Confirm**, set the date, slot and mentor. The website calendar then shows that
   slot as booked. If the founder gave an email, they get a confirmation email.
5. Tap **Send confirmation** to send the WhatsApp confirmation message.
6. After the slot: **Mark done** or **No show**. Phone bookings: **Add booking**.
