import db from './config/database.js';

async function checkData() {
  const [rows]: any = await db.execute("SELECT uid, installer_name, installer_contact FROM warranty_registrations LIMIT 20");
  console.table(rows);
  process.exit(0);
}

checkData();
