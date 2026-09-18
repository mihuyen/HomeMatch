<div align="center">

![HomeMatch logo](docs/logo.svg)

# HomeMatch

Rental property management system for the Hanoi market — from landlord consignment to tenant contract and deposit refund.

![Node.js](https://img.shields.io/badge/Node.js-339933?logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?logo=express&logoColor=white)
![MySQL](https://img.shields.io/badge/MySQL-4479A1?logo=mysql&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-010101?logo=socketdotio&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?logo=tailwindcss&logoColor=white)
![Chart.js](https://img.shields.io/badge/Chart.js-FF6384?logo=chartdotjs&logoColor=white)
![Leaflet](https://img.shields.io/badge/Leaflet-199900?logo=leaflet&logoColor=white)

</div>

## Overview

Landlords submit properties; internal staff (sales, legal, accounting, brokers) move each one through survey → contract → legal review → deposit → listing → tenant rental. Every stage is tracked, and management gets a reporting dashboard.

## Features

- **Consignment** — multi-step property submission with a progress timeline for the landlord
- **Survey & contracts** — survey scheduling and results, 3-step contract wizard, signed-scan upload
- **Legal & accounting review** — approve/reject with comments; deposit refunds on expiry
- **Deposits** — VietQR payment, confirmed live via SePay webhook + Socket.IO
- **Listings** — browse, save, and request viewings (auto-assigned to the least-busy broker)
- **Brokers** — viewings, rental contracts, commission tracking
- **Admin dashboard** — revenue, conversion and broker stats with Excel/PDF export and email reports

## Screenshots

| Landing | Admin dashboard | Deposit payment |
| --- | --- | --- |
| ![](docs/screenshots/landing.png) | ![](docs/screenshots/admin-dashboard.png) | ![](docs/screenshots/deposit.png) |

## Architecture

```
Browser (HTML + api.js) ──Bearer token──▶ Express :5050 ──▶ auth middleware ──▶ routes ──▶ MySQL
         ▲                                    │
         └──────────── Socket.IO ◀────────────┘ (payment confirmed)
```

Express serves both the API (`/api/*`) and the `Frontend/` folder — no build step. Auth uses random session tokens stored on the user row, checked by `requireAuth` / `requireRole`.

## Business / User Roles

| Role | Responsibility |
| --- | --- |
| Owner | Submits and tracks properties |
| Tenant | Browses listings, requests viewings |
| Sale | Surveys, consignment contracts, deposits |
| Legal | Reviews contracts |
| Accountant | Approves contracts, refunds deposits |
| Broker | Handles tenants and rental contracts |
| Admin / Manager | Assigns work, views reports |
| IT | Manages users and listings |

## Project Structure

```
HomeMatch/
├── Backend/
│   ├── server.js        # app entry, static hosting, Socket.IO
│   ├── middleware/      # auth + role guards
│   ├── routes/          # one module per role/domain
│   └── seed_*.js        # demo data
└── Frontend/            # one HTML page per screen, shared api.js
```

## Setup

Requires Node.js 18+ and MySQL 8 with a `homematch` database.

```bash
cd Backend && npm install
```

Set your MySQL credentials in `Backend/db.js`, seed demo accounts, then start:

```bash
cd Backend && node seed_admin.js && npm run dev
```

Open http://localhost:5050.

## Future Improvements

- Move credentials to `.env` and check the DB schema into the repo as migrations
- Re-enable the IT role check and verify SePay webhook signatures
- Add an automated test suite
- Real-time notifications beyond payments
- Cloud storage for uploaded contracts
