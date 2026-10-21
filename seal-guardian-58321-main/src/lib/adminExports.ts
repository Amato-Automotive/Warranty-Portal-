import { downloadCSV, formatToIST, getISTTodayISO } from "@/lib/utils";
import { API_URL } from "@/lib/api";
import { vehicleNumberOf } from "@/lib/vehicleNumber";

/**
 * Available warranty export fields
 */
export const WARRANTY_EXPORT_FIELDS = [
    { id: 'date', label: 'Registration Date' },
    { id: 'productName', label: 'Product Name' },
    { id: 'productType', label: 'Product Category' },
    { id: 'warrantyType', label: 'Warranty Type' },
    { id: 'uid', label: 'UID / Serial' },
    { id: 'rollUsage', label: 'PPF Roll Usage' },
    { id: 'status', label: 'Status' },
    { id: 'customerName', label: 'Customer Name' },
    { id: 'customerPhone', label: 'Customer Phone' },
    { id: 'customerEmail', label: 'Customer Email' },
    { id: 'vehicle', label: 'Vehicle (Make/Model/Year)' },
    { id: 'vehicleMake', label: 'Vehicle Make' },
    { id: 'vehicleModel', label: 'Vehicle Model' },
    { id: 'vehicleYear', label: 'Vehicle Year' },
    { id: 'vehicleReg', label: 'Vehicle Registration' },
    { id: 'installerStore', label: 'Store Name' },
    { id: 'installerEmail', label: 'Store Email' },
    { id: 'installerPhone', label: 'Store Phone' },
    { id: 'installerManpower', label: 'Applicator Name' },
    { id: 'purchaseDate', label: 'Purchase Date' },
    { id: 'approvedDate', label: 'Approved Date' },
    { id: 'rejectionReason', label: 'Rejection Reason' },
    { id: 'links', label: 'Documentation Links' }
];

/**
 * Format warranty data for export
 */
export const formatWarrantyForExport = (w: any, selectedFields?: string[]) => {
    const productDetails = typeof w.product_details === 'string'
        ? JSON.parse(w.product_details)
        : w.product_details || {};

    const rawProductName = productDetails.product || productDetails.productName || w.product_type;
    const productName = rawProductName?.replace(/-/g, ' ').toUpperCase() || w.product_type;

    const fullData: any = {
        date: formatToIST(w.created_at),
        productName: productName,
        productType: w.product_type?.toUpperCase(),
        warrantyType: w.warranty_type || 'N/A',
        uid: w.uid || productDetails.lotNumber || productDetails.serialNumber || 'N/A',
        status: w.status?.toUpperCase() || 'N/A',
        customerName: w.customer_name,
        customerPhone: w.customer_phone,
        customerEmail: w.customer_email || 'N/A',
        vehicle: (w.car_make && String(w.car_make).toLowerCase() !== 'null' || w.car_model && String(w.car_model).toLowerCase() !== 'null' || w.car_year && String(w.car_year).toLowerCase() !== 'null') ? `${w.car_make || ''} ${w.car_model || ''} (${w.car_year || ''})`.trim() : 'N/A',
        vehicleMake: w.car_make || 'N/A',
        vehicleModel: w.car_model || 'N/A',
        vehicleYear: w.car_year || 'N/A',
        vehicleReg: vehicleNumberOf(w.registration_number, productDetails.carRegistration) || '',
        // The store it is filed under, with its city (franchises share names).
        installerStore: w.vendor_store_name
            ? `${w.vendor_store_name}${w.vendor_city ? ` - ${w.vendor_city}` : ''}`
            : (productDetails.storeName || w.installer_name || 'N/A'),
        installerEmail: productDetails.storeEmail || (w.installer_contact?.includes('|') ? w.installer_contact.split('|')[0].trim() : w.installer_contact) || 'N/A',
        installerPhone: productDetails.dealerMobile || (w.installer_contact?.includes('|') ? w.installer_contact.split('|')[1].trim() : '') || 'N/A',
        installerManpower: w.manpower_name || productDetails.manpowerName || w.manpower_name_from_db || 'N/A',
        purchaseDate: w.purchase_date ? formatToIST(w.purchase_date) : 'N/A',
        approvedDate: w.validated_at ? formatToIST(w.validated_at) : 'N/A',
        rejectionReason: w.rejection_reason || 'N/A',
        /*
         * Which rolls a PPF job drew on, how much came from each, and where it
         * went. A seat cover has none, and a PPF warranty filed before rolls
         * were tracked falls back to the single serial and area it recorded.
         */
        rollUsage: Array.isArray(productDetails.rolls) && productDetails.rolls.length > 0
            ? productDetails.rolls
                .map((r: any) => `${r.serial} (${r.sqft} sq.ft${r.installArea ? ` - ${r.installArea}` : ''})`)
                .join('; ')
            : (w.product_type === 'ev-products'
                ? [productDetails.serialNumber, productDetails.installArea].filter(Boolean).join(' - ') || 'N/A'
                : 'N/A'),
    };

    // Documentation Links
    if (w.product_type === 'seat-cover' && productDetails.invoiceFileName) {
        const baseUrl = API_URL.endsWith('/api') ? API_URL.slice(0, -4) : API_URL;
        fullData.links = productDetails.invoiceFileName.startsWith('http')
            ? productDetails.invoiceFileName
            : `${baseUrl}/uploads/${productDetails.invoiceFileName}`;
    } else if (w.product_type === 'ev-products' && productDetails.photos) {
        fullData.links = Object.values(productDetails.photos).filter(Boolean).join(", ");
    } else {
        fullData.links = 'N/A';
    }

    if (!selectedFields || selectedFields.length === 0) {
        // Return original format if no fields specified for backward compatibility
        // Mapping fullData keys to the labels used in WARRANTY_EXPORT_FIELDS for CSV headers
        const result: any = {};
        WARRANTY_EXPORT_FIELDS.forEach(field => {
            result[field.label] = fullData[field.id];
        });
        return result;
    }

    const filteredData: any = {};
    selectedFields.forEach(fieldId => {
        const fieldMeta = WARRANTY_EXPORT_FIELDS.find(f => f.id === fieldId);
        if (fieldMeta) {
            filteredData[fieldMeta.label] = fullData[fieldId];
        }
    });

    return filteredData;
};

