/** 殿宇：大木/小式结构、屋顶形制的单体文物建筑 */
export type StructureType = '大木' | '小式'
export type RoofType = '庑殿' | '歇山' | '悬山'

/** 殿宇处置状态：在册 → 修缮中 → 已移交（撤回时由已移交退回修缮中） */
export type DisposalStatus = '在册' | '修缮中' | '已移交'

/** 移交 / 撤回流转留痕，按时间先后排列 */
export interface HandoverRecord {
  type: 'handover' | 'withdraw'
  at: number
  /** 撤回时必填的漏项 / 退回原因；移交记录不含该字段 */
  reason?: string
}

export interface Hall {
  id: string
  name: string
  /** 始建年代，如「明嘉靖」 */
  era: string
  structureType: StructureType
  roofType: RoofType
  /** 处置状态：在册 / 修缮中 / 已移交 */
  disposalStatus: DisposalStatus
  /** 最近一次移交文管所的时间，撤回后保留为历史记录 */
  handoverAt: number | null
  /** 移交与撤回的流转留痕 */
  handoverRecords: HandoverRecord[]
  createdAt: number
  updatedAt: number
}

export const STRUCTURE_TYPES: StructureType[] = ['大木', '小式']
export const ROOF_TYPES: RoofType[] = ['庑殿', '歇山', '悬山']
export const DISPOSAL_STATUSES: DisposalStatus[] = ['在册', '修缮中', '已移交']

/** 殿宇列表卡片回显用的统计聚合值 */
export interface HallStat {
  hallId: string
  decayCount: number
  unrepairedCount: number
  elementCount: number
  layerCount: number
  /** 已修复病害占比，0-100 的整数 */
  repairedPercent: number
}

/** 移交前核对清单中的一条未修完病害 */
export interface HandoverPendingDecay {
  decay: import('./decay').Decay
  layer: import('./layer').PaintLayer | null
  element: import('./element').Element | null
}

/** 移交前核对清单中的一道未收尾工序 */
export interface HandoverPendingStep {
  step: import('./repair').RepairStep
  decay: import('./decay').Decay | null
  layer: import('./layer').PaintLayer | null
  element: import('./element').Element | null
}

/** 移交前对殿宇病害与工序的核对结果 */
export interface HandoverReadiness {
  /** 病害总数 / 已修复数 / 未修完明细 */
  decayTotal: number
  repairedDecayCount: number
  unrepaired: HandoverPendingDecay[]
  /** 工序总数 / 已完成数 / 未收尾明细 */
  stepTotal: number
  doneStepCount: number
  unfinishedSteps: HandoverPendingStep[]
  /** 未修完病害数 + 未收尾工序数，移交时需当场说明的剩余项 */
  remainingCount: number
  /** 病害与工序是否全部收尾（无剩余项可直接移交） */
  ready: boolean
}
