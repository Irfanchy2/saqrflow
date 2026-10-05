-- 0011: pin search_path on the pure number formatter (Supabase advisor 0011).
alter function format_document_number(text, text, int, bigint, text, int) set search_path = public;
