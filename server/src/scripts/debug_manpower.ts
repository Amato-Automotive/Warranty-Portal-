import db from '../config/database.js';

async function check() {
  const [rows]: any = await db.execute("SELECT m.name as manpower_name, vd.store_name, vd.city FROM manpower m JOIN vendor_details vd ON m.vendor_id = vd.id WHERE m.name LIKE '%Jasdeep%'");
  console.table(rows);
  process.exit(0);
}

check();
