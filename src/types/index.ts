export interface Profile {
  id: string;
  full_name: string;
  student_id: string;
  department: string;
  year_of_study: string;
  role?: 'student' | 'admin';
  avatar_url?: string;
  created_at: string;
  eco_credits?: number; // computed balance
}

export interface Bin {
  id: string;
  label: string;
  location_name: string;
  category: 'Recyclable' | 'Organic' | 'E-Waste' | 'Glass' | 'Plastic' | 'Paper' | 'All';
  latitude: number;
  longitude: number;
  qr_code: string;
  status: 'active' | 'full' | 'maintenance';
  fill_percentage: number;
  created_at: string;
  distance_m?: number; // computed distance
}

export interface WasteDisposal {
  id: string;
  student_id: string;
  bin_id: string;
  waste_category: 'Recyclable' | 'Organic' | 'E-Waste' | 'Glass' | 'Paper' | 'Hazardous' | 'Non-Recyclable';
  ai_confidence: number;
  image_url?: string;
  credits_awarded: number;
  status: 'pending_verification' | 'verified' | 'rejected';
  created_at: string;
  verified_at?: string;
  bin_label?: string;
  bin_location?: string;
}

export interface WalletTransaction {
  id: string;
  student_id: string;
  type: 'credited' | 'redeemed';
  amount: number;
  description: string;
  related_disposal_id?: string;
  status: 'completed' | 'pending' | 'failed';
  created_at: string;
}

export interface Reward {
  id: string;
  name: string;
  description: string;
  cost_credits: number;
  category: string;
  active: boolean;
  image_url: string;
  created_at: string;
}

export interface RewardRedemption {
  id: string;
  student_id: string;
  reward_id: string;
  redemption_code: string;
  status: 'pending' | 'completed' | 'cancelled';
  created_at: string;
  reward?: Reward;
}

export interface BoundingBoxDetection {
  class_name: string;
  confidence: number;
  bbox?: [number, number, number, number];
  normalized_bbox?: [number, number, number, number];
  category: string;
}

export interface ClassificationResult {
  success?: boolean;
  is_waste?: boolean;
  category: 'Recyclable' | 'Organic' | 'E-Waste' | 'Glass' | 'Paper' | 'Hazardous' | 'Non-Recyclable';
  confidence: number;
  item_name: string;
  description: string;
  recommended_bin_category: string;
  reason?: 'person_detected' | 'low_confidence' | 'image_blurry' | 'poor_lighting_dark' | 'poor_lighting_overexposed' | 'service_unavailable' | 'invalid_payload' | 'service_error' | string;
  message?: string;
  rejection_reason?: string;
  primary_detection?: BoundingBoxDetection;
  detections?: BoundingBoxDetection[];
  model?: string;
  inference_time_ms?: number;
  server_notice?: string;
}

export interface LeaderboardStudent {
  rank: number;
  id: string;
  name: string;
  student_id: string;
  department: string;
  credits: number;
  disposals_count: number;
  avatar_url?: string;
  is_current_user?: boolean;
}

export interface LeaderboardDept {
  rank: number;
  department: string;
  total_credits: number;
  total_disposals: number;
  active_students: number;
}
