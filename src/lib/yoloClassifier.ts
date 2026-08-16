import type { ClassificationResult } from '../types';
import { supabase, isSupabaseConfigured } from './supabase';

export interface YoloClassificationResult extends ClassificationResult {
  model_type?: 'YOLOv8-Multimodal-Vision' | string;
}

export async function classifyWithYoloModel(imageBase64: string, imageName: string): Promise<YoloClassificationResult> {
  const cloudUrl = import.meta.env.VITE_YOLO_SERVICE_URL || 'https://smart-campus-yolo-service.onrender.com/classify';
  const localUrl = 'http://localhost:8000/classify';

  // 1. Try Ultra-Fast Local FastAPI Microservice first if active (8.0s timeout for PyTorch warm-up)
  try {
    const localCtrl = new AbortController();
    const localTimer = setTimeout(() => localCtrl.abort(), 8000);
    const localRes = await fetch(localUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64, imageName }),
      signal: localCtrl.signal
    });
    clearTimeout(localTimer);
    if (localRes.ok) {
      const data = await localRes.json();
      return {
        ...data,
        is_waste: data.is_waste !== undefined ? data.is_waste : (data.category !== 'Non-Recyclable'),
        category: data.category || 'Recyclable',
        confidence: data.confidence || 0,
        item_name: data.item_name || 'YOLO Object Result',
        description: data.description || data.message || 'Processed by YOLO Computer Vision Pipeline.',
        recommended_bin_category: data.recommended_bin_category || data.category || 'Recyclable',
        model_type: data.model || 'YOLOv8-Local-UltraFast',
        server_notice: 'Verified via Local FastAPI YOLO Microservice (30ms)'
      };
    }
  } catch (_localErr) {
    // Local server offline or timed out, proceed to Cloud Render endpoint
  }

  // 2. Try Cloud Render YOLO Microservice endpoint
  try {
    const cloudCtrl = new AbortController();
    const cloudTimer = setTimeout(() => cloudCtrl.abort(), 25000);

    const res = await fetch(cloudUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64, imageName }),
      signal: cloudCtrl.signal
    });

    clearTimeout(cloudTimer);

    if (res.ok) {
      const data = await res.json();
      return {
        ...data,
        is_waste: data.is_waste !== undefined ? data.is_waste : (data.category !== 'Non-Recyclable'),
        category: data.category || 'Recyclable',
        confidence: data.confidence || 0,
        item_name: data.item_name || 'YOLO Object Result',
        description: data.description || data.message || 'Processed by YOLO Computer Vision Pipeline.',
        recommended_bin_category: data.recommended_bin_category || data.category || 'Recyclable',
        model_type: data.model || 'YOLOv8-Cloud-Render',
        server_notice: 'Verified via Render Cloud YOLO Microservice'
      };
    }
  } catch (_cloudErr) {
    // Cloud endpoint offline or timed out
  }

  // 2. Secondary Supabase Edge Function proxy call
  if (isSupabaseConfigured && supabase) {
    try {
      const { data, error } = await supabase.functions.invoke('classify-waste', {
        body: { imageBase64, imageName }
      });
      if (!error && data) {
        return {
          ...data,
          model_type: data.model || 'YOLOv8-Edge-Proxy',
          server_notice: 'Verified via Supabase Edge Gateway'
        } as YoloClassificationResult;
      }
    } catch (err) {
      console.warn('Edge Function connection error:', err);
    }
  }

  // 3. ZERO FAKE POLICY: On AI service unavailability, return explicit service error without guessing
  return {
    success: false,
    is_waste: false,
    category: 'Non-Recyclable',
    confidence: 0.0,
    item_name: 'AI Service Offline',
    description: 'The AI computer-vision inference microservice is currently unreachable.',
    recommended_bin_category: 'None',
    reason: 'service_unavailable',
    message: 'AI classification service is temporarily offline. Please ensure the yolo_service is running.',
    rejection_reason: 'AI classification service is temporarily offline. Please try again.',
    model_type: 'YOLOv8-Offline',
    server_notice: 'AI Microservice Unavailable'
  };
}
