# SwiftUI Handoff Notes

## Auth/Env
- Secrets required: `EDAMAM_APP_ID`, `EDAMAM_APP_KEY`, `SPOONACULAR_KEY`, `OPENAI_API_KEY`, `RAPIDAPI_KEY`, `LEXICON_API_KEY`.
- How to verify: `GET /healthz` should return `"secrets_missing": []` when everything is configured.

## Endpoints (app-facing)
### POST `/user/prefs?user_id=USER123`
- Body (partial merge allowed):
```json
{ "prefs": { "dairy_sensitive": true, "garlic_onion_sensitive": true, "fodmap_strict": false } }
```
- Returns the merged prefs JSON with `200 OK`.

### GET `/organs/list`
- Returns dynamic organ slugs, e.g.:
```json
{ "organs": ["gut", "liver", "heart", "brain", "kidney", "immune"] }
```

### GET `/user/meals/recent?user_id=USER123&limit=5`
- Each item includes `tummy_barometer`, `organ_levels`, `organ_colors`, `insight_lines`, `calories_kcal`, and a `dish_summary` (emoji + short reason).
- Example row:
```json
{
  "dish": "Grilled Salmon",
  "tummy_barometer": 72,
  "dish_summary": "🟢 Omega-3 brain/heart benefit",
  "calories_kcal": 520
}
```

## SwiftUI First-Pass API Usage
1. `APIClient.setPrefs(userID:prefs:)` → `POST /user/prefs` (merge prefs).
2. `APIClient.fetchDish(userID:dish:)` → `GET /organs/from-dish?dish=...&user_id=...` for recipe insights.
3. For the Recent list, call `GET /user/meals/recent` and render the fast `dish_summary` string in the list UI.

## Health & Rate Limit
- `GET /healthz` returns `{ ok, d1, secrets_missing, ts }` for monitoring.
- Rate limit: 60 requests per minute per IP. Exceeding the quota returns `HTTP 429` with `{ "ok": false, "error": "rate_limited", "limit": 60 }`.
