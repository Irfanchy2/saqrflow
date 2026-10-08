# Smart Document Inbox (Phase 1 of the document-automation update)

Drop any document in **Smart Inbox** (sidebar). Averiqo reads it, works out what it is and who it belongs to, and proposes where to file it.
**Nothing is filed until a person confirms**; uncertain results are labelled *Manual review required*.

## Flow
1. **Upload** (drag & drop, multi-file, mobile camera) → validated (type/size/magic bytes) → stored privately at `vault/{company}/inbox/{id}/…` → `document_inbox` row.
2. **Read** – `lib/inbox/text.ts` pulls the PDF text layer (digital PDFs).  
   *AI reading (optional, off by default):* `lib/inbox/claude.ts` sends the file to the Anthropic API (`claude-opus-5-5`, structured output, server-side refusal fallback) for OCR + classification of scans/photos. Enabled by an admin in **Settings → Smart Inbox** and only if `ANTHROPIC_API_KEY` is set.
3. **Classify & extract** – `lib/inbox/rules.ts` (local, deterministic): 22 UAE document types (`lib/inbox/catalog.ts`), day-first dates, MRZ, Emirates ID/TRN/licence/visa/policy/plate numbers, issuing authorities, Arabic labels. Every field carries a confidence and source; values are only returned if literally present (never invented).
4. **Match** – `lib/inbox/match.ts`: employees by ID number already on file (99%), employee number, name with Arabic-name aliases (Mohd/Muhammad → Mohammed), phone; company name; customers. Never creates employees/customers.
5. **Duplicates** – same file hash (exact duplicate), same document number (possible duplicate), same type for the same owner with a later expiry (renewal → suggested *new version*).
6. **Decide** – `lib/inbox/decide.ts`: `ready` (≥ 80 % type, ≥ 85 % unique owner, expiry read) or `needs_review` with reasons, or `duplicate`.
7. **Confirm & File** (`/inbox/[id]` or *Confirm all suggested*) → `lib/inbox/file.ts`: creates the document (or a new version + renewal record), **references the same stored file** (no copy), links customers/employees in `document_relationships`, enables the expiry reminder schedule from Settings. One document = one reminder schedule, so renewals never duplicate reminders.
8. **Learn** – when a reviewer files a type into a different category, `document_type_mappings` remembers it for next time (local only).

## Data model (migration `0007_smart_inbox.sql`, additive)
`document_inbox` (review queue = its `status`), `document_extractions` (engine output + text excerpt, never audit-copied), `document_relationships` (one file ↔ many records), `document_type_mappings`; `documents.status` gains `archived`; `documents.source_inbox_id`.

## Security
Unfiled uploads may contain passports/IDs: visible only to the uploader and roles with `employees.view_sensitive` (RLS). Files only via `/api/inbox/[id]/file` (RLS check → 60 s signed URL, `no-store`). No deletes (rejected items stay for audit). Inbox uploads/filing are audit-logged. Reminder messages never contain document numbers or images (unchanged reminder engine).

## Status of the wider request
| Phase | Item | Status |
|---|---|---|
| 1 | Smart Inbox, OCR flow, classification, company & employee auto-filing, confirmation screen, duplicates, versions, automatic reminders, timelines, dashboard widget | **Implemented & tested** |
| 1 | OCR of scanned images/photos | Needs `ANTHROPIC_API_KEY` + admin opt-in (otherwise → manual review) |
| 2 | Accounting/invoice software integration (adapters, sync, customers/quotations/invoices/DNs) | Not started — needs the provider name + API credentials |
| 3 | Project relationships, payments, POs, customer timeline, financial dashboard | Not started (`document_relationships` is ready for it) |
| 4 | AI search, WhatsApp/email/Drive intake | Not started |
