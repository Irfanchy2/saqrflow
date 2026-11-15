import 'server-only'
import type { Ctx } from '@/lib/auth'
import { visibleCategories, type SettingsPerms } from './catalog'

export const settingsPerms = (c: Ctx): SettingsPerms => ({ admin: c.can('settings.manage'), users: c.can('users.manage'), audit: c.can('audit.view'), trash: c.can('records.delete') })
/** The settings categories this user may open (backend check: pages and search use only this). */
export const categoriesFor = (c: Ctx) => visibleCategories(settingsPerms(c))
