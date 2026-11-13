import { useState, useRef, useCallback, useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Camera, RotateCcw, Check, X, Upload, Loader2, ImageIcon } from "lucide-react";

interface CameraCaptureProps {
    /** Label shown on the upload button */
    label: string;
    /** Description text under the label */
    description?: string;
    /** Whether this field is required */
    required?: boolean;
    /** Whether interactions are disabled */
    disabled?: boolean;
    /** Whether to force camera-only (no file picker) */
    cameraOnly?: boolean;
    /** The currently selected file */
    value: File | null;
    /** Callback when a file is captured/selected */
    onChange: (file: File | null) => void;
    /** Accept attribute for file input (used for non-camera-only mode) */
    accept?: string;
    /** Icon component to show when file is selected */
    selectedIcon?: React.ReactNode;
    /** Icon component to show when no file is selected */
    defaultIcon?: React.ReactNode;
    /** Unique ID for the input */
    id: string;
    /** Optional sample image URL shown as a reference example for users */
    sampleImageUrl?: string;
    /** Several examples, shown one under the other as 1, OR, 2. Used instead of sampleImageUrl. */
    sampleImages?: { src: string; title: string }[];
    /** Label for the sample image (defaults to 'See Example') */
    sampleImageLabel?: string;
    /** Optional existing image URL to show if no new file is selected */
    existingImageUrl?: string | null;
}

/**
 * Detects if the current device is a genuine mobile/tablet device.
 * 
 * IMPORTANT: Uses user-agent as the primary signal and physical screen
 * dimensions (window.screen.width) as a secondary check. We intentionally
 * avoid window.innerWidth because it changes when DevTools is open,
 * which would cause desktop browsers to fall into the mobile path
 * and bypass the webcam-only enforcement.
 */
const isMobileDevice = (): boolean => {
    // Primary check: user agent (most reliable for actual device type)
    const mobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent
    );
    if (mobileUA) return true;

    // Secondary check: touch-capable device with a physically small screen
    // window.screen.width returns the physical display width, NOT the viewport,
    // so it's immune to DevTools toggling or responsive mode simulation
    if (navigator.maxTouchPoints > 0 && window.screen.width <= 1024) {
        return true;
    }

    return false;
};

/**
 * CameraCapture component that enforces camera-only image capture:
 * - On mobile: Uses native <input type="file" capture="environment">
 * - On desktop: Opens a webcam modal via MediaDevices API
 * - For non-camera-only mode (e.g. invoice): regular file picker
 */
