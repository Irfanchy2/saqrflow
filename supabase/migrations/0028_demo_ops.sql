-- 0028: sample data for the new dashboard panels, stock and bank accounts, in the shared demo company only.
-- demo_seed (0026) is kept as demo_seed_base; demo_seed now runs it and then demo_seed_ops, so the daily demo reset
-- and new demo sign-ups get stock, bank accounts, work orders on the floor, today's visits, a delivery out,
-- a fuller funnel and a team with someone on leave. Real companies are never touched: every function refuses a
-- company that is not flagged is_demo. Nothing is deleted here.

do $$ begin
  if to_regprocedure('demo_seed_base(uuid)') is null then alter function demo_seed(uuid) rename to demo_seed_base; end if;
end $$;

create or replace function demo_seed_ops(p_company uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  uid uuid; t date; prev text := current_setting('request.jwt.claims', true);
  e uuid[]; p1 uuid; p2 uuid; c1 uuid; c2 uuid; c3 uuid; s1 uuid; s3 uuid; enbd uuid; cash uuid; wo1 uuid; it uuid;
begin
  if not exists (select 1 from companies where id = p_company and is_demo) then raise exception 'not a demo company'; end if;
  select id into uid from profiles where company_id = p_company and role = 'company_owner' order by created_at limit 1;
  if uid is null then raise exception 'demo company has no owner'; end if;
  select (now() at time zone timezone)::date into t from companies where id = p_company;
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1')::text, true);

  select array_agg(id order by employee_no) into e from employees where company_id = p_company;
  select id into p1 from projects where company_id = p_company and name = 'Crest Tower podium canopy';
  select id into p2 from projects where company_id = p_company and name = 'Warehouse mezzanine floor';
  select customer_id into c1 from projects where id = p1;
  select customer_id into c2 from projects where id = p2;
  select id into c3 from customers where company_id = p_company order by created_at offset 2 limit 1;
  select id into s1 from suppliers where company_id = p_company and name = 'Coastal Metals Supply';
  select id into s3 from suppliers where company_id = p_company and name = 'Bluewave Paints & Coatings';

  -- bank accounts: the bank already on file becomes the main account, plus petty cash; money in and out posts by itself
  update banks set is_account = true, account_type = 'current', opening_balance = 162400, opening_date = t - 60, is_default = true
    where company_id = p_company and name = 'Emirates NBD' returning id into enbd;
  if enbd is null then
    insert into banks(company_id, name, account_display_name, is_account, opening_balance, opening_date, is_default)
      values (p_company, 'Emirates NBD', 'Current account ••4417', true, 162400, t - 60, true) returning id into enbd;
  end if;
  insert into banks(company_id, name, account_display_name, is_account, account_type, opening_balance, opening_date)
    values (p_company, 'Petty cash', 'Al Quoz office', true, 'cash', 4500, t - 60) returning id into cash;
  insert into banks(company_id, name, account_display_name, is_account, account_type, opening_balance, opening_date)
    values (p_company, 'Mashreq', 'Savings ••0921', true, 'savings', 58000, t - 60);
  update payments set deposit_bank_id = enbd where company_id = p_company;
  update project_expenses set paid_from_bank_id = case when payment_method = 'cash' then cash else enbd end
    where company_id = p_company and payment_method in ('bank_transfer', 'cash', 'cheque');
  insert into bank_transactions(company_id, bank_id, kind, amount, txn_date, description, created_by) values
    (p_company, enbd, 'fee', -52.5, t - 22, 'Monthly account fee', uid),
    (p_company, enbd, 'transfer_out', -3000, t - 6, 'Top-up of petty cash', uid),
    (p_company, cash, 'transfer_in', 3000, t - 6, 'Top-up from Emirates NBD', uid);

  -- stock: materials in the yard, two of them below their reorder level
  insert into stock_items(company_id, sku, name, category, unit, location, reorder_level, reorder_qty, supplier_id, created_by) values
    (p_company, 'MSP-06', 'MS plate 6 mm 1250×2500', 'Plates', 'Sheet', 'Rack A', 10, 30, s1, uid) returning id into it;
  insert into stock_movements(company_id, item_id, kind, qty, unit_cost, moved_on, notes, created_by) values (p_company, it, 'opening', 24, 410, t - 40, 'Opening stock', uid);
  insert into stock_movements(company_id, item_id, kind, qty, moved_on, project_id, created_by) values (p_company, it, 'issue', -9, t - 18, p1, uid), (p_company, it, 'issue', -8, t - 4, p2, uid);
  insert into stock_items(company_id, sku, name, category, unit, location, reorder_level, reorder_qty, supplier_id, created_by) values
    (p_company, 'SHS-100', 'SHS 100×100×4 mm, 6 m', 'Hollow sections', 'Length', 'Yard bay 2', 20, 60, s1, uid) returning id into it;
  insert into stock_movements(company_id, item_id, kind, qty, unit_cost, moved_on, notes, created_by) values (p_company, it, 'opening', 80, 186, t - 40, 'Opening stock', uid);
  insert into stock_movements(company_id, item_id, kind, qty, unit_cost, moved_on, supplier_id, supplier_name, reference, created_by) values (p_company, it, 'receipt', 40, 192, t - 12, s1, 'Coastal Metals Supply', 'CMS-INV-22841', uid);
  insert into stock_movements(company_id, item_id, kind, qty, moved_on, project_id, created_by) values (p_company, it, 'issue', -52, t - 9, p1, uid);
  insert into stock_items(company_id, sku, name, category, unit, location, reorder_level, reorder_qty, supplier_id, created_by) values
    (p_company, 'E7018-32', 'Welding rods E7018 3.2 mm', 'Consumables', 'Box', 'Store room', 12, 40, s1, uid) returning id into it;
  insert into stock_movements(company_id, item_id, kind, qty, unit_cost, moved_on, notes, created_by) values (p_company, it, 'opening', 30, 64, t - 40, 'Opening stock', uid);
  insert into stock_movements(company_id, item_id, kind, qty, moved_on, project_id, created_by) values (p_company, it, 'issue', -14, t - 15, p1, uid), (p_company, it, 'issue', -9, t - 2, p2, uid);
  insert into stock_items(company_id, sku, name, category, unit, location, reorder_level, reorder_qty, supplier_id, created_by) values
    (p_company, 'ZP-20', 'Zinc-rich primer, 20 L', 'Paint & coatings', 'Pail', 'Paint store', 4, 10, s3, uid) returning id into it;
  insert into stock_movements(company_id, item_id, kind, qty, unit_cost, moved_on, supplier_id, supplier_name, reference, created_by) values (p_company, it, 'receipt', 12, 335, t - 25, s3, 'Bluewave Paints & Coatings', 'BW-55120', uid);
  insert into stock_movements(company_id, item_id, kind, qty, moved_on, project_id, created_by) values (p_company, it, 'issue', -5, t - 6, p1, uid);
  insert into stock_items(company_id, sku, name, category, unit, location, reorder_level, reorder_qty, created_by) values
    (p_company, 'GD-115', 'Grinding discs 115 mm', 'Consumables', 'Box', 'Store room', 6, 20, uid) returning id into it;
  insert into stock_movements(company_id, item_id, kind, qty, unit_cost, moved_on, notes, created_by) values (p_company, it, 'opening', 18, 48, t - 40, 'Opening stock', uid);
  insert into stock_movements(company_id, item_id, kind, qty, moved_on, notes, created_by) values (p_company, it, 'adjustment', -1, t - 3, 'Stock take: one box damaged by water', uid);

  -- work orders: crews on the open ones, and finished ones (mostly on time) for the completion rate
  select id into wo1 from work_orders where company_id = p_company and status = 'in_fabrication' order by created_at limit 1;
  if wo1 is not null and array_length(e, 1) >= 5 then
    insert into work_order_members(company_id, work_order_id, employee_id, role) values (p_company, wo1, e[1], 'Supervisor'), (p_company, wo1, e[2], 'Welder'), (p_company, wo1, e[5], 'Fabricator');
  end if;
  insert into work_orders(company_id, number, title, customer_id, project_id, scope, site_location, start_date, target_date, manager_id, priority, status, created_by) values
    (p_company, issue_document_number(p_company, 'work_order'), 'Podium column base plates', c1, p1, 'Drill and fit 14 base plates with anchor templates.', 'Dubai Marina', t - 6, t, uid, 'urgent', 'installation', uid),
    (p_company, issue_document_number(p_company, 'work_order'), 'Plant room gratings: second batch', c3, null, 'Cut, band and galvanise 22 grating panels.', 'Al Quoz workshop', t - 3, t + 6, uid, 'normal', 'ready_for_site', uid);
  insert into work_orders(company_id, number, title, customer_id, project_id, scope, start_date, target_date, manager_id, priority, status, completed_at, created_by) values
    (p_company, issue_document_number(p_company, 'work_order'), 'Canopy columns: fabricate', c1, p1, '14 tapered columns.', t - 50, t - 20, uid, 'high', 'completed', (t - 21)::timestamp + interval '15 hours', uid),
    (p_company, issue_document_number(p_company, 'work_order'), 'Mezzanine beams: cut and drill', c2, p2, 'UB beams to drawing M-02.', t - 26, t - 12, uid, 'normal', 'completed', (t - 12)::timestamp + interval '10 hours', uid),
    (p_company, issue_document_number(p_company, 'work_order'), 'Staircase stringers', c2, p2, 'Two flights, 17 risers each.', t - 18, t - 9, uid, 'normal', 'completed', (t - 7)::timestamp + interval '11 hours', uid),
    (p_company, issue_document_number(p_company, 'work_order'), 'Handrail set for loading bay', c2, p2, '38 m of handrail with kick plate.', t - 12, t - 4, uid, 'normal', 'completed', (t - 5)::timestamp + interval '14 hours', uid),
    (p_company, issue_document_number(p_company, 'work_order'), 'Gate repair: Musaffah yard', c3, null, 'Re-weld hinge pins, replace the drop bolt.', t - 4, t - 2, uid, 'low', 'completed', (t - 2)::timestamp + interval '9 hours', uid);

  -- out today: two site visits with times, and a delivery note on its way
  insert into site_visits(company_id, number, customer_id, project_id, location, scheduled_date, scheduled_time, employee_id, contact_person, requirements, status, created_by) values
    (p_company, issue_document_number(p_company, 'site_visit'), c1, p1, 'Dubai Marina', t, '09:30', e[3], 'Faisal Rahman', 'Check rafter connections before the soffit goes up.', 'scheduled', uid),
    (p_company, issue_document_number(p_company, 'site_visit'), c2, p2, 'Al Quoz Industrial 3', t, '14:00', e[1], 'Priya Nair', 'Set out the stair landing and mark anchor points.', 'scheduled', uid);
  perform demo_doc(p_company, uid, 'delivery_note', c2, p2, t - 1, null, 'sent', 'Mezzanine beams, first load',
    '[{"d":"UB 254×146×31 beam, cut and drilled to M-02","q":12,"u":"Nos","p":0},{"d":"Splice plates with M20 bolt sets","q":12,"u":"Set","p":0}]'::jsonb);

  -- a fuller funnel
  insert into leads(company_id, number, company_name, contact_person, location, source, service, estimated_value, salesperson_id, next_followup, stage, created_by) values
    (p_company, issue_document_number(p_company, 'lead'), 'Desert Bloom Farms', 'Khalid Al Nuaimi', 'Al Ain', 'cold_call', 'Livestock shade and fencing', 64000, uid, t + 3, 'contacted', uid),
    (p_company, issue_document_number(p_company, 'lead'), 'Meridian Mall', 'Lina Haddad', 'Al Qusais, Dubai', 'website', 'Car park canopies', 212000, uid, t + 5, 'site_visit_completed', uid),
    (p_company, issue_document_number(p_company, 'lead'), 'Alpine Logistics', 'Ravi Shankar', 'Jebel Ali', 'referral', 'Racking platforms', 88000, uid, t + 2, 'quotation_preparation', uid),
    (p_company, issue_document_number(p_company, 'lead'), 'Coral Heights HOA', 'Nadia Karim', 'JVC, Dubai', 'existing_customer', 'Balcony railings, block C', 47500, uid, t + 1, 'follow_up', uid),
    (p_company, issue_document_number(p_company, 'lead'), 'Gulfway Petroleum', 'Hassan Ali', 'Mussafah', 'tender', 'Pipe racks and walkways', 305000, uid, t + 7, 'new', uid);

  -- one of the team on leave today
  if array_length(e, 1) >= 6 then
    insert into leave_records(company_id, employee_id, leave_type, start_date, end_date, status, notes) values (p_company, e[6], 'annual', t - 6, t + 9, 'approved', 'Home leave');
  end if;

  perform set_config('request.jwt.claims', coalesce(prev, ''), true);
end $$;

create or replace function demo_seed(p_company uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform demo_seed_base(p_company);
  perform demo_seed_ops(p_company);
end $$;

revoke all on function demo_seed(uuid), demo_seed_base(uuid), demo_seed_ops(uuid) from public, anon, authenticated;
grant execute on function demo_seed(uuid), demo_seed_base(uuid), demo_seed_ops(uuid) to service_role;
