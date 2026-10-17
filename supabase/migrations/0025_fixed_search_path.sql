-- 0025 pins the search path of the last function without one (Supabase advisor: function_search_path_mutable).
-- custom_entity_perm only maps an entity name to a permission name and reads no tables, so an empty search path is
-- safe; its behaviour is unchanged. No data is touched.
alter function custom_entity_perm(text) set search_path = '';
