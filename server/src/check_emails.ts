import db from './config/database.js';

async function checkEmails() {
  const [rows]: any = await db.execute("SELECT id, store_name, store_email, city FROM vendor_details WHERE store_name = 'CAR SHRINGAR'");
  console.table(rows);
  process.exit(0);
}

checkEmails();
