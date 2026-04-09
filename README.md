# Bat Yam Strategy HQ

A React-based management dashboard for Bat Yam strategy tasks.

## Features

- **Project Board**: Categorized task list (Emergency, 100, Beach, Youth)
- **Strategy Map**: Visual mind map using Mermaid.js
- **Calendar**: Integrated Google Calendar view
- **MS To Do Integration**: Placeholder for Microsoft Graph API

## Tech Stack

- Vite + React + TypeScript
- Tailwind CSS
- Mermaid.js

## Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start development server:
   ```bash
   npm run dev
   ```

3. Open http://localhost:5173 in your browser.

## Build

```bash
npm run build
```

## Mobile First

The UI is responsive and optimized for iPhone usage.

## Data

Tasks are loaded from `public/tasks.json`.

## Troubleshooting

- Ensure Node.js is installed.
- If npm is not recognized, add Node.js to PATH.