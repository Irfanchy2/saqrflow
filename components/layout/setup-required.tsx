import { Card } from '@/components/ui/primitives'
export function SetupRequired() {
  return <main className="mx-auto flex min-h-screen max-w-xl items-center p-6"><Card className="p-6">
    <h1 className="text-lg font-semibold">Averiqo needs to be connected to Supabase</h1>
    <p className="mt-2 text-sm text-muted">No Supabase credentials were found, so the app cannot load data. Nothing is mocked.</p>
    <ol className="mt-4 list-decimal space-y-1.5 ps-5 text-sm">
      <li>Create a Supabase project and run the SQL files in <code>supabase/migrations</code> in order.</li>
      <li>Copy <code>.env.example</code> to <code>.env.local</code> and fill in the URL and keys.</li>
      <li>Restart the server. See <code>README.md</code> for the full guide.</li></ol></Card></main>
}