/**
 * Format vendor data for export
 */
export const formatVendorForExport = (v: any) => ({
    'Store Name': v.store_name,
    'Contact Person': v.contact_name || v.vendor_name,
    'Email': v.email || v.store_email,
    'Phone': v.phone_number,
    'Manpower Count': v.manpower_count || 0,
    'City': v.city,
    'State': v.state,
    'Address': v.full_address || v.address || 'N/A',
    'Pincode': v.pincode || 'N/A',
    'Status': v.is_verified ? 'Approved' : (v.verified_at ? 'Disapproved' : 'Pending'),
    'Approved Warranties': v.validated_warranties || 0,
    'Pending Warranties': v.pending_warranties || 0,
    'Disapproved Warranties': v.rejected_warranties || 0,
    'Total Warranties': v.total_warranties || 0,
    'Joined Date': formatToIST(v.created_at)
});

/**
 * Format customer data for export
 */
export const formatCustomerForExport = (c: any) => ({
    'Customer Name': c.customer_name,
    'Email': c.customer_email,
    'Phone': c.customer_phone,
    'Approved Warranties': c.validated_warranties || 0,
    'Disapproved Warranties': c.rejected_warranties || 0,
    'Pending Warranties': c.pending_warranties || 0,
    'Total Warranties': c.total_warranties || 0,
    'Registered Date': formatToIST(c.created_at)
});

/**
 * Format manpower data for export
 */
export const formatManpowerForExport = (m: any) => ({
    Name: m.name,
    Phone: m.phone_number,
    'Manpower ID': m.manpower_id,
    'Role': m.applicator_type?.replace('_', ' ').toUpperCase() || 'N/A',
    'Status': m.is_active ? 'Active' : 'Inactive',
    'Approved Points': m.points || 0,
    'Pending Points': m.pending_points || 0,
    'Disapproved Points': m.rejected_points || 0,
    'Total Applications': m.total_applications || 0,
    'Joined Date': formatToIST(m.created_at)
});

/**
 * Export warranties to CSV
 */
export const exportWarrantiesToCSV = (warranties: any[], filename?: string, selectedFields?: string[]) => {
    const exportData = warranties.map(w => formatWarrantyForExport(w, selectedFields));
    downloadCSV(exportData, filename || `warranties_export_${getISTTodayISO()}.csv`);
};

/**
 * Export vendors to CSV
 */
export const exportVendorsToCSV = (vendors: any[], filename?: string) => {
    const exportData = vendors.map(formatVendorForExport);
    downloadCSV(exportData, filename || `vendors_export_${getISTTodayISO()}.csv`);
};

/**
 * Export customers to CSV
 */
export const exportCustomersToCSV = (customers: any[], filename?: string) => {
    const exportData = customers.map(formatCustomerForExport);
    downloadCSV(exportData, filename || `customers_export_${getISTTodayISO()}.csv`);
};

/**
 * Export manpower to CSV
 */
export const exportManpowerToCSV = (manpower: any[], filename?: string) => {
    const exportData = manpower.map(formatManpowerForExport);
    downloadCSV(exportData, filename || `manpower_export_${getISTTodayISO()}.csv`);
};
