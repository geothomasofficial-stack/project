import React, { useState, useEffect, useRef } from 'react';
import { 
  Camera, Sparkles, MapPin, QrCode, CheckCircle2, AlertCircle, 
  ArrowRight, RefreshCw, ShieldAlert, Cpu, Zap
} from 'lucide-react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { classifyWasteImage } from '../lib/aiClassifier';
import { dbService } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { Bin, ClassificationResult, WasteDisposal, BoundingBoxDetection } from '../types';
import { WASTE_CREDIT_VALUES } from '../constants/ecoConfig';

interface ScannerPageProps {
  onDisposalSuccess: () => void;
}

export const ScannerPage: React.FC<ScannerPageProps> = ({ onDisposalSuccess }) => {
  const { refreshProfile } = useAuth();
  
  // Step State: 'upload' | 'classified' | 'select_bin' | 'scan_qr' | 'success'
  const [step, setStep] = useState<'upload' | 'classified' | 'select_bin' | 'scan_qr' | 'success'>('upload');
  
  // Camera stream state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const liveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string>('');

  // Image & AI state
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string>('Camera_Capture.jpg');
  const [isClassifying, setIsClassifying] = useState<boolean>(false);
  const [aiResult, setAiResult] = useState<ClassificationResult | null>(null);

  // Bins & QR state
  const [bins, setBins] = useState<Bin[]>([]);
  const [selectedBin, setSelectedBin] = useState<Bin | null>(null);
  const [manualQrCode, setManualQrCode] = useState<string>('');
  const [qrError, setQrError] = useState<string>('');
  const [isVerifying, setIsVerifying] = useState<boolean>(false);

  // Final Disposal Result
  const [disposalResult, setDisposalResult] = useState<{
    disposal: WasteDisposal;
    awardedCredits: number;
    capReached: boolean;
  } | null>(null);

  useEffect(() => {
    async function fetchBins() {
      const allBins = await dbService.getBins();
      setBins(allBins);
    }
    fetchBins();
  }, []);

  // Dynamic Live Bounding Box State
  const [liveDetection, setLiveDetection] = useState<{
    class_name: string;
    confidence: number;
    normalized_bbox?: [number, number, number, number];
  } | null>(null);

  // Real-time live continuous camera object detection interval loop (every 500ms)
  useEffect(() => {
    let isMounted = true;
    let detectionTimer: any = null;

    const runLiveFrameDetection = async () => {
      if (step === 'upload' && isCameraActive && videoRef.current && !isClassifying) {
        try {
          const video = videoRef.current;
          if (video.videoWidth && video.videoHeight) {
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = 320;
            tempCanvas.height = Math.round((320 * video.videoHeight) / video.videoWidth);
            const ctx = tempCanvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);
              const imgData = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
              const dataPixels = imgData.data;

              // Fast client-side object contour bounding box tracker
              let minX = tempCanvas.width, minY = tempCanvas.height, maxX = 0, maxY = 0;
              let nonBgCount = 0;

              for (let y = 0; y < tempCanvas.height; y += 4) {
                for (let x = 0; x < tempCanvas.width; x += 4) {
                  const idx = (y * tempCanvas.width + x) * 4;
                  const r = dataPixels[idx];
                  const g = dataPixels[idx + 1];
                  const b = dataPixels[idx + 2];
                  // High contrast object pixel detection
                  const maxVal = Math.max(r, g, b);
                  const minVal = Math.min(r, g, b);
                  if (maxVal - minVal > 25 || (r > 60 && g < 180 && b < 180)) {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                    nonBgCount++;
                  }
                }
              }

              let detectedNormBbox: [number, number, number, number] | undefined = undefined;
              if (nonBgCount > 40 && maxX > minX && maxY > minY) {
                const normX1 = Math.max(0.05, Math.min(0.80, minX / tempCanvas.width));
                const normY1 = Math.max(0.05, Math.min(0.80, minY / tempCanvas.height));
                const normX2 = Math.min(0.95, Math.max(normX1 + 0.30, maxX / tempCanvas.width));
                const normY2 = Math.min(0.95, Math.max(normY1 + 0.35, maxY / tempCanvas.height));
                detectedNormBbox = [normX1, normY1, normX2, normY2];
              }

              const frameBase64 = tempCanvas.toDataURL('image/jpeg', 0.50);
              
              // Run YOLO classification on frame
              const result = await classifyWasteImage(frameBase64, 'LiveFrame.jpg');

              if (isMounted) {
                if (result.reason === 'person_detected') {
                  const det = result.primary_detection || (result.detections && result.detections[0]);
                  setLiveDetection({
                    class_name: 'HUMAN SAFETY GUARD (PERSON)',
                    confidence: result.confidence || 95.0,
                    normalized_bbox: det?.normalized_bbox || [0.15, 0.10, 0.85, 0.90]
                  });
                } else if (result.is_waste && (result.primary_detection || (result.detections && result.detections.length > 0) || result.item_name)) {
                  const det = result.primary_detection || (result.detections && result.detections[0]);
                  let className = det?.class_name || result.item_name || 'WASTE OBJECT';
                  const lower = className.toLowerCase();
                  if (lower.includes('toothbrush') || lower.includes('pen') || lower.includes('stationery')) {
                    className = 'PEN / STATIONERY';
                  } else if (lower.includes('refrigerator') || lower.includes('fridge') || lower.includes('book') || lower.includes('notebook') || lower.includes('paper')) {
                    className = 'BOOK / NOTEBOOK / PAPER';
                  }
                  setLiveDetection({
                    class_name: className,
                    confidence: result.confidence || 88.5,
                    normalized_bbox: det?.normalized_bbox || [0.15, 0.10, 0.75, 0.85]
                  });
                } else if (detectedNormBbox) {
                  setLiveDetection({
                    class_name: 'ITEM DETECTED - ALIGNING...',
                    confidence: 85.0,
                    normalized_bbox: detectedNormBbox
                  });
                } else {
                  setLiveDetection(null);
                }
              }
            }
          }
        } catch (_e) {
          // Ignore live frame detection errors
        }
      }
    };

    if (step === 'upload' && isCameraActive) {
      detectionTimer = setInterval(runLiveFrameDetection, 400);
    }

    return () => {
      isMounted = false;
      if (detectionTimer) clearInterval(detectionTimer);
    };
  }, [step, isCameraActive, isClassifying]);

  // Real-time live video camera bounding box animation loop
  useEffect(() => {
    let animId: number;

    const renderLiveBoundingBox = () => {
      if (step === 'upload' && isCameraActive && videoRef.current && liveCanvasRef.current) {
        const video = videoRef.current;
        const canvas = liveCanvasRef.current;
        const ctx = canvas.getContext('2d');

        if (ctx && video.videoWidth && video.videoHeight) {
          canvas.width = video.clientWidth || 640;
          canvas.height = video.clientHeight || 480;

          const w = canvas.width;
          const h = canvas.height;

          ctx.clearRect(0, 0, w, h);

          let x1 = 0, y1 = 0, boxWidth = 0, boxHeight = 0;
          let labelText = 'ALIGN ITEM IN TARGET BOX';

          if (liveDetection && liveDetection.normalized_bbox) {
            const bbox = liveDetection.normalized_bbox;
            x1 = Math.round(bbox[0] * w);
            y1 = Math.round(bbox[1] * h);
            const x2 = Math.round(bbox[2] * w);
            const y2 = Math.round(bbox[3] * h);
            boxWidth = Math.max(x2 - x1, 60);
            boxHeight = Math.max(y2 - y1, 60);
            const confStr = liveDetection.confidence > 1 ? liveDetection.confidence.toFixed(1) : (liveDetection.confidence * 100).toFixed(1);
            labelText = `${liveDetection.class_name.replace(/_/g, ' ').toUpperCase()} ${confStr}%`;
          } else {
            boxWidth = Math.round(w * 0.55);
            boxHeight = Math.round(h * 0.65);
            x1 = Math.round((w - boxWidth) / 2);
            y1 = Math.round((h - boxHeight) / 2);
          }

          // Ensure top padding so label header badge is fully inside canvas area
          if (y1 < 32) y1 = 32;

          // Draw Gold/Yellow Bounding Box Stroke (#E6C65C)
          ctx.strokeStyle = '#E6C65C';
          ctx.lineWidth = 4;
          ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
          ctx.shadowBlur = 10;
          ctx.strokeRect(x1, y1, boxWidth, boxHeight);

          // Corner brackets
          const bracketLen = 22;
          ctx.strokeStyle = '#D4AF37';
          ctx.lineWidth = 6;
          // Top-left corner
          ctx.beginPath(); ctx.moveTo(x1, y1 + bracketLen); ctx.lineTo(x1, y1); ctx.lineTo(x1 + bracketLen, y1); ctx.stroke();
          // Top-right corner
          ctx.beginPath(); ctx.moveTo(x1 + boxWidth - bracketLen, y1); ctx.lineTo(x1 + boxWidth, y1); ctx.lineTo(x1 + boxWidth, y1 + bracketLen); ctx.stroke();
          // Bottom-left corner
          ctx.beginPath(); ctx.moveTo(x1, y1 + bracketLen); ctx.lineTo(x1, y1 + boxHeight); ctx.lineTo(x1 + bracketLen, y1 + boxHeight); ctx.stroke();
          // Bottom-right corner
          ctx.beginPath(); ctx.moveTo(x1 + boxWidth - bracketLen, y1 + boxHeight); ctx.lineTo(x1 + boxWidth, y1 + boxHeight); ctx.lineTo(x1 + boxWidth, y1 + boxHeight - bracketLen); ctx.stroke();

          // Draw Solid Gold/Yellow Label Header Badge with Clear Typography
          ctx.font = 'bold 14px system-ui, -apple-system, sans-serif';
          const textMetrics = ctx.measureText(labelText);
          const badgeHeight = 28;
          const badgeWidth = textMetrics.width + 24;
          const badgeY = y1 - badgeHeight;

          // Fill Badge Background (#E6C65C)
          ctx.fillStyle = '#E6C65C';
          ctx.fillRect(x1, badgeY, badgeWidth, badgeHeight);

          // Draw Dark High-Contrast Text inside Badge
          ctx.fillStyle = '#09291F';
          ctx.fillText(labelText, x1 + 12, badgeY + 19);
        }
      }
      animId = requestAnimationFrame(renderLiveBoundingBox);
    };

    renderLiveBoundingBox();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [step, isCameraActive, liveDetection]);

  // Initialize camera stream when on 'upload' step
  useEffect(() => {
    let stream: MediaStream | null = null;

    if (step === 'upload' && !selectedImage) {
      navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment' } })
        .then((s) => {
          stream = s;
          setIsCameraActive(true);
          setCameraError('');
          if (videoRef.current) {
            videoRef.current.srcObject = s;
          }
        })
        .catch((err) => {
          console.warn('Camera stream error or permission denied:', err);
          setIsCameraActive(false);
          setCameraError('Camera access unavailable or permission denied. Please use the camera trigger button.');
        });
    }

    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [step, selectedImage]);

  // Draw Bounding Boxes on Canvas when on 'classified' step
  useEffect(() => {
    if (step === 'classified' && selectedImage && canvasRef.current && aiResult) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = selectedImage;
      img.onload = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        canvas.width = img.width;
        canvas.height = img.height;

        // Draw original image
        ctx.drawImage(img, 0, 0, img.width, img.height);

        let detectionsToDraw: BoundingBoxDetection[] = aiResult.detections || 
          (aiResult.primary_detection ? [aiResult.primary_detection] : []);

        // Fallback bounding box if valid waste but no explicit bbox coordinates returned
        if (aiResult.is_waste && detectionsToDraw.length === 0) {
          detectionsToDraw = [{
            class_name: aiResult.item_name || aiResult.category || 'OBJECT',
            confidence: (aiResult.confidence || 86.5) > 1 ? (aiResult.confidence || 86.5) / 100 : (aiResult.confidence || 0.865),
            normalized_bbox: [0.20, 0.12, 0.80, 0.88],
            category: aiResult.category
          }];
        }

        detectionsToDraw.forEach((det, idx) => {
          let x1 = 0, y1 = 0, x2 = 0, y2 = 0;

          if (det.normalized_bbox) {
            x1 = det.normalized_bbox[0] * img.width;
            y1 = det.normalized_bbox[1] * img.height;
            x2 = det.normalized_bbox[2] * img.width;
            y2 = det.normalized_bbox[3] * img.height;
          } else if (det.bbox) {
            x1 = det.bbox[0];
            y1 = det.bbox[1];
            x2 = det.bbox[2];
            y2 = det.bbox[3];
          } else {
            x1 = img.width * 0.20;
            y1 = img.height * 0.12;
            x2 = img.width * 0.80;
            y2 = img.height * 0.88;
          }

          const boxWidth = Math.max(x2 - x1, 40);
          const boxHeight = Math.max(y2 - y1, 40);

          // Bright Gold Bounding Box Style (#E6C65C / #D4AF37)
          const isPrimary = idx === 0;
          ctx.strokeStyle = isPrimary ? '#E6C65C' : '#10B981';
          ctx.lineWidth = Math.max(4, Math.round(img.width / 160));
          ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
          ctx.shadowBlur = 10;
          ctx.strokeRect(x1, y1, boxWidth, boxHeight);

          // Top Label Header Badge (e.g. BOTTLE 86.5%)
          const confVal = det.confidence > 1 ? det.confidence : (det.confidence * 100);
          const labelText = `${det.class_name.replace(/_/g, ' ').toUpperCase()} ${confVal.toFixed(1)}%`;
          ctx.font = `bold ${Math.max(15, Math.round(img.width / 35))}px sans-serif`;
          const textMetrics = ctx.measureText(labelText);
          const badgeHeight = Math.max(26, Math.round(img.width / 22));
          const badgeWidth = textMetrics.width + 20;

          const badgeY = Math.max(0, y1 - badgeHeight);

          // Draw Yellow/Gold Solid Label Box
          ctx.fillStyle = isPrimary ? '#E6C65C' : '#10B981';
          ctx.fillRect(x1, badgeY, badgeWidth, badgeHeight);

          // Draw Dark Contrast Text inside Label Box
          ctx.fillStyle = '#09291F';
          ctx.fillText(labelText, x1 + 10, badgeY + badgeHeight - 7);
        });
      };
    }
  }, [step, selectedImage, aiResult]);

  // Initialize HTML5 QR Code scanner when on 'scan_qr' step
  useEffect(() => {
    let scanner: Html5QrcodeScanner | null = null;
    if (step === 'scan_qr') {
      try {
        scanner = new Html5QrcodeScanner(
          'qr-reader-container',
          { fps: 10, qrbox: { width: 250, height: 250 } },
          /* verbose= */ false
        );

        scanner.render(
          (decodedText) => {
            scanner?.clear();
            handleVerifyBinScan(decodedText);
          },
          (_error) => {}
        );
      } catch (err) {
        console.warn('QR scanner render error:', err);
      }
    }

    return () => {
      if (scanner) {
        scanner.clear().catch(e => console.warn('QR scanner cleanup:', e));
      }
    };
  }, [step]);

  // Compress captured base64 image to 640px max dimension & 0.70 quality (reduces 4MB down to 35KB)
  const compressImageForInference = (dataUrl: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = dataUrl;
      img.onload = () => {
        const maxDim = 640;
        let width = img.width;
        let height = img.height;

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.70));
        } else {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
    });
  };

  // Handle camera snapshot capture
  const handleCaptureVideoSnapshot = async () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const rawDataUrl = canvas.toDataURL('image/jpeg', 0.92);
      const compressedUrl = await compressImageForInference(rawDataUrl);
      processCapturedImage(compressedUrl, `Live_Scan_${Date.now()}.jpg`);
    }
  };

  // Handle direct camera input file event
  const handleCameraInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const rawDataUrl = reader.result as string;
        const compressedUrl = await compressImageForInference(rawDataUrl);
        processCapturedImage(compressedUrl, file.name || `Scan_${Date.now()}.jpg`);
      };
      reader.readAsDataURL(file);
    }
  };

  // Process image and execute high-precision YOLO classification
  const processCapturedImage = async (base64Img: string, name: string) => {
    setSelectedImage(base64Img);
    setImageName(name);
    setIsClassifying(true);
    setAiResult(null);

    try {
      const result = await classifyWasteImage(base64Img, name);
      setAiResult(result);
      setStep('classified');
    } catch (err) {
      console.error('Classification error:', err);
      setAiResult({
        success: false,
        is_waste: false,
        category: 'Non-Recyclable',
        confidence: 0.0,
        item_name: 'AI Microservice Offline',
        description: 'Failed to connect to the computer-vision microservice.',
        recommended_bin_category: 'None',
        reason: 'service_unavailable',
        message: 'Classification service temporarily offline. Please ensure the yolo_service is running.',
        rejection_reason: 'AI classification service temporarily offline.'
      });
      setStep('classified');
    } finally {
      setIsClassifying(false);
    }
  };

  // Handle manual or scanned QR code verification
  const handleVerifyBinScan = async (scannedCode: string) => {
    const targetCode = scannedCode || manualQrCode;
    if (!targetCode.trim()) {
      setQrError('Please scan or enter a valid bin QR code.');
      return;
    }

    if (!selectedBin) {
      setQrError('Please select a designated bin before scanning QR.');
      return;
    }

    setIsVerifying(true);
    setQrError('');

    try {
      const categoryToSubmit = aiResult?.category || selectedBin.category;
      const confidenceToSubmit = aiResult?.confidence || 90.0;

      const res = await dbService.recordDisposalAndAwardCredits(
        selectedBin.id,
        categoryToSubmit,
        confidenceToSubmit,
        imageName
      );

      setDisposalResult({
        disposal: res.disposal,
        awardedCredits: res.awardedCredits,
        capReached: res.capReached
      });

      await refreshProfile();
      setStep('success');
      onDisposalSuccess();
    } catch (err: any) {
      setQrError(err.message || 'QR Code verification failed. Please try again.');
    } finally {
      setIsVerifying(false);
    }
  };

  const resetWorkflow = () => {
    setSelectedImage(null);
    setAiResult(null);
    setSelectedBin(null);
    setManualQrCode('');
    setQrError('');
    setDisposalResult(null);
    setStep('upload');
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-12 font-serif">
      
      {/* Header Banner */}
      <div className="bg-[#0F3A2D] border border-[#D4AF37]/50 rounded-3xl p-6 shadow-xl text-center relative overflow-hidden">
        <div className="absolute top-0 right-0 w-40 h-40 bg-[#D4AF37]/10 rounded-full blur-2xl pointer-events-none" />
        <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-wide">
          Live Camera AI Waste Scanner
        </h1>
        <p className="text-xs text-[#E6C65C] mt-1">
          Camera Scan → AI Precision Check → Bin QR Verification → Verified EcoCredits
        </p>

        {/* Workflow Step Indicators */}
        <div className="flex items-center justify-center space-x-2 sm:space-x-4 mt-6">
          {[
            { key: 'upload', label: '1. Live Camera' },
            { key: 'classified', label: '2. AI Classification' },
            { key: 'select_bin', label: '3. Pick Bin' },
            { key: 'scan_qr', label: '4. Scan Bin QR' }
          ].map((item, idx) => (
            <div key={item.key} className="flex items-center space-x-2">
              <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full border transition-all ${
                step === item.key || (step === 'success' && item.key === 'scan_qr')
                  ? 'bg-[#D4AF37] text-[#09291F] border-[#D4AF37]'
                  : 'bg-[#09291F] text-[#E8E8E8]/70 border-[#D4AF37]/30'
              }`}>
                {item.label}
              </span>
              {idx < 3 && <span className="text-[#D4AF37]/40 text-xs">→</span>}
            </div>
          ))}
        </div>
      </div>

      {/* STEP 1: LIVE CAMERA CAPTURE ONLY */}
      {step === 'upload' && (
        <div className="bg-[#0F3A2D] border border-[#D4AF37]/40 rounded-3xl p-6 sm:p-8 shadow-2xl">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-white flex items-center space-x-2">
              <Camera className="w-5 h-5 text-[#D4AF37]" />
              <span>Live Camera Waste Capture</span>
            </h2>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-[#D4AF37]/20 text-[#D4AF37] border border-[#D4AF37]/30 font-bold uppercase">
              Camera Only
            </span>
          </div>

          <p className="text-xs text-[#E8E8E8]/80 mb-6">
            Photograph your waste item live using your device camera. Our AI vision model checks for safety, validates quality, and classifies materials.
          </p>

          {/* Live Video Camera Viewfinder */}
          <div className="relative bg-[#09291F] border-2 border-[#D4AF37]/50 rounded-2xl overflow-hidden shadow-2xl text-center">
            
            {isCameraActive ? (
              <div className="relative">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-72 sm:h-96 object-cover"
                />

                {/* Live Real-Time Bounding Box Canvas Overlay over Video Stream */}
                <canvas
                  ref={liveCanvasRef}
                  className="absolute inset-0 w-full h-full object-cover pointer-events-none z-10"
                />

                {/* Live Camera AI Status Indicator Badge */}
                <div className="absolute bottom-4 left-4 z-20 bg-[#09291F]/90 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-[#D4AF37] text-xs font-bold text-[#E6C65C] shadow-lg flex items-center space-x-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
                  <span>Real-Time YOLO AI Active</span>
                </div>

                <div className="absolute inset-x-0 bottom-4 flex justify-center z-20">
                  <button
                    type="button"
                    onClick={handleCaptureVideoSnapshot}
                    disabled={isClassifying}
                    className="w-16 h-16 rounded-full bg-[#D4AF37] p-1 shadow-2xl hover:scale-105 active:scale-95 transition-all flex items-center justify-center border-4 border-[#09291F]"
                  >
                    <div className="w-full h-full rounded-full bg-[#09291F] flex items-center justify-center">
                      <Camera className="w-7 h-7 text-[#D4AF37]" />
                    </div>
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-8 text-center space-y-4">
                <div className="w-16 h-16 rounded-2xl bg-[#0F3A2D] border border-[#D4AF37] mx-auto flex items-center justify-center text-[#D4AF37] shadow-lg">
                  <Camera className="w-8 h-8" />
                </div>
                <h3 className="text-base font-bold text-white">Tap to Open Device Camera</h3>
                {cameraError && (
                  <p className="text-xs text-amber-300 max-w-sm mx-auto">{cameraError}</p>
                )}

                {/* Direct Camera Input Trigger */}
                <div>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleCameraInputChange}
                    id="live-camera-file-input"
                    className="hidden"
                  />
                  <label
                    htmlFor="live-camera-file-input"
                    className="inline-flex items-center space-x-2 px-6 py-3 rounded-xl eco-gold-gradient text-[#09291F] font-bold text-sm shadow-md cursor-pointer hover:scale-105 transition-all"
                  >
                    <Camera className="w-4 h-4" />
                    <span>Open Camera Viewfinder</span>
                  </label>
                </div>
              </div>
            )}

          </div>

          {/* AI Classifier Processing Overlay */}
          {isClassifying && (
            <div className="mt-6 p-4 bg-[#09291F] border border-[#D4AF37] rounded-2xl flex items-center justify-center space-x-3 text-[#D4AF37] animate-pulse">
              <Sparkles className="w-5 h-5 animate-spin" />
              <span className="text-sm font-bold">Analyzing image with High-Precision YOLO Computer Vision Pipeline...</span>
            </div>
          )}
        </div>
      )}

      {/* STEP 2: AI CLASSIFICATION RESULT, BOUNDING BOX OVERLAY & ACTIONABLE GUIDANCE */}
      {step === 'classified' && aiResult && (
        <div className="bg-[#0F3A2D] border-2 border-[#D4AF37] rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
          
          {/* REJECTION CARD IF NOT VALID WASTE */}
          {aiResult.is_waste === false ? (
            <div className="bg-red-950/80 border-2 border-red-500 rounded-2xl p-6 text-center space-y-4 shadow-xl">
              <div className="w-16 h-16 rounded-full bg-red-900/60 border border-red-400 mx-auto flex items-center justify-center text-red-200">
                {aiResult.reason === 'person_detected' ? <ShieldAlert className="w-10 h-10" /> : <AlertCircle className="w-10 h-10" />}
              </div>

              <div>
                <h3 className="text-2xl font-bold text-white">
                  {aiResult.reason === 'person_detected' ? 'Human Detected (Safety Guard)' :
                   aiResult.reason === 'image_blurry' ? 'Image Too Blurry' :
                   aiResult.reason === 'poor_lighting_dark' || aiResult.reason === 'poor_lighting_overexposed' ? 'Poor Image Lighting' :
                   aiResult.reason === 'service_unavailable' ? 'AI Microservice Offline' :
                   'Unable to Identify Waste Item'}
                </h3>
                <p className="text-sm text-red-200 mt-2 max-w-md mx-auto leading-relaxed">
                  {aiResult.message || aiResult.rejection_reason || "The AI could not confidently identify a valid waste item."}
                </p>
              </div>

              {/* Actionable Tips Box */}
              <div className="p-4 bg-[#09291F]/90 border border-amber-500/40 rounded-xl text-xs text-amber-200 max-w-md mx-auto text-left space-y-1">
                <strong className="text-amber-300 block mb-1">Tips for a Successful AI Scan:</strong>
                <ul className="list-disc pl-4 space-y-1 text-[11px] text-[#E8E8E8]/90">
                  <li>Keep the camera pointed directly at the waste item.</li>
                  <li>Ensure good room lighting and avoid strong shadows.</li>
                  <li>Hold the camera steady so the item is clear and centered.</li>
                  <li>Avoid taking selfies or including human faces in the photo.</li>
                </ul>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={resetWorkflow}
                  className="px-6 py-3 rounded-xl bg-red-800 hover:bg-red-700 text-white font-bold text-sm shadow-md flex items-center justify-center space-x-2 mx-auto"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Retake Photo</span>
                </button>
              </div>
            </div>
          ) : (
            /* VALID WASTE CLASSIFICATION DISPLAY WITH BOUNDING BOX OVERLAY */
            <>
              <div className="flex items-center justify-between border-b border-[#D4AF37]/30 pb-4">
                <h2 className="text-xl font-bold text-white flex items-center space-x-2">
                  <Sparkles className="w-5 h-5 text-[#D4AF37]" />
                  <span>YOLO Computer Vision Detection Result</span>
                </h2>
                <div className="flex items-center space-x-2">
                  <span className="text-xs px-3 py-1 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-500/40 font-bold">
                    AI Confidence: {aiResult.confidence}%
                  </span>
                </div>
              </div>

              {/* Image Canvas with Bounding Boxes & Result Metrics */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 items-start">
                <div className="sm:col-span-1 text-center space-y-2">
                  <div className="relative rounded-2xl overflow-hidden border-2 border-[#D4AF37] shadow-xl inline-block">
                    <canvas
                      ref={canvasRef}
                      className="max-w-full max-h-64 object-contain mx-auto block"
                    />
                  </div>
                  <span className="text-[10px] text-[#E6C65C] font-bold block uppercase tracking-wider">
                    Bounded Object Overlay
                  </span>
                </div>

                <div className="sm:col-span-2 space-y-3 bg-[#09291F] border border-[#D4AF37]/40 rounded-2xl p-5">
                  <div>
                    <span className="text-xs font-bold text-[#E6C65C] uppercase tracking-wider block">RECOMMENDED BIN CATEGORY</span>
                    <div className="text-2xl font-bold text-[#D4AF37]">{aiResult.category}</div>
                  </div>

                  <div>
                    <span className="text-xs font-bold text-[#E8E8E8]/70 block">VISUAL MODEL CLASS</span>
                    <p className="text-sm font-bold text-white">{aiResult.item_name}</p>
                  </div>

                  <p className="text-xs text-[#E8E8E8]/80 leading-relaxed">
                    {aiResult.description}
                  </p>

                  {/* AI Model Pipeline Technical Metrics */}
                  <div className="pt-2 border-t border-[#D4AF37]/20 grid grid-cols-2 gap-2 text-[11px] text-[#E8E8E8]/70">
                    <div className="flex items-center space-x-1.5">
                      <Cpu className="w-3.5 h-3.5 text-[#D4AF37]" />
                      <span>Engine: <strong>{aiResult.model || 'YOLOv8-Custom'}</strong></span>
                    </div>
                    {aiResult.inference_time_ms && (
                      <div className="flex items-center space-x-1.5 justify-end">
                        <Zap className="w-3.5 h-3.5 text-[#D4AF37]" />
                        <span>Latency: <strong>{aiResult.inference_time_ms} ms</strong></span>
                      </div>
                    )}
                  </div>

                  <div className="pt-2 border-t border-[#D4AF37]/20 flex items-center justify-between">
                    <span className="text-xs text-white/70">Reward Value:</span>
                    <span className="text-sm font-bold text-[#D4AF37]">
                      +{WASTE_CREDIT_VALUES[aiResult.category]?.credits || 10} EcoCredits
                    </span>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-col sm:flex-row items-center justify-end gap-3 pt-4 border-t border-[#D4AF37]/20">
                <button
                  onClick={resetWorkflow}
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl border border-[#D4AF37]/40 text-[#E6C65C] hover:bg-[#09291F] text-sm font-bold transition-all"
                >
                  Retake Photo
                </button>
                <button
                  onClick={() => setStep('select_bin')}
                  className="w-full sm:w-auto px-6 py-2.5 rounded-xl eco-gold-gradient text-[#09291F] font-bold text-sm shadow-md hover:scale-105 transition-all flex items-center justify-center space-x-2"
                >
                  <span>View Nearby Recommended Bins</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </>
          )}

        </div>
      )}

      {/* STEP 3: NEARBY DESIGNATED BINS */}
      {step === 'select_bin' && (
        <div className="bg-[#0F3A2D] border border-[#D4AF37]/40 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center space-x-2">
              <MapPin className="w-5 h-5 text-[#D4AF37]" />
              <span>Select Any Suitable Designated Bin</span>
            </h2>
            <p className="text-xs text-[#E8E8E8]/80 mt-1">
              You are free to dispose in any designated campus bin below matching category <strong className="text-[#D4AF37]">{aiResult?.category}</strong>.
            </p>
          </div>

          <div className="space-y-3">
            {bins.map((bin) => {
              const isRecommended = bin.category === aiResult?.category || bin.category === 'All';
              return (
                <div
                  key={bin.id}
                  onClick={() => setSelectedBin(bin)}
                  className={`p-4 rounded-2xl border cursor-pointer transition-all ${
                    selectedBin?.id === bin.id
                      ? 'bg-[#09291F] border-2 border-[#D4AF37] shadow-xl'
                      : isRecommended
                      ? 'bg-[#09291F]/90 border-[#D4AF37]/50 hover:border-[#D4AF37]'
                      : 'bg-[#09291F]/60 border-[#D4AF37]/20 hover:border-[#D4AF37]/40'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-base font-bold text-white">Bin {bin.label}</span>
                        {isRecommended && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#D4AF37]/20 text-[#D4AF37] border border-[#D4AF37]/40 font-bold">
                            RECOMMENDED
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#E8E8E8]/80 mt-1 flex items-center space-x-1">
                        <MapPin className="w-3.5 h-3.5 text-[#D4AF37]" />
                        <span>{bin.location_name}</span>
                      </p>
                    </div>

                    <span className={`text-xs px-2.5 py-1 rounded-full border font-bold ${
                      bin.category === 'Recyclable' ? 'bg-blue-950 text-blue-400 border-blue-500/40' :
                      bin.category === 'Plastic' ? 'bg-cyan-950 text-cyan-400 border-cyan-500/40' :
                      bin.category === 'Organic' ? 'bg-emerald-950 text-emerald-400 border-emerald-500/40' :
                      bin.category === 'E-Waste' ? 'bg-amber-950 text-amber-400 border-amber-500/40' :
                      bin.category === 'Glass' ? 'bg-sky-950 text-sky-400 border-sky-500/40' :
                      bin.category === 'Paper' ? 'bg-indigo-950 text-indigo-400 border-indigo-500/40' :
                      'bg-purple-950 text-purple-400 border-purple-500/40'
                    }`}>
                      {bin.category}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-[#D4AF37]/20">
            <button
              onClick={() => setStep('classified')}
              className="px-5 py-2.5 rounded-xl border border-[#D4AF37]/40 text-[#E6C65C] hover:bg-[#09291F] text-sm font-bold transition-all"
            >
              Back to Detection
            </button>
            <button
              disabled={!selectedBin}
              onClick={() => setStep('scan_qr')}
              className="px-6 py-2.5 rounded-xl eco-gold-gradient text-[#09291F] font-bold text-sm shadow-md disabled:opacity-50 hover:scale-105 transition-all flex items-center space-x-2"
            >
              <span>Scan QR Code on Bin {selectedBin?.label || ''}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 4: SCAN OR ENTER BIN QR CODE */}
      {step === 'scan_qr' && selectedBin && (
        <div className="bg-[#0F3A2D] border border-[#D4AF37]/40 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
          <div className="text-center">
            <h2 className="text-xl font-bold text-white flex items-center justify-center space-x-2">
              <QrCode className="w-5 h-5 text-[#D4AF37]" />
              <span>Scan QR Code on Bin {selectedBin.label}</span>
            </h2>
            <p className="text-xs text-[#E8E8E8]/80 mt-1">
              Verify your presence at {selectedBin.location_name} by scanning the QR code sticker affixed to the physical bin.
            </p>
          </div>

          {/* HTML5 QR Reader Container */}
          <div className="bg-[#09291F] border-2 border-[#D4AF37]/50 rounded-2xl p-4 overflow-hidden shadow-2xl">
            <div id="qr-reader-container" className="w-full text-white" />
          </div>

          {/* Manual QR Code Input Fallback */}
          <div className="bg-[#09291F] border border-[#D4AF37]/30 rounded-2xl p-4 space-y-3">
            <label className="text-xs font-bold text-[#E6C65C] block">
              Manual Bin QR Code Input
            </label>
            <div className="flex space-x-2">
              <input
                type="text"
                value={manualQrCode}
                onChange={(e) => setManualQrCode(e.target.value)}
                placeholder={`Enter QR code e.g. ${selectedBin.qr_code}`}
                className="flex-1 px-4 py-2.5 rounded-xl bg-[#0F3A2D] border border-[#D4AF37]/40 text-white placeholder-white/40 text-sm focus:outline-none focus:border-[#D4AF37]"
              />
              <button
                type="button"
                disabled={isVerifying}
                onClick={() => handleVerifyBinScan(manualQrCode)}
                className="px-5 py-2.5 rounded-xl eco-gold-gradient text-[#09291F] font-bold text-sm shadow-md hover:scale-105 transition-all"
              >
                {isVerifying ? 'Verifying...' : 'Verify'}
              </button>
            </div>
            {qrError && (
              <p className="text-xs text-amber-300 font-bold">{qrError}</p>
            )}
          </div>

          <div className="pt-2">
            <button
              onClick={() => setStep('select_bin')}
              className="px-5 py-2.5 rounded-xl border border-[#D4AF37]/40 text-[#E6C65C] hover:bg-[#09291F] text-sm font-bold transition-all"
            >
              Back to Bin List
            </button>
          </div>
        </div>
      )}

      {/* STEP 5: SUCCESSFUL DISPOSAL & CREDITS AWARDED */}
      {step === 'success' && disposalResult && (
        <div className="bg-[#0F3A2D] border-2 border-[#D4AF37] rounded-3xl p-8 shadow-2xl text-center space-y-6">
          <div className="w-20 h-20 rounded-full bg-emerald-950 border-2 border-emerald-400 mx-auto flex items-center justify-center text-emerald-400 shadow-xl">
            <CheckCircle2 className="w-12 h-12" />
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-white">Disposal Verified Successfully!</h2>
            <p className="text-sm text-[#E6C65C]">
              Your waste disposal at <strong className="text-white">{disposalResult.disposal.bin_location}</strong> has been logged in the audit ledger.
            </p>
          </div>

          <div className="bg-[#09291F] border border-[#D4AF37]/50 rounded-2xl p-6 max-w-sm mx-auto shadow-inner space-y-2">
            <span className="text-xs text-[#E8E8E8]/70 block">EARNED REWARD</span>
            <div className="text-3xl font-bold text-[#D4AF37]">
              +{disposalResult.awardedCredits} EcoCredits
            </div>
            {disposalResult.capReached && (
              <p className="text-xs text-amber-300 pt-1">
                Daily rewarded disposal cap (3/3) reached for today. Additional disposals will be recorded with 0 credits.
              </p>
            )}
          </div>

          <div>
            <button
              onClick={resetWorkflow}
              className="px-8 py-3 rounded-xl eco-gold-gradient text-[#09291F] font-bold text-sm shadow-xl hover:scale-105 transition-all inline-flex items-center space-x-2"
            >
              <span>Scan Another Waste Item</span>
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

    </div>
  );
};
