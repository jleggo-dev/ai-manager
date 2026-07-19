/* ════════════════════════════════════════════════════════════════
   §5.3 Equipment (with shoe mileage)
   ════════════════════════════════════════════════════════════════ */

export type EquipmentCategory =
  | 'footwear'
  | 'cardio'
  | 'strength'
  | 'accessory'
  | 'reading'
  | 'practice' // a mat, cushion, instrument — things a mind/practice goal is done with
  | 'craft' // art/creative supplies
  | 'study' // learning materials, courses
  | 'other';

export interface EquipmentWear {
  tracks_mileage: boolean;
  accumulated_km: number;
  threshold_km: number;
  auto_sum_from: 'healthkit_runs' | string;
  status: 'active' | 'retire_soon' | 'retired';
}

export interface Equipment {
  equipment_id: string;
  name: string;
  category: EquipmentCategory;
  owned: boolean;
  recommended_by: 'ai' | null;
  linked_goal_ids: string[];
  wear?: EquipmentWear; // footwear only
}
