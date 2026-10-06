# Ward Restock: daily how-to

1. **Today**: open the app. The five steps show what is done and what is next (the dot in the bottom bar marks the next step).
2. **Receive**: for each pallet line pick the fluid, enter cartons (or units) and tap **Add to store stock**. No delivery? Tap **skip**.
3. **Walk**: pick a ward and count each shelf with − / + (or type it). **Full** means it is at par. Tap **Scan** to jump to a fluid from its shelf label. **Save walk**. Repeat for each ward.
4. **Pick**: load the trolley from the combined list (sorted by bay and shelf), then check the per-ward list. Tick as you go, or **Print** it.
5. **Deliver**: set the route order (drag ⠿ or use the arrows). Tick each line once shelved. Couldn't deliver it all? Tap **Short** and enter how many.
6. **Order**: check the list (below store minimum, needed tomorrow, shortages). Switch **Units / Cartons**, then **Copy**, **Share** or **Print** it and tap **Mark order as sent**.
7. **Start new day** (on Today) saves the day into **History** and clears the steps. Store stock carries over. **History** also suggests par changes (it never changes them by itself).

## Whole boxes (v1.1)

By default everything is in **whole boxes** (cartons): pars, shelf counts, the pick list, the trolley, delivery and orders show boxes first and pieces second, e.g. *2 boxes (24 bags)*, always rounded up to a whole box. On the ward walk you count **boxes on the shelf**: count a part-used box if it is at least half full. Top-up = par boxes − boxes on the shelf. Switch to single units in **Setup → Data**.

Each fluid has a **product code** (shown on pick lists, delivery, orders and shelf labels) and **units per carton**. A small **check carton** marker means the carton size is blank or not confirmed: fix it in **Setup → Fluids** and tap **Confirm** (typing a new number also confirms it).

## Loading a private setup (file or link)

**Setup → Import / export → Load setup file (.json)** replaces the wards and fluids with a setup file of the form `{"format":"ward-restock-setup","version":1,"name":…,"wards":[{"name","on","note"}],"fluids":[{"name","pack","code","upc","upcOk","unit","note"}]}`. A link of the form `…/#setup=<deflate-raw, base64url>` does the same when opened on the phone. The part after `#` is never sent to any server, and it is removed from the address bar as soon as it is read. Wards with `"on": false` are off the round (turn them on in **Setup → Wards**). The setup is kept only in this phone's storage. **Back to sample data** is on the same screen.

## Swapping in your real wards, fluids and pars

1. Go to **Setup → Import / export** and tap **Excel template (.xlsx)**.
2. In Excel fill in the **Wards** sheet (name, route order), the **Fluids** sheet (name, pack size, units per carton, store location, store minimum, store stock) and the **Pars** sheet (one column per ward; 0 = not stocked; when the first header says *Fluid (boxes)* the pars are in whole boxes). Keep the header rows.
3. Back in the app tap **Choose file(s)…**, pick the saved file, check the preview (it lists any problems by row), then tap **Apply import**. The sample data and its made-up history are replaced. Undo is offered straight after.

Tip: **Setup → Data → Download backup** now and then. Everything lives only on this phone. Stock data only: never enter patient details.
