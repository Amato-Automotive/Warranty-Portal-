import dotenv from 'dotenv';
import path from 'path';
import { EmailService } from '../services/email.service.js';

// Load environment variables from the server directory
dotenv.config({ path: path.join(process.cwd(), 'server', '.env') });

async function resendApproval() {
  const data = {
    uid: "25101502383234",
    customerName: "Mr Swayam Chawla",
    customerEmail: "22swayamchawla@gmail.com",
    customerPhone: "9992150224",
    registrationNumber: "HR-01-AX-3330",
    productType: "seat-cover",
    warrantyType: "1+1 year",
    installerName: "FD SEAT COVER",
    installerContact: "narinderfd@gmail.com",
    manpowerName: "Narender",
    productDetails: {
      productName: "AMAZE+",
      product: "seat-cover"
    },
    storeAddress: "F D SEAT COVER FACTORY OPPOSITE NEXA SHOWROOM AND ENFIELD SHOWROOM CHANDIGARH ROAD BALDEV NAGAR AMBALA CITY, AMBALA, HARYANA - 134007"
  };

  console.log(`Sending approval emails for UID: ${data.uid}...`);

  try {
    // 1. Send to Customer
    await EmailService.sendWarrantyApprovalToCustomer(
      data.customerEmail,
      data.customerName,
      data.uid,
      data.productType,
      data.registrationNumber,
      undefined, // carMake
      undefined, // carModel
      data.productDetails,
      data.warrantyType,
      data.installerName,
      data.storeAddress,
      data.installerContact,
      data.manpowerName
    );
    console.log(`✓ Approval email sent to customer: ${data.customerEmail}`);

    // 2. Send to Vendor
    await EmailService.sendWarrantyApprovalToVendor(
      data.installerContact,
      data.installerName,
      data.customerName,
      data.customerPhone,
      data.productType,
      data.registrationNumber,
      data.manpowerName,
      data.uid,
      undefined, // carMake
      undefined, // carModel
      data.productDetails,
      data.warrantyType
    );
    console.log(`✓ Approval email sent to vendor: ${data.installerContact}`);

    console.log("All emails sent successfully.");
    process.exit(0);
  } catch (error) {
    console.error("Error sending emails:", error);
    process.exit(1);
  }
}

resendApproval();
