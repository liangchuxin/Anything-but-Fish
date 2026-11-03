# Anything but Fish

Anything but Fish is a mobile web game for players who enjoy illustrated stories and conversations with fictional characters. Players meet NPCs in a graphic novel and continue talking to them in a separate chat interface. Items collected from the story and conversations are stored in an inventory and can be submitted during the story to unlock content or continue.

This semester, our MVP will include the graphic novel with dialogue choices and selected p5.js interactions, the inventory and item submission system, and basic NPC chat with memory across sessions.

## Background

Anything but Fish began as a [course proposal](https://github.com/liangchuxin/agile-project-proposal). We are developing it as a team project for Agile Software Development & DevOps.

## Team

- [Celia Liang](https://github.com/liangchuxin)
- [Jonas Chen](https://github.com/JonasChenJusFox)
- [Anthony Wang](https://github.com/aw4580)
- [Nigina Rashidova](https://github.com/monbbdzy)

## Documentation

- [UX Design](UX-DESIGN.md): app map, wireframes, and prototype link
- [Contributing](CONTRIBUTING.md): team norms and development workflow
- [Story content](front-end/src/content/story/README.md): JSON structure, page templates, and image/text blocks

## Setup and Testing

Requires Node.js 22.12 or newer and MongoDB Atlas. On a new checkout copy the
`.env.example` files in `front-end` and `back-end` to `.env` (ignored by Git).
In `back-end/.env`, configure the Atlas username/password and a random
`JWT_SECRET` of at least 32 characters. See [backend setup](back-end/readme.txt)
for secret generation and Atlas network access.

Run `npm install` and `npm run dev` in `back-end` to start the API on port 8000.
In a second terminal run the same commands in `front-end`, then open
`http://localhost:5173`. Vite forwards `/api` to the backend. Run `npm test` in
`back-end` for Atlas integration tests in an isolated, automatically cleaned test
database; run `npm run build` in `front-end` to verify its production build.

Authentication stores accounts and salted password hashes in MongoDB, with JWTs
in HttpOnly cookies and revocable sessions. The frontend uses native HTML forms
and fetch; database credentials stay on the backend. Password recovery is currently
unavailable; the application has no outgoing email integration or verification-code
step. See [frontend setup](front-end/readme.txt)
and [backend API contract](back-end/readme.txt). Game persistence is still planned.
The current Render configuration hosts only the static frontend; production also
needs a backend service and API routing.


## Sprint 1 Plans

### Technology Stack

| Component | Technology | Purpose |
|---|---|---|
| Frontend | React + Vite | Build interactive game pages |
| Styling | CSS | Design responsive mobile interfaces |
| Backend | Node.js + Express | Handle API requests and game logic |
| Database | MongoDB Atlas | Store user data and game progress |
| Database Driver | Mongoose | Validate models and connect to MongoDB |
| Authentication | JWT in HttpOnly cookies + MongoDB sessions | User login and registration |
| API | REST API + Fetch | Connect frontend and backend |
| Version Control | Git + GitHub | Team collaboration |

### Main Tasks

### Frontend
- Build login, home, fishing, and investigation pages.
- Convert the Sprint 0 prototype into React components.
- Connect frontend pages to backend APIs.
- Implement basic navigation and user interactions.

### Backend
- Set up the Node.js Express server.
- Implement user registration and login.
- Create APIs for fishing and retrieving anomalous objects.
- Implement investigation choices and game logic.
- Create APIs for saving and loading player progress.

### Database (MongoDB)
- `users` — User accounts and character attributes.
- `objects` — Anomalous objects, descriptions, and ratings.
- `investigations` — Story scenes and player choices.
- `playerProgress` — Current investigation progress and decisions.
- `archives` — Completed investigations and collected trophies.

### Sprint Goal
Build a working version of *Anything but Fish* where users can log in, fish for an anomalous object, start an investigation, make story choices, and save their progress in MongoDB.