const CameraCapture = ({
    label,
    description,
    required = false,
    disabled = false,
    cameraOnly = false,
    value,
    onChange,
    accept = "image/*",
    selectedIcon,
    defaultIcon,
    id,
    sampleImageUrl,
    sampleImages,
    sampleImageLabel = "See Example",
    existingImageUrl,
}: CameraCaptureProps) => {
    const [showWebcam, setShowWebcam] = useState(false);
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [capturedImage, setCapturedImage] = useState<string | null>(null);
    const [cameraError, setCameraError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [showSample, setShowSample] = useState(false);
    const [showExistingModal, setShowExistingModal] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Cleanup stream on unmount
    useEffect(() => {
        return () => {
            if (stream) {
                stream.getTracks().forEach((track) => track.stop());
            }
        };
    }, [stream]);

    const startCamera = useCallback(async () => {
        setCameraError(null);
        setCapturedImage(null);
        setLoading(true);

        try {
            const mediaStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: "environment", // Prefer rear camera
                    width: { ideal: 1920 },
                    height: { ideal: 1080 },
                },
                audio: false,
            });

            setStream(mediaStream);

            // Wait for video element to be ready
            setTimeout(() => {
                if (videoRef.current) {
                    videoRef.current.srcObject = mediaStream;
                    videoRef.current.play().catch(console.error);
                }
                setLoading(false);
            }, 100);
        } catch (err: any) {
            setLoading(false);
            if (err.name === "NotAllowedError") {
                setCameraError(
                    "Camera access denied. Please allow camera permissions in your browser settings."
                );
            } else if (err.name === "NotFoundError") {
                setCameraError(
                    "No camera found. Please connect a camera to continue."
                );
            } else {
                setCameraError(`Camera error: ${err.message}`);
            }
        }
    }, []);

    const stopCamera = useCallback(() => {
        if (stream) {
            stream.getTracks().forEach((track) => track.stop());
            setStream(null);
        }
        if (videoRef.current) {
            videoRef.current.srcObject = null;
        }
    }, [stream]);

    const capturePhoto = useCallback(() => {
        if (!videoRef.current || !canvasRef.current) return;

        const video = videoRef.current;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // Set canvas size to video dimensions
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        // Draw current video frame
        ctx.drawImage(video, 0, 0);

        // Get data URL for preview
        const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
        setCapturedImage(dataUrl);

        // Stop camera after capture
        stopCamera();
    }, [stopCamera]);

    const confirmCapture = useCallback(() => {
        if (!canvasRef.current) return;

        canvasRef.current.toBlob(
            (blob) => {
                if (blob) {
                    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
                    const file = new File([blob], `camera_${timestamp}.jpg`, {
                        type: "image/jpeg",
                        lastModified: Date.now(),
                    });
                    onChange(file);
                }
                setCapturedImage(null);
                setShowWebcam(false);
            },
            "image/jpeg",
            0.9
        );
    }, [onChange]);

    const retakePhoto = useCallback(() => {
        setCapturedImage(null);
        startCamera();
    }, [startCamera]);

    const handleCloseWebcam = useCallback(() => {
        stopCamera();
        setCapturedImage(null);
        setCameraError(null);
        setShowWebcam(false);
    }, [stopCamera]);

    const handleButtonClick = () => {
        if (disabled) return;

        if (!cameraOnly) {
            // Regular file picker for invoice
            fileInputRef.current?.click();
            return;
        }

        if (isMobileDevice()) {
            // Mobile: use native camera input
            fileInputRef.current?.click();
        } else {
            // Desktop: open webcam modal
            setShowWebcam(true);
            startCamera();
        }
    };

    const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            onChange(file);
        }
        // Reset input so same file can be re-selected
        e.target.value = "";
    };

    return (
        <>
            {/* Sample Image Dialog */}
            <Dialog open={showSample} onOpenChange={setShowSample}>
                <DialogContent className="max-w-sm p-0 overflow-hidden">
                    <DialogHeader className="px-4 pt-4 pb-2">
                        <DialogTitle className="text-sm font-semibold">{label} — Sample</DialogTitle>
                        <DialogDescription className="text-xs">Use this as a reference for your photo</DialogDescription>
                    </DialogHeader>
                    {sampleImages?.length ? (
                        <div className="max-h-[75vh] space-y-4 overflow-y-auto px-4 pb-4">
                            {sampleImages.map((ex, i) => (
                                <div key={ex.src} className="space-y-4">
                                    {i > 0 && (
                                        <div className="flex items-center gap-3 text-xs font-semibold uppercase text-slate-400">
                                            <span className="h-px flex-1 bg-slate-200" />
                                            or
                                            <span className="h-px flex-1 bg-slate-200" />
                                        </div>
                                    )}
                                    <figure className="space-y-1">
                                        <figcaption className="text-xs font-semibold text-slate-700">{i + 1}. {ex.title}</figcaption>
                                        <img src={ex.src} alt={`Sample ${ex.title}`} className="w-full rounded-md border object-contain" loading="lazy" />
                                    </figure>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <img
                            src={sampleImageUrl}
                            alt={`Sample ${label}`}
                            className="w-full object-contain"
                        />
                    )}
                </DialogContent>
            </Dialog>

            {/* Existing Image Dialog */}
            <Dialog open={showExistingModal} onOpenChange={setShowExistingModal}>
                <DialogContent className="max-w-sm p-0 overflow-hidden">
                    <DialogHeader className="px-4 pt-4 pb-2">
                        <DialogTitle className="text-sm font-semibold">{label} — Existing</DialogTitle>
                        <DialogDescription className="text-xs">Previously uploaded image</DialogDescription>
                    </DialogHeader>
                    {existingImageUrl && (
                        <img
                            src={existingImageUrl.startsWith('http') ? existingImageUrl : `${window.location.origin}/uploads/${existingImageUrl}`}
                            alt={`Existing ${label}`}
                            className="w-full object-contain"
                        />
                    )}
                </DialogContent>
            </Dialog>

            {/* Upload Area */}
            <div className="space-y-3 md:col-span-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <label htmlFor={id} className="text-sm font-medium text-slate-700 shrink-0">
                        {label} {required && <span className="text-destructive">*</span>}
                    </label>
                    <div className="flex items-center gap-4">
                        {existingImageUrl && (
                            <button
                                type="button"
                                onClick={() => setShowExistingModal(true)}
                                className="flex items-center gap-1 text-xs text-emerald-600 font-medium hover:text-emerald-800 transition-colors"
                            >
                                <ImageIcon className="h-3 w-3" />
                                View Existing
                            </button>
                        )}
                        {(sampleImageUrl || sampleImages?.length) && (
                            <button
                                type="button"
                                onClick={() => setShowSample(true)}
                                className="flex items-center gap-1 text-xs text-orange-600 font-medium hover:text-orange-800 transition-colors"
                            >
                                <ImageIcon className="h-3 w-3" />
                                {sampleImageLabel}
                            </button>
                        )}
                    </div>
                </div>
                <div
                    className={`mt-2 border-2 border-dashed rounded-xl p-6 transition-all duration-200 text-center relative cursor-pointer ${value
                        ? "border-orange-300 bg-orange-50/30"
                        : "border-slate-200 hover:border-orange-300 hover:bg-slate-50"
                        } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
                    onClick={!value ? handleButtonClick : undefined}
                >
                    <div className="flex flex-col items-center gap-2">
                        <div
                            className={`p-3 rounded-full ${value
                                ? "bg-orange-100 text-orange-600"
                                : "bg-slate-100 text-slate-500"
                                }`}
                        >
                            {value
                                ? selectedIcon || <Camera className="h-6 w-6" />
                                : defaultIcon || (
                                    <>{cameraOnly ? <Camera className="h-6 w-6" /> : <Upload className="h-6 w-6" />}</>
                                )}
                        </div>
                        <div>
                            {value ? (
                                <div className="space-y-1">
                                    <p className="text-sm font-medium text-orange-700 break-all">
                                        {value.name}
                                    </p>
                                    <p className="text-xs text-orange-600/70">
                                        {(value.size / 1024 / 1024).toFixed(2)} MB
                                    </p>
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleButtonClick();
                                        }}
                                        className="text-xs text-orange-600 underline cursor-pointer hover:text-orange-800"
                                    >
                                        {cameraOnly ? "Retake Photo" : "Change File"}
                                    </button>
                                </div>
                            ) : (
                                <div className="space-y-1">
                                    <p className="text-sm font-medium text-slate-700">
                                        {cameraOnly
                                            ? "Tap to capture photo"
                                            : "Click to upload or drag and drop"}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        {description || (cameraOnly ? "Camera capture only" : "JPG, PNG, PDF (Max 5MB)")}
                                    </p>
                                    {existingImageUrl && (
                                        <p className="text-[10px] text-emerald-600 font-medium mt-1">
                                            ✓ An image is already uploaded for this field
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Hidden file input */}
                <input
                    ref={fileInputRef}
                    id={id}
                    type="file"
                    accept={accept}
                    capture={cameraOnly ? "environment" : undefined}
                    onChange={handleFileInputChange}
                    disabled={disabled}
                    className="hidden"
                />
            </div>

            {/* Desktop Webcam Modal */}
            <Dialog open={showWebcam} onOpenChange={(open) => !open && handleCloseWebcam()}>
                <DialogContent className="max-w-2xl p-0 overflow-hidden">
                    <DialogHeader className="p-4 pb-2">
                        <DialogTitle className="flex items-center gap-2">
                            <Camera className="h-5 w-5 text-primary" />
                            {label}
                        </DialogTitle>
                        <DialogDescription>
                            Position the subject in the frame and click Capture
                        </DialogDescription>
                    </DialogHeader>

                    <div className="relative bg-black">
                        {/* Camera Loading */}
                        {loading && (
                            <div className="flex items-center justify-center h-80 text-white">
                                <div className="text-center space-y-3">
                                    <Loader2 className="h-10 w-10 animate-spin mx-auto" />
                                    <p className="text-sm">Starting camera...</p>
                                </div>
                            </div>
                        )}

                        {/* Camera Error */}
                        {cameraError && (
                            <div className="flex items-center justify-center h-80 text-white">
                                <div className="text-center space-y-3 px-6">
                                    <X className="h-10 w-10 mx-auto text-red-400" />
                                    <p className="text-sm text-red-300">{cameraError}</p>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={startCamera}
                                        className="text-white border-white/30 hover:bg-white/10"
                                    >
                                        Try Again
                                    </Button>
                                </div>
                            </div>
                        )}

                        {/* Live Video Feed */}
                        <video
                            ref={videoRef}
                            autoPlay
                            playsInline
                            muted
                            className={`w-full max-h-[60vh] object-contain ${loading || cameraError || capturedImage ? "hidden" : ""
                                }`}
                        />

                        {/* Captured Preview */}
                        {capturedImage && (
                            <img
                                src={capturedImage}
                                alt="Captured"
                                className="w-full max-h-[60vh] object-contain"
                            />
                        )}

                        {/* Hidden canvas for capture */}
                        <canvas ref={canvasRef} className="hidden" />
                    </div>

                    {/* Action Buttons */}
                    <div className="p-4 flex justify-center gap-3">
                        {!capturedImage && !cameraError && (
                            <Button
                                onClick={capturePhoto}
                                disabled={loading}
                                size="lg"
                                className="gap-2 bg-primary hover:bg-primary/90 min-w-[160px]"
                            >
                                <Camera className="h-5 w-5" />
                                Capture
                            </Button>
                        )}
                        {capturedImage && (
                            <>
                                <Button
                                    variant="outline"
                                    onClick={retakePhoto}
                                    size="lg"
                                    className="gap-2"
                                >
                                    <RotateCcw className="h-5 w-5" />
                                    Retake
                                </Button>
                                <Button
                                    onClick={confirmCapture}
                                    size="lg"
                                    className="gap-2 bg-green-600 hover:bg-green-700 min-w-[160px]"
                                >
                                    <Check className="h-5 w-5" />
                                    Use This Photo
                                </Button>
                            </>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
};

export default CameraCapture;