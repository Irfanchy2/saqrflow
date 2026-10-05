# AI document reader & auto-filing

```
upload ─► private storage (vault/{company}/inbox/{uuid}/file) ─► text ─► AI classification ─► validation ─► matching ─► confidence ─► review ─► Confirm & File ─► reminders
                                                                │
              cache (same SHA-256) → PDF text layer → OCR provider chain (Google Vision → OCR.Space → local Tesseract)
```

## Providers (all server-side; keys never reach the browser)
| Layer | Provider | Config | Notes |
|---|---|---|---|
| OCR | Google Cloud Vision | `GOOGLE_SERVICE_ACCOUNT_JSON` / `GOOGLE_APPLICATION_CREDENTIALS` (+ `GOOGLE_CLOUD_PROJECT_ID`) or `GOOGLE_VISION_API_KEY` | `DOCUMENT_TEXT_DETECTION` for images, `files:annotate` for PDFs (first 5 pages), English + Arabic hints. Service-account JWT → OAuth token, cached. |
| OCR | OCR.Space | `OCR_SPACE_API_KEY` (`OCR_SPACE_ENGINE`, `OCR_SPACE_ENDPOINT`, `OCR_SPACE_MAX_BYTES`) | Engine 2 + auto language; Arabic-only scans are re-read with engine 1 / `ara`. Handles API errors, 1 MB free-tier size limit, rate limits, timeouts, empty results. |
| OCR | Local Tesseract | built in | Images only; nothing leaves the server. Final fallback, or the only reader in "Local OCR only" mode. |
| AI | Gemini | `GEMINI_API_KEY`, `GEMINI_MODEL` | JSON-schema constrained output (`responseSchema`), temperature 0. Gets **OCR text only**; ID numbers are removed first (setting on by default). |
| AI | Claude | `ANTHROPIC_API_KEY` | Optional; reads the original file (vision). |

`lib/ai/ocr/types.ts` (`OCRProvider`: `extractText`, `extractDocument`, `healthCheck`) and `lib/ai/llm/types.ts` (`AIProvider`: `classifyDocument`, `extractMetadata`, `matchEntity`, `generateStructuredOutput`) are the extension points for another OCR engine or LLM.

Provider choice: **Settings → AI & Automation** (or `OCR_PROVIDER` / `AI_PROVIDER`). AUTO = Google Vision when configured, else OCR.Space, else local OCR; Gemini when configured, else Claude, else local rules. Keys can also be pasted there: they are AES-GCM encrypted (`SETTINGS_ENCRYPTION_KEY`) in `integration_secrets` (no RLS policies — server only) and only ever displayed as `••••••••xyz7`. Environment variables take precedence.

## Never trusting the AI
* Output must match the schema (zod) — otherwise the document goes to **Needs review**.
* Every value is cross-checked against the OCR text: a date, number or name that is not in the document is **dropped** with a warning ("AI expiry date … does not appear in the document — ignored").
* Unknown types become `unknown`; `requires_manual_review`, confidence < 70 %, or a missing expiry date on an expiring document force review.
* AI and the local rules are merged: agreement raises confidence; disagreement caps it at 60 % and asks the reviewer.
* Emirates ID (Luhn check digit), TRN, passport format and date sanity are validated locally.
* Nothing is filed without **Confirm & File**. "Confirm all suggested" only files high-confidence items, and is still an explicit click.

## Statuses
`uploaded → processing → ocr_complete → classification_complete → ready | needs_review | duplicate | failed`, then `filed` or deleted (`rejected`, kept for audit). Failed items keep the original file and offer **Reprocess** (optionally with another OCR provider) or manual entry.

## Matching (local — no employee/customer lists are sent to any AI)
Employees: ID numbers already on file, employee ID, name (alias-aware). Customers/suppliers: TRN, then name. Projects: code, name, PO number linked to an invoice. Vehicles: plate number against Vehicles & Assets. An unknown person is **never** auto-created — the reviewer can choose "Create new employee", which refuses an existing name.

## Filing
One stored file, many links (`document_relationships`: company, employee, customer, supplier, project, vehicle, invoice, payment, …). Renewals become a new **version** of the existing document (previous file kept, renewal history recorded, one reminder schedule). Duplicates (same SHA-256 / same number) offer *View existing*, *New version*, *Replace metadata* or *Delete upload*. Default reminders: 90/60/30/15/7/3/1/0 days, one schedule per document (no duplicates), linked to the responsible user.

## Cost control
`ocr_logs`, `ai_processing_logs` (append-only) and the `ai_usage_daily` view count calls, failures, cache hits and volume (Settings shows the last 30 days). Identical files reuse the earlier reading; digital PDFs are read from their text layer without any OCR call.

## Privacy
Originals stay in the private `vault` bucket (company-id/…/uuid paths, signed URLs only). OCR providers necessarily receive the file; choose **Local OCR only** to keep ID images on your server. Gemini receives text only, with Emirates ID / passport / MRZ / IBAN / card numbers removed. WhatsApp messages never contain document numbers or files.

## Tests
`tests/unit/ai-providers.test.ts` (provider request/response contracts, error mapping, JWT signing, schema validation, hallucination guard, redaction, search parsing), `tests/db/rls.test.ts` (log RLS, statuses), `tests/e2e/ai-reader.mjs` (full flow against HTTP stand-ins with the real OCR.Space / Gemini wire format — the stand-ins live only in the test gateway).
