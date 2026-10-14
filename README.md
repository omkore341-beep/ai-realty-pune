# AI Realty Advisor — Pune

A complete website conversion of the uploaded AI Realty Streamlit/notebook project.

## Stack

- Frontend: HTML5 + Tailwind CSS + vanilla JavaScript
- Backend API: Node.js + Express
- Database: PostgreSQL
- Authentication: bcrypt + express-session + PostgreSQL session store
- Charts: Chart.js
- Maps: Leaflet + OpenStreetMap
- ML preparation: the supplied dataset was reprocessed with the notebook's RandomForest configuration and 40–98.5 investment-score normalization.

## Included features

1. Home
2. Property Search + inquiry submission
3. Property Details + AI valuation
4. 2D Layout Visualizer + illustrative room tour
5. Location Intelligence + locality map + facility distances
6. Total Cost & EMI
7. Market Intelligence + model metrics
8. Document Verification + uploads + consistency checker
9. Admin Portal with login, user inquiries, SQL GROUP BY analytics, Create/Update/Delete listings
10. **Site-visit booking** (date + time slots, 10-minute slot hold) with a **simulated token payment** and printable receipt
11. Admin view of site visits and token payments (mark visited, cancel + simulated refund)

The admin portal default password is `admin123`. Change it with `ADMIN_PASSWORD` before any real deployment.

## Run with Docker PostgreSQL

### 1. Start PostgreSQL

```bash
docker compose up -d
```

### 2. Install Node packages

```bash
npm install
```

### 3. Start the website

```bash
npm start
```

Open http://localhost:3000

The server automatically creates the PostgreSQL schema and seeds the 300 supplied properties on first start.

## Environment

Copy `.env.example` to `.env` and change values if required.

```text
PORT=3000
DATABASE_URL=postgres://postgres:postgres@localhost:5432/airealty
SESSION_SECRET=change-this-secret
ADMIN_PASSWORD=admin123
UPLOAD_DIR=./uploads
```

## Notes

- The layout and room-tour visuals are procedural/illustrative, not sanctioned architectural plans or photographs.
- The document checker compares the user-supplied Property ID, locality, area and price against the dataset; it does not authenticate legal documents or prove fraud.
- The map uses approximate locality-center coordinates because the supplied dataset contains facility distances but not exact facility coordinates.
- Cost/EMI rates are prototype configuration values and should be verified for a real transaction.
- The model metrics are calculated from the supplied 300-row dataset using an 80/20 split and RandomForestRegressor. The website stores the prepared model outputs in `data/properties.csv` so the Node/PostgreSQL application can run without Python at runtime.

## Windows shortcut

If Docker Desktop and Node.js are installed, double-click `start.bat` to start PostgreSQL, install packages, and launch the site.

## Site-visit booking and token payment

- Buyers open **Book Site Visit**, pick a date/time, enter details, then pay a token on a **demo payment page** (no real money).
- Token = 1% of price, min Rs 10,000, max Rs 1,00,000. Slots: 10:00-17:00 (7 a day), next 14 days, India time.
- Demo failure: a card number ending in `0000` is declined.
- Settings (times, days, hold minutes, token formula) are constants at the top of the booking block in `server.js`.
- Tables: `visit_bookings`, `payments` (created automatically from `schema.sql`).
- Card numbers are never stored - only the payment method and a fake transaction ID.

## Quick start (terminal)

```bash
# Windows: double-click start.bat   |   Mac/Linux: ./start.sh
docker compose up -d
npm install
npm start
```

Then open http://localhost:3000 (admin password: `admin123`).

To reset the database completely: `docker compose down -v` then start again.
