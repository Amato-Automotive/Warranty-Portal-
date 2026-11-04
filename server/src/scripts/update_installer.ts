import db from '../config/database.js';

async function updateInstaller() {
  try {
    const uid = '26041302432620';
    const newStoreName = 'CAR DYNAMIC PVT LTD';
    const newStoreEmail = 'cardynamic@outlook.com';

    console.log(`--- UPDATING INSTALLER FOR UID: ${uid} ---`);
    
    const [result]: any = await db.execute(
      'UPDATE warranty_registrations SET installer_name = ?, installer_contact = ? WHERE uid = ?',
      [newStoreName, newStoreEmail, uid]
    );

    if (result.affectedRows > 0) {
      console.log('✅ Installer details updated successfully.');
    } else {
      console.error('❌ Update failed. UID not found.');
    }

    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

updateInstaller();
