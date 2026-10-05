import { getCtx } from '@/lib/auth'
import { Card, PageHeader } from '@/components/ui/primitives'
import { AskBox } from '@/components/search/ask-box'
import { flat } from '@/lib/queries'

export const metadata = { title: 'AI Search' }
export default async function AssistantPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await getCtx(); const sp = await flat(searchParams)
  return <><PageHeader title="AI Search" sub="Ask about your documents, employees and invoices in plain language. Answers only include records you are allowed to see." />
    <Card className="p-4 sm:p-5"><AskBox initial={sp.q} autoRun={!!sp.q} /></Card>
    <p className="mt-4 text-xs text-muted">Only your question is sent to the AI service (to understand it); your records are searched inside SaqrFlow with your own permissions. Without an AI key, questions are understood by built-in rules.</p></>
}
