import { getCtx } from '@/lib/auth'
import { SavedViewsMenu } from './saved-views-menu'

/** "Views" menu for a list page: saved filter combinations, personal or shared with the team. */
export async function SavedViews({ page }: { page: string }) {
  const c = await getCtx()
  const { data } = await c.supabase.from('saved_views').select('id,name,query,shared,user_id').eq('page', page).order('name')
  return <SavedViewsMenu page={page} views={(data ?? []).map(v => ({ ...v, own: v.user_id === c.userId }))} canShare={c.can('records.edit')} canRemoveShared={c.can('settings.manage')} />
}
