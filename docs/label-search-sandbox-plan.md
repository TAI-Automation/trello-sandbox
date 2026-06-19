# Label Search Sandbox Plan

## Purpose

Label Search Sandbox is a sandbox-only Trello Power-Up MVP for searching labels from the current Trello board while viewing a card detail page.

## First Version Scope

- Search actual Trello board labels directly from Trello.
- Use `TRELLO_KEY` and `TRELLO_TOKEN` server-side through the existing credential helper.
- Rank labels with local fuzzy matching.
- Return read-only search results to the modal.
- Do not use Neon as the primary label source.
- Do not classify project or department labels.
- Do not apply labels to cards.
- Do not create, update, delete, or sync labels.
- Do not write to Neon.

## Files Added/Edited

- Added `public/power-up/label-search/index.html`
- Added `public/power-up/label-search/frame.html`
- Added `src/labelSearch/routes.ts`
- Added `src/labelSearch/repository.ts`
- Added `src/labelSearch/fuzzy.ts`
- Added `docs/label-search-sandbox-plan.md`
- Edited `src/app.ts`

## Routes Added

- `GET /api/label-search/search?boardId=<boardId>&q=<query>`

The route reads labels from Trello for the supplied board id and returns up to 20 ranked results:

- `trelloLabelId`
- `name`
- `color`
- `score`
- `matchedReason`

## Manual Trello Admin Registration Steps

1. Open the Trello Power-Up admin page for this sandbox Power-Up.
2. Add or update the connector iframe URL to:
   `https://<sandbox-host>/power-up/label-search/index.html`
3. Save the Power-Up settings.
4. Enable the Power-Up on the sandbox Trello board.
5. Open a card detail page and use the `Search Labels` card button.

## Required Vercel Env Names

- `TRELLO_KEY`
- `TRELLO_TOKEN`

## Local Test Steps

1. Start the local server:
   `npm run dev`
2. Open:
   `http://localhost:<port>/power-up/label-search/index.html`
3. In Trello, register the local or tunneled connector URL for the sandbox Power-Up.
4. Open a Trello card detail page on a board accessible to the configured token.
5. Click `Search Labels`.
6. Type a label query and confirm matching labels appear with name, color, score, and reason.

## Future Phases

### Phase 1: Fuzzy Search Trello Board Labels

Search current-board Trello labels directly, rank candidates, and show read-only results in the card modal.

### Phase 1.5: Read-Only Neon Compare

Compare Trello labels to Neon records for tracked, untracked, duplicate, project, and department annotations without writing changes.

### Phase 2: Apply Label With Explicit User Click

Add a user-triggered apply action that calls Trello only after an explicit click.

### Phase 3: AI Hint Using Fuzzy Top Candidates Only

Use only the fuzzy top candidates as input for AI-assisted hints.

### Phase 4: Learning From Search/Click Feedback

Record search and click feedback to improve future ranking after the write model is explicitly designed.
