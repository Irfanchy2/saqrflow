// Where an "employee" login may go. Everything else (admin pages, reports, finance, settings, other people's records and
// their APIs) sends them back to their portal. This is one layer: the database (RLS) and every server action check again.
const EMPLOYEE_PATHS: RegExp[] = [
  /^\/me(\/.*)?$/,                                      // the Employee Portal
  /^\/api\/expenses\/scan$/,                            // reading a receipt photo (no company data is returned to employees)
  /^\/api\/documents\/[0-9a-f-]{36}\/download$/,        // own receipts and documents (RLS decides)
  /^\/api\/payslips\/[0-9a-f-]{36}$/,                   // own salary receipts (RLS decides)
  /^\/api\/salary-payslips\/[0-9a-f-]{36}$/,            // own monthly payslips (RLS decides)
  /^\/api\/salary-statements\/[0-9a-f-]{36}$/,          // own salary statement (route checks it is their own; RLS decides)
  /^\/api\/petty-cash\/[0-9a-f-]{36}\/statement$/,     // own petty cash statement (route checks it is their own; RLS decides)
  /^\/api\/notifications\/[0-9a-f-]{36}\/open$/,        // opening own notifications
  /^\/api\/employees\/[0-9a-f-]{36}\/photo$/,           // own photo (RLS decides)
  /^\/auth(\/.*)?$/, /^\/offline$/,
]
export const employeeMayUse = (path: string) => EMPLOYEE_PATHS.some(re => re.test(path))
export const EMPLOYEE_HOME = '/me'
