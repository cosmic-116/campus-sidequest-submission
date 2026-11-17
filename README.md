# Campus SideQuest

A college DBMS project for finding help beyond your usual group of classmates. Students post small requests, accept tasks and exchange campus points. The app uses plain HTML, CSS and JavaScript, an Express server and a MySQL database. Points have no cash value.

## Run locally

Install Node.js 22 or later and MySQL Community Server 8.0.16 or later. Run the commands from the repository folder.

### Windows quick start

The helper uses an installed MySQL Server binary and starts a separate project database on port 3407.

```powershell
npm ci
npm run local:init
npm run db:seed
npm start
```

Open [http://localhost:3000](http://localhost:3000). If MySQL is installed in a different directory, set `MYSQLD_PATH` to the full path to `mysqld.exe` before running `local:init`. The default is `C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqld.exe`.

On subsequent runs, use `npm run local:start` followed by `npm start`. Stop the website with Ctrl+C and the project database with `npm run local:stop`.

### Use an existing MySQL server

1. Run `npm ci` and copy `.env.example` to `.env`.
2. In MySQL Workbench, connect as a database administrator. Open `database/05_permissions.example.sql`, replace the three example passwords, and run the initial setup through the last `SET DEFAULT ROLE` statement.
3. In `.env`, set the MySQL host and port, the three matching passwords and a random `SESSION_SECRET` of at least 32 characters. Generate one with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
4. Run the commands below. MySQL may require the database administrator to allow trigger creation if binary logging is enabled.

```sh
npm run db:setup
npm run db:seed
npm start
```

## Try the demo

All seeded accounts use the demo password `CampusDemo!2026`.

| Account | Email |
| --- | --- |
| Prince | `prince@demo.campus.test` |
| Jayant | `jayant@demo.campus.test` |
| Dhruv | `dhruv@demo.campus.test` |
| Siddhanth | `siddhanth@demo.campus.test` |
| Demo Admin | `admin@demo.campus.test` |

Post a 5-point request as Prince and accept it as Jayant. Jayant can open the private chat and submit a short work summary. Prince can then approve it and leave a review. Open **Points** as Jayant to see the payout. The admin account can review seeded disputes.

## How it works

| Folder | Contents |
| --- | --- |
| `public/` | Task board, profile, wallet, rankings and private chat popup |
| `src/` | API routes, sessions, input checks and the MySQL connection |
| `database/` | Tables, views, stored procedures, fictional seed data and example queries |
| `scripts/` | Setup, seeding and test commands |
| `tests/` | Integration tests for the API and MySQL workflows |

The requester sets aside points when posting a task. The `claim` table allows one helper per task. Approval records the work as complete and transfers the reserved points in the same transaction. Cancelling an open request returns the points. The wallet derives its balance from incoming and outgoing transfers.

See the [entity relationship diagram](docs/ER.svg). Run `npm test -- --reset campus_sidequest_test` to run the integration tests. This command recreates the separate test database.
