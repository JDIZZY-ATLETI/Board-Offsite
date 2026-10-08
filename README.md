# Board Offsite

> **Purpose:** _TODO — add a short description of what Board Offsite does._

A full-stack web application built with **Next.js** (React + TypeScript).

## Status

✅ The Next.js (App Router) application is scaffolded and builds successfully — ready
for feature development.

## Tech Stack

| Layer     | Technology                         |
| --------- | ---------------------------------- |
| Framework | Next.js (App Router)               |
| Language  | TypeScript                         |
| UI        | React                              |
| Runtime   | Node.js                            |

## Project Structure

```text
Board-Offsite/
├── docs/               # Project documentation
├── public/             # Static assets (images, fonts, etc.)
├── src/
│   ├── app/            # Next.js App Router (routes, layouts, pages)
│   │   └── api/        # Route handlers (backend API endpoints)
│   ├── components/     # Reusable React components
│   ├── lib/            # Shared utilities, data access, server logic
│   └── types/          # Shared TypeScript type definitions
└── tests/              # Automated tests
```

## Getting Started

```powershell
# Install dependencies
npm install

# Start the development server
npm run dev
```

Then open http://localhost:3000 in your browser. A sample health endpoint is
available at http://localhost:3000/api/health.

## Development

This repository uses AI agents defined under `.claude/agents/` (Architect, UX
Designer, Web Developer, and QA Engineer) to help design and build the
application. See `.github/instructions/` for the guidelines these agents follow.

## License

Proprietary — All Rights Reserved. See [LICENSE](LICENSE).
