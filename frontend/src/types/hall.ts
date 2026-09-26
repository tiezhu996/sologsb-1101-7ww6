/** 殿宇：大木/小式结构、屋顶形制的单体文物建筑 */
export type StructureType = '大木' | '小式'
export type RoofType = '庑殿' | '歇山' | '悬山'
/** 处置状态：在册（已登记待开工）/ 修缮中（现场可编辑）/ 已移交（交文管所验收，档案只读） */
export type HallDisposal = '在册' | '修缮中' | '已移交'

export interface Hall {
  id: string
  name: string
  /** 始建年代，如「明嘉靖」 */
  era: string
  structureType: StructureType
  roofType: RoofType
  /** 处置状态，默认「在册」 */
  disposal: HallDisposal
  /** 最近一次移交文管所的时间，未移交过为 null */
  handedOverAt: number | null
  /** 文管所最近一次撤回移交时填写的漏项原因，撤回后保留备查 */
  lastRecallReason: string
  /** 最近一次撤回时间，未撤回过为 null */
  lastRecalledAt: number | null
  createdAt: number
  updatedAt: number
}

export const STRUCTURE_TYPES: StructureType[] = ['大木', '小式']
export const ROOF_TYPES: RoofType[] = ['庑殿', '歇山', '悬山']
export const HALL_DISPOSALS: HallDisposal[] = ['在册', '修缮中', '已移交']

/**
 * 补齐殿宇处置状态字段：旧备份 / 历史数据缺少该组字段时按「在册」处理，
 * 已有合法取值（如新版本导出的备份）则原样保留。
 */
export function normalizeHallDisposal(hall: Hall): Hall {
  const disposal: HallDisposal = (HALL_DISPOSALS as string[]).includes(hall.disposal) ? hall.disposal : '在册'
  return {
    ...hall,
    disposal,
    handedOverAt: typeof hall.handedOverAt === 'number' ? hall.handedOverAt : null,
    lastRecallReason: typeof hall.lastRecallReason === 'string' ? hall.lastRecallReason : '',
    lastRecalledAt: typeof hall.lastRecalledAt === 'number' ? hall.lastRecalledAt : null
  }
}

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
