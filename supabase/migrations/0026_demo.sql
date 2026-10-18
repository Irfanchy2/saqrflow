-- Shared demo account: an isolated company flagged is_demo, filled with invented sample data and reset daily.
-- Additive only: one column with a false default (every existing company stays a normal company) and three
-- service-role functions. Each function refuses to touch any company that is not flagged is_demo.

alter table companies add column if not exists is_demo boolean not null default false;

-- Wipe one demo company's records (never the company row, its users, sign-in history or sessions).
-- Deletes table by table: triggers write audit/event rows while it runs, so it repeats until nothing is left.
create or replace function demo_wipe(p_company uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t text; n bigint; left_over bigint; pass int := 0; err text;
  keep constant text[] := array['profiles','login_events','user_sessions','security_events','audit_logs'];
begin
  if not exists (select 1 from companies where id = p_company and is_demo) then raise exception 'not a demo company'; end if;
  loop
    pass := pass + 1; left_over := 0;
    for t in select c.table_name from information_schema.columns c join information_schema.tables x using (table_schema, table_name)
             where c.table_schema = 'public' and c.column_name = 'company_id' and x.table_type = 'BASE TABLE' and c.table_name <> all (keep)
             order by 1 loop
      begin
        execute format('delete from %I where company_id = $1', t) using p_company;
      exception when others then err := t || ': ' || sqlerrm;   -- a child row is still in the way; a later pass gets it
      end;
      execute format('select count(*) from %I where company_id = $1', t) using p_company into n;
      left_over := left_over + n;
    end loop;
    exit when left_over = 0;
    if pass >= 12 then raise exception 'demo wipe could not finish (% rows left, last error %)', left_over, err; end if;
  end loop;
  delete from audit_logs where company_id = p_company;
end $$;

-- Fill a demo company with invented sample data, dated around today so it always looks current.
create or replace function demo_seed(p_company uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  uid uuid; t date; prev text := current_setting('request.jwt.claims', true);
  c1 uuid; c2 uuid; c3 uuid; c4 uuid; c5 uuid; c6 uuid; s1 uuid; s2 uuid; s3 uuid;
  p1 uuid; p2 uuid; p3 uuid; p4 uuid; e1 uuid; e2 uuid; e3 uuid; e4 uuid; e5 uuid; e6 uuid;
  q1 uuid; q2 uuid; i1 uuid; i2 uuid; i3 uuid; i4 uuid; l1 uuid; l2 uuid; l3 uuid; l4 uuid; a1 uuid; a2 uuid;
  cat_tl uuid; cat_vat uuid; cat_ins uuid; cat_pp uuid; cat_eid uuid; cat_visa uuid;
begin
  if not exists (select 1 from companies where id = p_company and is_demo) then raise exception 'not a demo company'; end if;
  select id into uid from profiles where company_id = p_company and role = 'company_owner' order by created_at limit 1;
  if uid is null then raise exception 'demo company has no owner'; end if;
  select (now() at time zone timezone)::date into t from companies where id = p_company;
  -- act as the demo owner, so created_by, audit rows and numbering behave as they do in the app
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1')::text, true);

  -- what a new company gets on sign-up (wiped with everything else)
  insert into document_number_formats(company_id, doc_type, prefix, number_separator, fixed_digits, seq_pad, next_seq, year_separator, year_format, include_year) values
    (p_company, 'quotation', 'AS', '-', '', 6, 2600, '/', 'yyyy', true),
    (p_company, 'invoice', 'INV', '-', '', 1, 610, '/', 'yyyy', false),
    (p_company, 'delivery_note', 'DL', '-', '', 1, 1300, '/', 'yyyy', false)
  on conflict do nothing;
  insert into document_categories(company_id, scope, name, is_system)
  select p_company, 'company', n, true from unnest(array['Trade License','Establishment Card','Chamber of Commerce Certificate','Corporate Tax Registration',
    'VAT Registration Certificate','Company Insurance','Office & Workshop Tenancy','Ejari / Tenancy Contract','Government Permit','Municipality Approval',
    'Bank Letter','Company Contract','Supplier Agreement','Certificate / Approval','Other']) n;
  insert into document_categories(company_id, scope, name, is_system)
  select p_company, 'employee', n, true from unnest(array['Passport','Emirates ID','Residence Visa','Work Permit','Labour Contract','Medical Insurance',
    'Safety / Training Certificate','Other Certificate']) n;
  insert into notification_recipients(company_id, user_id, name, channels, receives_digest)
  select p_company, uid, full_name, array['in_app'], true from profiles where id = uid;

  select id into cat_tl from document_categories where company_id = p_company and name = 'Trade License';
  select id into cat_vat from document_categories where company_id = p_company and name = 'VAT Registration Certificate';
  select id into cat_ins from document_categories where company_id = p_company and name = 'Company Insurance';
  select id into cat_pp from document_categories where company_id = p_company and name = 'Passport';
  select id into cat_eid from document_categories where company_id = p_company and name = 'Emirates ID';
  select id into cat_visa from document_categories where company_id = p_company and name = 'Residence Visa';

  -- customers and suppliers (invented companies and people)
  insert into customers(company_id, name, contact_person, phone, email, trn, address, credit_days, created_by) values
    (p_company, 'Marina Crest Developments LLC', 'Faisal Rahman', '+971 50 418 2276', 'faisal@marinacrest.example', '100384726500003', 'Office 1204, Crest Tower, Dubai Marina, Dubai', 30, uid) returning id into c1;
  insert into customers(company_id, name, contact_person, phone, email, trn, address, credit_days, created_by) values
    (p_company, 'Gulf Horizon Contracting', 'Priya Nair', '+971 55 903 1148', 'priya@gulfhorizon.example', '100519384200003', 'Warehouse 7, Al Quoz Industrial 3, Dubai', 45, uid) returning id into c2;
  insert into customers(company_id, name, contact_person, phone, email, address, credit_days, created_by) values
    (p_company, 'Al Noor Facilities Management', 'Omar Haddad', '+971 52 670 3391', 'omar@alnoorfm.example', 'Plot 22, Musaffah M-14, Abu Dhabi', 30, uid) returning id into c3;
  insert into customers(company_id, name, contact_person, phone, email, address, credit_days, created_by) values
    (p_company, 'Desert Rose Interiors', 'Lina Kassab', '+971 56 214 8805', 'lina@desertrose.example', 'Shop 3, Al Wasl Road, Jumeirah 2, Dubai', 15, uid) returning id into c4;
  insert into customers(company_id, name, contact_person, phone, email, trn, address, credit_days, created_by) values
    (p_company, 'Sapphire Bay Hotels', 'Arjun Menon', '+971 50 337 9062', 'arjun@sapphirebay.example', '100277461900003', 'Sapphire Bay Resort, Al Marjan Island, Ras Al Khaimah', 60, uid) returning id into c5;
  insert into customers(company_id, name, contact_person, phone, email, address, credit_days, created_by) values
    (p_company, 'Ridgeline Logistics FZE', 'Sara Al Hashmi', '+971 54 781 6620', 'sara@ridgeline.example', 'Unit B-19, SAIF Zone, Sharjah', 30, uid) returning id into c6;

  insert into suppliers(company_id, name, contact_person, phone, email, address) values
    (p_company, 'Coastal Metals Supply', 'Ravi Shankar', '+971 6 543 2190', 'sales@coastalmetals.example', 'Industrial Area 13, Sharjah') returning id into s1;
  insert into suppliers(company_id, name, contact_person, phone, email, address) values
    (p_company, 'Falcon Fasteners Trading', 'Hassan Qureshi', '+971 4 338 7712', 'orders@falconfasteners.example', 'Deira, Dubai') returning id into s2;
  insert into suppliers(company_id, name, contact_person, phone, email, address) values
    (p_company, 'Bluewave Paints & Coatings', 'Nadia Farouk', '+971 6 742 0058', 'info@bluewavecoatings.example', 'Ajman Industrial 2, Ajman') returning id into s3;

  -- team
  insert into employees(company_id, employee_no, full_name, nationality, department, designation, phone, joining_date, status, work_location) values
    (p_company, 'EMP-001', 'Karthik Raman', 'Indian', 'Production', 'Workshop Supervisor', '+971 50 112 4087', t - 1460, 'active', 'Al Quoz workshop') returning id into e1;
  insert into employees(company_id, employee_no, full_name, nationality, department, designation, phone, joining_date, status, work_location) values
    (p_company, 'EMP-002', 'Imran Siddiqui', 'Pakistani', 'Production', 'Senior Welder', '+971 55 208 3316', t - 1100, 'active', 'Al Quoz workshop') returning id into e2;
  insert into employees(company_id, employee_no, full_name, nationality, department, designation, phone, joining_date, status, work_location) values
    (p_company, 'EMP-003', 'Joel Fernandes', 'Indian', 'Site', 'Installation Foreman', '+971 52 330 9145', t - 900, 'active', 'Sites') returning id into e3;
  insert into employees(company_id, employee_no, full_name, nationality, department, designation, phone, joining_date, status, work_location) values
    (p_company, 'EMP-004', 'Mariam Youssef', 'Egyptian', 'Admin', 'Accounts Officer', '+971 56 441 7720', t - 640, 'active', 'Head office') returning id into e4;
  insert into employees(company_id, employee_no, full_name, nationality, department, designation, phone, joining_date, status, work_location) values
    (p_company, 'EMP-005', 'Rohan Thapa', 'Nepali', 'Production', 'Fabricator', '+971 54 902 6631', t - 75, 'probation', 'Al Quoz workshop') returning id into e5;
  insert into employees(company_id, employee_no, full_name, nationality, department, designation, phone, joining_date, status, work_location) values
    (p_company, 'EMP-006', 'Daniel Okafor', 'Nigerian', 'Site', 'Rigger', '+971 50 763 2208', t - 420, 'on_leave', 'Sites') returning id into e6;

  -- projects
  insert into projects(company_id, name, code, customer_id, location, contract_value, start_date, expected_completion, manager_id, status, description, fabrication_progress, site_progress, inspection_progress) values
    (p_company, 'Crest Tower podium canopy', issue_document_number(p_company, 'project'), c1, 'Dubai Marina', 486000, t - 70, t + 40, uid, 'active',
     'Steel canopy over the podium drop-off: 14 tapered columns, curved rafters, aluminium soffit.', 80, 45, 20) returning id into p1;
  insert into projects(company_id, name, code, customer_id, location, contract_value, start_date, expected_completion, manager_id, status, description, fabrication_progress, site_progress, inspection_progress) values
    (p_company, 'Warehouse mezzanine floor', issue_document_number(p_company, 'project'), c2, 'Al Quoz Industrial 3', 212500, t - 35, t + 25, uid, 'active',
     '420 m² mezzanine with staircase, handrails and checker-plate deck.', 55, 10, 0) returning id into p2;
  insert into projects(company_id, name, code, customer_id, location, contract_value, start_date, expected_completion, manager_id, status, description, fabrication_progress, site_progress, inspection_progress) values
    (p_company, 'Resort pool pergolas', issue_document_number(p_company, 'project'), c5, 'Al Marjan Island', 138000, t + 12, t + 75, uid, 'planning',
     'Six powder-coated pergolas with louvred shade panels.', 0, 0, 0) returning id into p3;
  insert into projects(company_id, name, code, customer_id, location, contract_value, start_date, expected_completion, manager_id, status, description, fabrication_progress, site_progress, inspection_progress) values
    (p_company, 'Musaffah plant room gratings', issue_document_number(p_company, 'project'), c3, 'Musaffah M-14', 64800, t - 120, t - 30, uid, 'completed',
     'Galvanised gratings, ladders and safety cages for the plant room.', 100, 100, 100) returning id into p4;

  insert into project_milestones(company_id, project_id, title, due_date, done, done_at) values
    (p_company, p1, 'Shop drawings approved', t - 55, true, now() - interval '55 days'),
    (p_company, p1, 'Columns erected', t - 6, true, now() - interval '6 days'),
    (p_company, p1, 'Rafters and soffit installed', t + 18, false, null),
    (p_company, p2, 'Deck plates delivered', t + 9, false, null),
    (p_company, p3, 'Design sign-off', t + 10, false, null);

  insert into project_expenses(company_id, project_id, spent_on, category, supplier_id, supplier_name, description, amount, vat_amount, payment_method, created_by) values
    (p_company, p1, t - 52, 'material', s1, 'Coastal Metals Supply', 'Hollow sections 200×200×8, 36 lengths', 58400, 2920, 'bank_transfer', uid),
    (p_company, p1, t - 20, 'subcontract', null, 'Precision Crane Hire', '50 t mobile crane, 3 days', 13500, 675, 'cheque', uid),
    (p_company, p1, t - 4, 'material', s3, 'Bluewave Paints & Coatings', 'Zinc primer and polyurethane topcoat', 6240, 312, 'credit', uid),
    (p_company, p2, t - 28, 'material', s1, 'Coastal Metals Supply', 'UB beams and checker plate', 41800, 2090, 'bank_transfer', uid),
    (p_company, p2, t - 3, 'transport', null, 'Speedline Transport', 'Low-bed trailer, workshop to site', 1850, 92.5, 'cash', uid),
    (p_company, p4, t - 95, 'material', s2, 'Falcon Fasteners Trading', 'Grating clips and anchor bolts', 2380, 119, 'cash', uid);

  -- price list
  insert into catalog_items(company_id, name, description, unit, rate, vat_category, category, created_by) values
    (p_company, 'Structural steel fabrication', 'Cutting, welding and assembly of structural members', 'TON', 7800, 'standard', 'Fabrication', uid),
    (p_company, 'Hot-dip galvanising', 'Galvanising to ISO 1461', 'KG', 3.4, 'standard', 'Finishing', uid),
    (p_company, 'Powder coating', 'Polyester powder coat, RAL colour of choice', 'SQM', 38, 'standard', 'Finishing', uid),
    (p_company, 'Stainless steel handrail', 'SS 316 tube handrail with glass clamps', 'LM', 640, 'standard', 'Architectural', uid),
    (p_company, 'Checker plate flooring', '6 mm checker plate, fixed on site', 'SQM', 295, 'standard', 'Fabrication', uid),
    (p_company, 'Site installation crew', 'Foreman plus four fitters, per day', 'DAYS', 3200, 'standard', 'Installation', uid);

  -- sales documents (totals worked out from the lines, 5% VAT)
  q1 := demo_doc(p_company, uid, 'quotation', c5, p3, t - 9, null, 'sent', 'Supply and installation of six pool pergolas',
    '[{"d":"Pergola frames, 4.2 × 6.0 m, galvanised and powder coated","q":6,"u":"Nos","p":14800},
      {"d":"Aluminium louvred shade panels","q":151.2,"u":"SQM","p":185},{"d":"Installation, scaffolding and cleaning","q":1,"u":"L.S","p":9500}]');
  q2 := demo_doc(p_company, uid, 'quotation', c4, null, t - 3, null, 'draft', 'Feature staircase with glass balustrade',
    '[{"d":"Mild steel spine staircase, 18 treads","q":1,"u":"L.S","p":38500},{"d":"Stainless steel handrail","q":14.5,"u":"LM","p":640}]');
  perform demo_doc(p_company, uid, 'quotation', c6, null, t - 40, null, 'accepted', 'Loading bay dock shelters and bollards',
    '[{"d":"Steel dock shelter frames","q":4,"u":"Nos","p":6200},{"d":"Concrete-filled bollards, 1.2 m","q":16,"u":"Nos","p":480}]');

  i1 := demo_doc(p_company, uid, 'invoice', c3, p4, t - 60, t - 30, 'sent', 'Plant room gratings: final invoice',
    '[{"d":"Galvanised steel gratings 30×5 mm","q":96,"u":"SQM","p":420},{"d":"Cat ladders with safety cages","q":3,"u":"Nos","p":4600},{"d":"Installation","q":1,"u":"L.S","p":7280}]');
  i2 := demo_doc(p_company, uid, 'invoice', c1, p1, t - 18, t + 12, 'sent', 'Canopy: progress claim 1 (columns)',
    '[{"d":"Tapered steel columns, fabricated and coated","q":14,"u":"Nos","p":9850},{"d":"Anchor bolt sets and base plates","q":14,"u":"SET","p":720}]');
  i3 := demo_doc(p_company, uid, 'invoice', c2, p2, t - 50, t - 12, 'sent', 'Mezzanine: advance on steel',
    '[{"d":"Advance payment, 30% of contract","q":1,"u":"L.S","p":63750}]');
  i4 := demo_doc(p_company, uid, 'invoice', c6, null, t - 6, t + 24, 'sent', 'Dock shelters and bollards',
    '[{"d":"Steel dock shelter frames","q":4,"u":"Nos","p":6200},{"d":"Concrete-filled bollards, 1.2 m","q":16,"u":"Nos","p":480},{"d":"Delivery and fixing","q":1,"u":"L.S","p":2600}]');
  perform demo_doc(p_company, uid, 'invoice', c4, null, t - 1, t + 14, 'draft', 'Reception desk steel frame',
    '[{"d":"Blackened steel desk frame","q":1,"u":"L.S","p":12400},{"d":"Powder coating","q":9.5,"u":"SQM","p":38}]');
  perform demo_doc(p_company, uid, 'delivery_note', c3, p4, t - 62, null, 'delivered', 'Plant room gratings',
    '[{"d":"Galvanised steel gratings 30×5 mm","q":96,"u":"SQM","p":0},{"d":"Cat ladders with safety cages","q":3,"u":"Nos","p":0}]');

  -- money received: i1 in full, i2 in part, i3 overdue with nothing paid, i4 not yet due
  insert into payments(company_id, invoice_id, amount, paid_on, method, reference, bank_name, created_by)
  select p_company, i1, total, t - 28, 'bank_transfer', 'TT 88231904', 'Emirates NBD', uid from invoices where id = i1;
  insert into payments(company_id, invoice_id, amount, paid_on, method, reference, bank_name, created_by) values
    (p_company, i2, 75000, t - 10, 'cheque', 'CHQ 004512', 'Mashreq', uid);

  insert into banks(company_id, name, account_display_name) values (p_company, 'Emirates NBD', 'Current account ••4417');
  insert into cheques(company_id, cheque_no, direction, kind, party_type, customer_id, party_name, bank_name, amount, issue_date, cheque_date, purpose, invoice_id, status, created_by) values
    (p_company, '004518', 'incoming', 'pdc', 'customer', c1, 'Marina Crest Developments LLC', 'Mashreq', 40000, t - 10, t + 20, 'Canopy progress claim 1, balance', i2, 'received', uid);
  insert into cheques(company_id, cheque_no, direction, kind, party_type, supplier_id, party_name, bank_name, amount, issue_date, cheque_date, purpose, status, created_by) values
    (p_company, '100273', 'outgoing', 'pdc', 'supplier', s1, 'Coastal Metals Supply', 'Emirates NBD', 43890, t - 5, t + 25, 'UB beams and checker plate', 'issued', uid);

  -- company and staff documents, some due for renewal soon
  insert into documents(company_id, owner_type, category_id, name, reference_no, issuing_authority, issue_date, expiry_date, status, created_by) values
    (p_company, 'company', cat_tl, 'Trade License', 'DED-874512', 'Department of Economy and Tourism', t - 345, t + 20, 'active', uid),
    (p_company, 'company', cat_vat, 'VAT Registration Certificate', '100492817300003', 'Federal Tax Authority', t - 900, null, 'active', uid),
    (p_company, 'company', cat_ins, 'Workmen compensation insurance', 'WC-2219-0457', 'Oasis General Insurance', t - 300, t + 65, 'active', uid);
  insert into documents(company_id, owner_type, owner_id, category_id, name, reference_no, issue_date, expiry_date, status, created_by) values
    (p_company, 'employee', e1, cat_visa, 'Residence visa: Karthik Raman', '201/2023/7/104552', t - 700, t + 30, 'active', uid),
    (p_company, 'employee', e2, cat_eid, 'Emirates ID: Imran Siddiqui', '784-1988-4417203-6', t - 720, t + 8, 'renewal_in_progress', uid),
    (p_company, 'employee', e3, cat_pp, 'Passport: Joel Fernandes', 'Z7740318', t - 1800, t + 1850, 'active', uid),
    (p_company, 'employee', e4, cat_eid, 'Emirates ID: Mariam Youssef', '784-1992-6630184-2', t - 400, t + 330, 'active', uid);

  -- fleet and equipment
  insert into assets(company_id, kind, name, asset_code, plate_or_serial, plate_emirate, vehicle_type, make, model, model_year, assigned_to, registration_expiry, insurance_expiry,
    next_service_date, current_mileage, status, condition, created_by) values
    (p_company, 'vehicle', 'Pickup: site crew', 'VH-01', 'Dubai K 48213', 'Dubai', 'Pickup', 'Toyota', 'Hilux', 2021, e3, t + 12, t + 12, t + 5, 86420, 'assigned', 'good', uid) returning id into a1;
  insert into assets(company_id, kind, name, asset_code, serial_no, make, model, model_year, location, warranty_expiry, next_service_date, status, condition, created_by) values
    (p_company, 'equipment', 'MIG welding machine', 'EQ-04', 'LN-500-22817', 'Lincoln', 'Power Wave 500', 2022, 'Al Quoz workshop', t + 160, t + 21, 'active', 'good', uid) returning id into a2;
  insert into assets(company_id, kind, name, asset_code, serial_no, make, model, model_year, location, next_service_date, status, condition, created_by) values
    (p_company, 'machinery', 'Forklift 3 t', 'MC-02', 'FD30-77104', 'Komatsu', 'FD30', 2019, 'Al Quoz workshop', t - 3, 'in_maintenance', 'fair', uid);

  -- sales pipeline
  insert into leads(company_id, number, company_name, contact_person, phone, email, location, source, service, estimated_value, probability, expected_close, salesperson_id, next_followup, stage, created_by) values
    (p_company, issue_document_number(p_company, 'lead'), 'Palm Grove Villas', 'Tariq Mansour', '+971 50 664 1932', 'tariq@palmgrove.example', 'Arabian Ranches 3, Dubai', 'website',
     'Villa gates and boundary railings', 96000, 30, t + 30, uid, t + 2, 'site_visit_required', uid) returning id into l1;
  insert into leads(company_id, number, company_name, contact_person, phone, location, source, service, estimated_value, probability, expected_close, salesperson_id, next_followup, stage, created_by) values
    (p_company, issue_document_number(p_company, 'lead'), 'Northstar Schools Group', 'Helen Mathews', '+971 55 120 4478', 'Al Barsha, Dubai', 'referral',
     'Shade structures for two playgrounds', 154000, 55, t + 21, uid, t + 1, 'negotiation', uid) returning id into l2;
  insert into leads(company_id, number, company_name, contact_person, phone, location, source, service, estimated_value, probability, salesperson_id, next_followup, stage, created_by) values
    (p_company, issue_document_number(p_company, 'lead'), 'Sapphire Bay Hotels', 'Arjun Menon', '+971 50 337 9062', 'Al Marjan Island', 'existing_customer',
     'Pool pergolas', 138000, 70, uid, t + 4, 'quotation_sent', uid) returning id into l3;
  insert into leads(company_id, number, company_name, contact_person, phone, location, source, service, estimated_value, probability, salesperson_id, stage, created_by) values
    (p_company, issue_document_number(p_company, 'lead'), 'Bright Path Nurseries', 'Fatima Zahra', '+971 52 908 3317', 'Mirdif, Dubai', 'instagram',
     'Covered walkway', 38000, 10, uid, 'new', uid) returning id into l4;
  insert into leads(company_id, number, company_name, contact_person, phone, location, source, service, estimated_value, probability, salesperson_id, stage, customer_id, won_at, created_by) values
    (p_company, issue_document_number(p_company, 'lead'), 'Ridgeline Logistics FZE', 'Sara Al Hashmi', '+971 54 781 6620', 'SAIF Zone, Sharjah', 'referral',
     'Dock shelters and bollards', 34104, 100, uid, 'won', c6, now() - interval '38 days', uid);
  insert into leads(company_id, number, company_name, contact_person, phone, location, source, service, estimated_value, probability, salesperson_id, stage, lost_reason, lost_note, lost_at, created_by) values
    (p_company, issue_document_number(p_company, 'lead'), 'Harbourview Cafe', 'Yusuf Demir', '+971 55 470 2291', 'JBR, Dubai', 'google',
     'Outdoor seating canopy', 27500, 0, uid, 'lost', 'price', 'Went with an aluminium supplier.', now() - interval '15 days', uid);
  update leads set customer_id = c5 where id = l3;
  update invoices set lead_id = l3 where id = q1;
  insert into lead_activities(company_id, lead_id, kind, body, user_id) values
    (p_company, l1, 'call', 'Wants sliding gates for 12 villas. Site visit booked.', uid),
    (p_company, l2, 'meeting', 'Met the facilities team. They asked for a phased price, one playground first.', uid),
    (p_company, l3, 'quotation', 'Quotation sent for six pergolas.', uid),
    (p_company, l4, 'whatsapp', 'Enquiry from Instagram. Asked for photos of past walkways.', uid);

  insert into site_visits(company_id, number, lead_id, location, scheduled_date, scheduled_time, employee_id, contact_person, contact_phone, requirements, status, created_by) values
    (p_company, issue_document_number(p_company, 'site_visit'), l1, 'Arabian Ranches 3, Dubai', t + 2, '10:30', e3, 'Tariq Mansour', '+971 50 664 1932',
     'Measure 12 gate openings and the boundary run.', 'scheduled', uid);
  insert into site_visits(company_id, number, customer_id, project_id, location, scheduled_date, scheduled_time, employee_id, contact_person, measurements, recommendations, status, completed_at, created_by) values
    (p_company, issue_document_number(p_company, 'site_visit'), c1, p1, 'Dubai Marina', t - 8, '08:00', e3, 'Faisal Rahman',
     'Column bases checked: all within 3 mm.', 'Start rafters once the soffit supports arrive.', 'completed', now() - interval '8 days', uid);

  insert into work_orders(company_id, number, title, customer_id, project_id, scope, site_location, start_date, target_date, manager_id, priority, status, created_by) values
    (p_company, issue_document_number(p_company, 'work_order'), 'Canopy rafters: fabricate and coat', c1, p1, 'Fabricate 14 curved rafters, blast, prime and topcoat.', 'Al Quoz workshop', t - 10, t + 8, uid, 'high', 'in_fabrication', uid),
    (p_company, issue_document_number(p_company, 'work_order'), 'Mezzanine deck installation', c2, p2, 'Erect beams, fix checker plate, install stair and handrails.', 'Al Quoz Industrial 3', t + 5, t + 22, uid, 'normal', 'scheduled', uid);

  insert into tasks(company_id, title, description, owner_id, employee_id, due_date, priority, status, related_type, related_id, project_id, created_by) values
    (p_company, 'Chase payment for the mezzanine advance', 'Invoice is 12 days overdue. Call Priya, then send a statement.', uid, e4, t, 'high', 'todo', 'invoice', i3, p2, uid),
    (p_company, 'Book third-party weld inspection', null, uid, e1, t + 3, 'normal', 'in_progress', 'project', p1, p1, uid),
    (p_company, 'Renew Imran''s Emirates ID', 'Typing centre appointment needed.', uid, e4, t + 5, 'urgent', 'waiting', 'employee', e2, null, uid),
    (p_company, 'Send the revised pergola quotation', null, uid, null, t + 1, 'normal', 'todo', 'quotation', q1, p3, uid),
    (p_company, 'Service the forklift', null, uid, e1, t - 2, 'normal', 'completed', null, null, null, uid);

  insert into service_tickets(company_id, number, title, description, category, priority, status, source, customer_id, project_id, contact_name, contact_phone, site_location, employee_id, created_by) values
    (p_company, issue_document_number(p_company, 'service_ticket'), 'Loose grating panel near pump 3', 'One panel rocks when stepped on. Needs an extra clip.', 'repair', 'high', 'scheduled', 'phone',
     c3, p4, 'Omar Haddad', '+971 52 670 3391', 'Musaffah M-14', e3, uid);

  insert into reminders(company_id, title, notes, due_date, offsets, recurrence, created_by) values
    (p_company, 'VAT return filing', 'Quarterly return to the FTA.', t + 16, array[7, 1], 'quarterly', uid),
    (p_company, 'Workshop rent cheque', 'Hand the cheque to the landlord.', t + 9, array[3], 'quarterly', uid);

  perform set_config('request.jwt.claims', coalesce(prev, ''), true);
end $$;

-- One sales document with its lines; returns its id. Totals are computed from the lines (5% VAT).
create or replace function demo_doc(p_company uuid, p_user uuid, p_type text, p_customer uuid, p_project uuid, p_issue date, p_due date, p_status text, p_subject text, p_lines jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare id uuid; sub numeric; cu customers;
begin
  if not exists (select 1 from companies where companies.id = p_company and is_demo) then raise exception 'not a demo company'; end if;
  select * into cu from customers where customers.id = p_customer;
  select round(sum((l->>'q')::numeric * (l->>'p')::numeric), 2) into sub from jsonb_array_elements(p_lines) l;
  insert into invoices(company_id, doc_type, number, customer_id, project_id, issue_date, due_date, valid_until, status, subject, customer_name, customer_address, customer_trn, customer_phone, customer_email, attention,
    subtotal, vat_rate, vat_amount, total, created_by, sent_at)
  values (p_company, p_type, issue_document_number(p_company, p_type), p_customer, p_project, p_issue, p_due, case when p_type = 'quotation' then p_issue + 30 end, p_status, p_subject,
    cu.name, cu.address, cu.trn, cu.phone, cu.email, cu.contact_person,
    sub, case when p_type = 'delivery_note' then 0 else 5 end, case when p_type = 'delivery_note' then 0 else round(sub * 0.05, 2) end,
    case when p_type = 'delivery_note' then 0 else round(sub * 1.05, 2) end, p_user, case when p_status <> 'draft' then p_issue::timestamptz end)
  returning invoices.id into id;
  insert into invoice_items(company_id, invoice_id, position, description, quantity, unit, unit_price)
  select p_company, id, o::int, l->>'d', (l->>'q')::numeric, l->>'u', (l->>'p')::numeric from jsonb_array_elements(p_lines) with ordinality as x(l, o);
  return id;
end $$;

-- The daily reset: wipe and refill every demo company. Returns how many it reset.
create or replace function demo_reset()
returns int language plpgsql security definer set search_path = public as $$
declare cid uuid; n int := 0;
begin
  for cid in select id from companies where is_demo loop
    perform demo_wipe(cid); perform demo_seed(cid); n := n + 1;
  end loop;
  return n;
end $$;

-- Turn an existing sign-in into the demo owner: a new company flagged is_demo, filled with sample data.
-- Refuses a user who already belongs to a company, so it can never move a real account.
create or replace function demo_provision(p_user uuid, p_company_name text default 'Demo Steel Works LLC')
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if exists (select 1 from profiles where id = p_user) then raise exception 'user already belongs to a company'; end if;
  insert into companies(name, timezone, currency, is_demo) values (p_company_name, 'Asia/Dubai', 'AED', true) returning id into cid;
  insert into profiles(id, company_id, full_name, role) values (p_user, cid, 'Demo Admin', 'company_owner');
  perform demo_seed(cid);
  return cid;
end $$;

-- Put the shared demo sign-in back the way it should be: a visitor may have changed its password or email, or turned
-- on two-step verification, which would lock everyone else out. Touches only the owner of a company flagged is_demo.
create or replace function demo_repair_auth(p_email text, p_password text)
returns uuid language plpgsql security definer set search_path = public, extensions, auth as $$
declare uid uuid;
begin
  select p.id into uid from profiles p join companies c on c.id = p.company_id where c.is_demo and p.role = 'company_owner' order by p.created_at limit 1;
  if uid is null then return null; end if;
  if exists (select 1 from auth.users where lower(email) = lower(p_email) and id <> uid) then raise exception 'that email belongs to another account'; end if;
  update auth.users set email = lower(p_email), encrypted_password = crypt(p_password, gen_salt('bf')), email_confirmed_at = coalesce(email_confirmed_at, now()),
    email_change = '', email_change_token_new = '', email_change_token_current = '', banned_until = null
   where id = uid;
  delete from auth.mfa_factors where user_id = uid;
  update profiles set is_active = true, full_name = 'Demo Admin' where id = uid;
  return uid;
end $$;

revoke all on function demo_wipe(uuid), demo_seed(uuid), demo_doc(uuid, uuid, text, uuid, uuid, date, date, text, text, jsonb), demo_reset(), demo_provision(uuid, text), demo_repair_auth(text, text) from public, anon, authenticated;
grant execute on function demo_wipe(uuid), demo_seed(uuid), demo_doc(uuid, uuid, text, uuid, uuid, date, date, text, text, jsonb), demo_reset(), demo_provision(uuid, text), demo_repair_auth(text, text) to service_role;
