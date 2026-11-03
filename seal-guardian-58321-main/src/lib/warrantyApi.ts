import api from './api';
import { WarrantyData } from './types';

export const submitWarranty = async (data: WarrantyData) => {
  console.log('[DEBUG warrantyApi] submitWarranty called with data:', data);

  // Helper function to detect File objects across browsers (mobile compatibility)
  const isFileObject = (obj: any): obj is File => {
    if (!obj) return false;
    // Duck-typing check for File-like objects (works on iOS Safari, Chrome Mobile, etc.)
    return (
      (obj instanceof File) ||
      (typeof obj === 'object' &&
        obj.name !== undefined &&
        obj.size !== undefined &&
        typeof obj.name === 'string' &&
        typeof obj.size === 'number')
    );
  };

  const formData = new FormData();
  let hasFiles = false;

  // Helper to append data
  const appendData = (obj: any, parentKey = '') => {
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const value = obj[key];
        const formKey = parentKey ? `${parentKey} [${key}]` : key;

        if (value instanceof File) {
          hasFiles = true;
          // For productDetails files, we want them at root level for multer
          // But we need to know which field they belong to.
          // The controller expects specific field names like 'invoiceFile', 'lhsPhoto', etc.
          // So if we find a file in productDetails, we append it with its key as name.
          if (parentKey === 'productDetails' || parentKey.startsWith('productDetails.')) {
            // e.g. productDetails.invoiceFileName -> invoiceFile (if we mapped it in form)
            // But the form state has `invoiceFile` at root or `lhsPhoto` at root usually?
            // Wait, SeatCoverForm has `invoiceFile` at root of formData state, but passed inside `productDetails` to API?
            // Let's check SeatCoverForm submit logic.
            // It constructs `warrantyData` with `productDetails: { invoiceFileName: ... } `.
            // But `invoiceFile` is NOT in `productDetails` in the constructed object in SeatCoverForm?
            // Ah, SeatCoverForm: `invoiceFileName: formData.invoiceFile?.name`. It sends the NAME.
            // We need to change SeatCoverForm to pass the FILE object somewhere.

            // Let's assume we will change the forms to pass the File objects in the `data` object
            // specifically for this API wrapper to handle.
            // Or better: The forms should pass a flat object with files, and we construct the structure?
            // No, `submitWarranty` takes `WarrantyData`.

            // Strategy:
            // 1. We will modify `submitWarranty` to accept `files` map separately? Or just handle File objects in `data`.
            // 2. If `data` contains File objects, we append them to FormData with their key.
            // 3. We also append the JSON string of `productDetails` (excluding the File objects from it).

            formData.append(key, value);
          } else {
            formData.append(formKey, value);
          }
        } else if (typeof value === 'object' && value !== null) {
          // We don't want to recurse too deep for FormData if we are sending JSON for complex objects
          // But for `productDetails`, we want to send it as a JSON string usually, 
          // EXCEPT for the files which need to be extracted.

          // Actually, simpler approach:
          // The controller expects `productDetails` as a JSON string.
          // And files as separate fields.
          // So we should strip files from `productDetails` and append them separately.
        }
      }
    }
  };

  // Custom FormData construction
  // 1. Append all root fields
  for (const key in data) {
    if (key === 'productDetails') continue;
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      const value = (data as any)[key];
      if (value != null) formData.append(key, value);
    }
  }
  console.log('[DEBUG warrantyApi] Root fields appended');

  // 2. Handle productDetails
  const pd = { ...data.productDetails };
  const filesToAppend: Record<string, File> = {};

  // Check for invoiceFile (Seat Cover) - currently passed as invoiceFileName string in pd?
  // We need to pass the actual file. 
  // We will modify the forms to pass the file in a temporary field in `data` or `productDetails`.
  // Let's say we put the File object in `productDetails` temporarily.

  if (isFileObject((pd as any).invoiceFile)) {
    filesToAppend['invoiceFile'] = (pd as any).invoiceFile;
    delete (pd as any).invoiceFile;
    // Also clear the name field if it's just a placeholder, controller will set it
    delete (pd as any).invoiceFileName;
  }

  // Check for photos (EV)
  if (pd.photos) {
    console.log('[DEBUG warrantyApi] Processing photos:', pd.photos);
    const photos = { ...pd.photos };
    // The form sends: lhs: filename. We need the File object.
    // We will modify EVProductsForm to pass File objects in `photos` or separate fields.
    // Let's assume we modify EVProductsForm to pass `lhsPhoto`, `rhsPhoto` etc in `productDetails` or root.

    // Let's look at EVProductsForm submit:
    // It constructs `productDetails.photos` with names.
    // We should change it to pass the File objects.

    ['lhs', 'rhs', 'frontReg', 'backReg', 'warranty', 'vehicle', 'mrpLabel', 'seatCover'].forEach(key => {
      if (isFileObject((photos as any)[key])) {
        console.log(`[DEBUG warrantyApi] Found file for ${key}:`, (photos as any)[key].name);
        filesToAppend[`${key}Photo`] = (photos as any)[key];
        delete (photos as any)[key];
      } else {
        console.log(`[DEBUG warrantyApi] No File found for ${key}, value:`, (photos as any)[key]);
      }
    });
    pd.photos = photos;
  }

  // Append productDetails as JSON first so backend Multer can parse it before files
  formData.append('productDetails', JSON.stringify(pd));
  console.log('[DEBUG warrantyApi] productDetails JSON:', JSON.stringify(pd));

  // Append files
  console.log('[DEBUG warrantyApi] Files to append:', Object.keys(filesToAppend));
  Object.keys(filesToAppend).forEach(key => {
    formData.append(key, filesToAppend[key]);
    hasFiles = true;
  });
  console.log('[DEBUG warrantyApi] productDetails JSON:', JSON.stringify(pd));

  console.log('[DEBUG warrantyApi] hasFiles:', hasFiles, '- making API call...');

  if (hasFiles) {
    const response = await api.post('/warranty/submit', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    console.log('[DEBUG warrantyApi] Response received:', response.data);
    return response.data;
  } else {
    const response = await api.post('/warranty/submit', data);
    console.log('[DEBUG warrantyApi] Response received (no files):', response.data);
    return response.data;
  }
};

