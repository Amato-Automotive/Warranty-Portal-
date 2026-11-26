/**
 * An invoice may be a photo or a PDF. For a PDF the server saves its pages
 * (up to 10, one under the other) as a picture beside it (<file>.preview.jpg),
 * so admin screens can show it like any other photo. Older PDFs have no picture: callers fall back on onError.
 */
export const isPdfUrl = (url: unknown): url is string => typeof url === "string" && /\.pdf($|\?)/i.test(url);

/** The picture to show for an invoice: the photo itself, or the pages of a PDF. */
/* Uploads are cached by browsers for 30 days; bump this when the picture's layout changes (v2: all pages, not just page 1). */
const PREVIEW_VERSION = 2;
export const invoiceImageUrl = (url: string) => (isPdfUrl(url) ? `${url.split("?")[0]}.preview.jpg?v=${PREVIEW_VERSION}` : url);
