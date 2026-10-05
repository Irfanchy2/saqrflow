import { Planned } from '@/components/layout/planned'
export const metadata = { title: 'AI Assistant' }
export default function Page() {
  return <Planned title="AI Assistant" phase="Phase 3" summary="OCR document reading and a permission-aware assistant are not implemented yet. When built, extracted values will always be shown with confidence scores and require your verification before saving or activating reminders; the AI will never invent dates or numbers."
    items={['Upload → identify type, holder, dates, reference numbers', 'Match to employee / company records', 'Ask: “Which visas expire next month?”', 'Answers limited to records you may access', 'OCR provider abstraction + LLM classification']}
    meanwhile="Use Global Search (top bar) and the Calendar to find records and deadlines today." />
}