export const getWarranties = async () => {
  const response = await api.get('/warranty');
  return response.data;
};

export const getWarrantyById = async (id: string) => {
  const response = await api.get(`/warranty/${id}`);
  return response.data;
};

export const updateWarranty = async (id: string, data: WarrantyData) => {
  // Same logic as submitWarranty for FormData
  const formData = new FormData();
  let hasFiles = false;

  for (const key in data) {
    if (key === 'productDetails') continue;
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      formData.append(key, (data as any)[key]);
    }
  }

  const pd = { ...data.productDetails };
  const filesToAppend: Record<string, File> = {};

  if ((pd as any).invoiceFile instanceof File) {
    filesToAppend['invoiceFile'] = (pd as any).invoiceFile;
    delete (pd as any).invoiceFile;
    delete (pd as any).invoiceFileName;
  }

  if (pd.photos) {
    const photos = { ...pd.photos };
    ['lhs', 'rhs', 'frontReg', 'backReg', 'warranty', 'vehicle', 'mrpLabel', 'seatCover'].forEach(key => {
      if ((photos as any)[key] instanceof File) {
        filesToAppend[`${key}Photo`] = (photos as any)[key];
        delete (photos as any)[key];
      }
    });
    pd.photos = photos;
  }

  formData.append('productDetails', JSON.stringify(pd));

  Object.keys(filesToAppend).forEach(key => {
    formData.append(key, filesToAppend[key]);
    hasFiles = true;
  });

  if (hasFiles) {
    const response = await api.put(`/warranty/${id}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    return response.data;
  } else {
    const response = await api.put(`/warranty/${id}`, data);
    return response.data;
  }
};