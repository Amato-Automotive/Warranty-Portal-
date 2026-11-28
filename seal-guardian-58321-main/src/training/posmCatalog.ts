/* eslint-disable */
/** The live POSM items as head office set them up (copied 28 Nov 2026), so the training store asks for the same things. Item definitions only; no store or customer data. */
export const LIVE_POSM_CATALOG: any = {
 "items": [
  {
   "id": "tshirt",
   "name": "T-shirt",
   "description": "Pick the sizes",
   "clipart": "tshirt",
   "image": "https://api.autoformindia.co.in/uploads/posm_requests/2026-10/image_Grey_Autoform_Polo_Shirt_Mocku_1792130979026.png",
   "enabled": true,
   "qty_mode": "number",
   "limits": {
    "min": 2,
    "max_request": 2,
    "max_month": null,
    "max_year": 2
   },
   "fields": [
    {
     "id": "sizes",
     "label": "Sizes",
     "type": "sizes",
     "required": true,
     "options": [
      "M",
      "L"
     ]
    }
   ]
  },
  {
   "id": "vcard",
   "name": "Visiting cards",
   "description": "Your details and a photo of your old card",
   "clipart": "vcard",
   "image": "https://api.autoformindia.co.in/uploads/posm_requests/2026-10/image_WhatsApp_Image_2026_10_16_at_1_1792129312850.jpeg",
   "enabled": true,
   "qty_mode": "number",
   "limits": {
    "min": 1,
    "max_request": null,
    "max_month": null,
    "max_year": 1
   },
   "fields": [
    {
     "id": "name",
     "label": "Name",
     "type": "text",
     "required": true
    },
    {
     "id": "designation",
     "label": "Designation",
     "type": "text",
     "required": false
    },
    {
     "id": "phone",
     "label": "Phone",
     "type": "text",
     "required": true
    },
    {
     "id": "email",
     "label": "Email",
     "type": "text",
     "required": true
    },
    {
     "id": "address",
     "label": "Address on the card",
     "type": "textarea",
     "required": true
    },
    {
     "id": "photos",
     "label": "Photo of your old card or logo",
     "type": "files",
     "required": false,
     "max_files": 2
    }
   ]
  },
  {
   "id": "frp",
   "name": "FRP Cover",
   "description": "Brand and design: colours and material come with the design",
   "clipart": "frp",
   "image": null,
   "enabled": true,
   "qty_mode": "number",
   "limits": {
    "min": null,
    "max_request": null,
    "max_month": null,
    "max_year": 2
   },
   "fields": [
    {
     "id": "brand",
     "label": "Brand",
     "type": "brand",
     "required": true,
     "multiple": true
    },
    {
     "id": "design",
     "label": "Design",
     "type": "table",
     "required": true,
     "columns": [
      "Design",
      "Major colour",
      "Minor colour",
      "Material"
     ],
     "brand_split": false,
     "rows": [
      {
       "cells": [
        "U-Focus",
        "Red",
        "Black",
        "Signature"
       ]
      },
      {
       "cells": [
        "H Cross",
        "Bl. White",
        "Wine",
        "Signature"
       ]
      },
      {
       "cells": [
        "U Sportz Crysta",
        "Tan",
        "Black",
        "Emporio"
       ]
      },
      {
       "cells": [
        "D3",
        "Tan",
        "Black",
        "Lucenzo"
       ]
      },
      {
       "cells": [
        "U Arrow",
        "Nutmeg",
        "Maroon",
        "Signature"
       ]
      },
      {
       "cells": [
        "X Cross",
        "Silver",
        "Purple",
        "Signature"
       ]
      },
      {
       "cells": [
        "U Navigation Plus",
        "Silver",
        "Burgundy",
        "Signature"
       ]
      },
      {
       "cells": [
        "U Ladder",
        "Yellow-Red",
        "Black",
        "Signature"
       ]
      },
      {
       "cells": [
        "U Blade",
        "Bl. White",
        "Yellow",
        "Signature"
       ]
      },
      {
       "cells": [
        "U Volt",
        "Nutmeg",
        "Brown",
        "Signature"
       ]
      },
      {
       "cells": [
        "Q2",
        "Camel",
        "Brown",
        "Signature"
       ]
      },
      {
       "cells": [
        "Polo",
        "Olive Green",
        "Olive Green",
        "Signature"
       ]
      },
      {
       "cells": [
        "Amaze",
        "Black",
        "Silver stitch",
        "Lucenzo"
       ]
      },
      {
       "cells": [
        "Cheer",
        "Silver",
        "Blue",
        "Lucenzo"
       ]
      },
      {
       "cells": [
        "E Cross",
        "Brown",
        "Bl. White stitch",
        "Lucenzo"
       ]
      },
      {
       "cells": [
        "Hammer",
        "Red",
        "Black",
        "Lucenzo"
       ]
      },
      {
       "cells": [
        "Hunk Grill",
        "Black",
        "Burgundy",
        "Lucenzo"
       ]
      },
      {
       "cells": [
        "Hunk Perfo",
        "Bl. White",
        "Maroon",
        "Lucenzo"
       ]
      },
      {
       "cells": [
        "Inspire",
        "Burgundy",
        "Burgundy",
        "Lucenzo"
       ]
      },
      {
       "cells": [
        "Track",
        "Tan",
        "Black",
        "Lucenzo"
       ]
      },
      {
       "cells": [
        "Xpress",
        "Tan",
        "Black",
        "Lucenzo"
       ]
      },
      {
       "cells": [
        "Hunk",
        "Black",
        "V. Meg",
        "Lucenzo"
       ]
      },
      {
       "cells": [
        "Amaze Duo",
        "Silver",
        "Black",
        "Lucenzo"
       ]
      }
     ]
    },
    {
     "id": "remarks",
     "label": "Remarks for the team",
     "type": "textarea",
     "required": false,
     "help": "Anything else about this FRP"
    },
    {
     "id": "dispatch_to",
     "label": "Dispatch to",
     "type": "select",
     "required": true,
     "options": [
      "Direct dispatch to Distributor",
      "Direct dispatch to Franchise"
     ]
    }
   ]
  },
  {
   "id": "jacket",
   "name": "Sample jacket",
   "description": "",
   "clipart": "jacket",
   "image": "https://api.autoformindia.co.in/uploads/posm_requests/2026-10/image_4bd5bbf9_4618_420f_803e_cc5d4a_1792129885515.png",
   "enabled": true,
   "qty_mode": "number",
   "limits": {
    "min": null,
    "max_request": 20,
    "max_month": null,
    "max_year": 20
   },
   "fields": [
    {
     "id": "dispatch_to",
     "label": "Dispatch to",
     "type": "select",
     "required": true,
     "options": [
      "Direct dispatch to Distributor",
      "Direct dispatch to Franchise"
     ]
    }
   ]
  },
  {
   "id": "art",
   "name": "Art work",
   "description": "What it is, where it goes and its size",
   "clipart": "artwork",
   "image": null,
   "enabled": true,
   "qty_mode": "number",
   "limits": {
    "min": 1,
    "max_request": 4,
    "max_month": null,
    "max_year": null
   },
   "fields": [
    {
     "id": "what",
     "label": "What is the art work?",
     "type": "textarea",
     "required": true
    },
    {
     "id": "place",
     "label": "Where it will be used",
     "type": "select",
     "required": true,
     "options": [
      "Shop front",
      "Inside wall",
      "Counter",
      "Glass door",
      "Other"
     ]
    },
    {
     "id": "width",
     "label": "Width",
     "type": "number",
     "required": true
    },
    {
     "id": "height",
     "label": "Height",
     "type": "number",
     "required": true
    },
    {
     "id": "unit",
     "label": "Unit",
     "type": "select",
     "required": true,
     "options": [
      "ft",
      "inch",
      "cm"
     ]
    },
    {
     "id": "photos",
     "label": "Photos of the place",
     "type": "files",
     "required": false,
     "max_files": 5
    }
   ]
  }
 ]
};
