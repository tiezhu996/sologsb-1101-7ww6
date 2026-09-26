import {
  db,
  DB_VERSION,
  createId,
  clearAllTables,
  stampBackupTime,
  type BackupPayload
} from '@/utils/db'
import type { Hall, HandoverRecord } from '@/types/hall'
import { DISPOSAL_STATUSES } from '@/types/hall'

/** 旧备份（v2 及更早）的殿宇没有处置状态，导入后统一按「在册」处理 */
function normalizeHall(input: Partial<Hall>): Hall | null {
  if (typeof input !== 'object' || input === null || typeof input.id !== 'string') return null
  const status = DISPOSAL_STATUSES.includes(input.disposalStatus as Hall['disposalStatus'])
    ? (input.disposalStatus as Hall['disposalStatus'])
    : '在册'
  const handoverRecords = Array.isArray(input.handoverRecords)
    ? (input.handoverRecords as HandoverRecord[]).filter(
        (record) => record && (record.type === 'handover' || record.type === 'withdraw')
      )
    : []
  return {
    id: input.id,
    name: typeof input.name === 'string' ? input.name : '未命名殿宇',
    era: typeof input.era === 'string' ? input.era : '',
    structureType: input.structureType === '大木' || input.structureType === '小式' ? input.structureType : '大木',
    roofType:
      input.roofType === '庑殿' || input.roofType === '歇山' || input.roofType === '悬山'
        ? input.roofType
        : '庑殿',
    disposalStatus: status,
    // 旧备份无移交相关字段：移交时间与留痕均置空（在册殿宇本就不应有）
    handoverAt: typeof input.handoverAt === 'number' ? input.handoverAt : null,
    handoverRecords: status === '在册' && handoverRecords.length === 0 ? [] : handoverRecords,
    createdAt: typeof input.createdAt === 'number' ? input.createdAt : Date.now(),
    updatedAt: typeof input.updatedAt === 'number' ? input.updatedAt : Date.now()
  }
}

/** 校验备份对象的必备字段，返回错误信息数组（为空表示通过） */
export function validateBackup(input: unknown): { ok: boolean; errors: string[]; payload: BackupPayload | null } {
  const errors: string[] = []
  if (typeof input !== 'object' || input === null) {
    return { ok: false, errors: ['文件内容不是合法的 JSON 对象'], payload: null }
  }
  const obj = input as Partial<BackupPayload>
  if (obj.app !== 'gbmuralarch') errors.push('app 字段应为 gbmuralarch，文件来源不明')
  const collections: Array<keyof Pick<BackupPayload, 'halls' | 'elements' | 'layers' | 'decays' | 'repairSteps'>> = [
    'halls',
    'elements',
    'layers',
    'decays',
    'repairSteps'
  ]
  for (const key of collections) {
    if (!Array.isArray(obj[key])) errors.push(`${key} 字段缺失或不是数组`)
  }
  if (errors.length > 0) return { ok: false, errors, payload: null }
  // 殿宇逐行归一化：旧版本备份缺少处置状态等字段时补默认值（统一按在册）
  const halls = (obj.halls ?? [])
    .map((item) => normalizeHall(item as Partial<Hall>))
    .filter((item): item is Hall => item !== null)
  const payload: BackupPayload = {
    app: 'gbmuralarch',
    dbVersion: typeof obj.dbVersion === 'number' ? obj.dbVersion : DB_VERSION,
    exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : new Date().toISOString(),
    halls,
    elements: obj.elements ?? [],
    layers: obj.layers ?? [],
    decays: obj.decays ?? [],
    repairSteps: obj.repairSteps ?? []
  }
  return { ok: true, errors, payload }
}

/** 组装当前本地数据的备份对象 */
export async function buildBackupPayload(): Promise<BackupPayload> {
  const [halls, elements, layers, decays, repairSteps] = await Promise.all([
    db.halls.toArray(),
    db.elements.toArray(),
    db.layers.toArray(),
    db.decays.toArray(),
    db.repairSteps.toArray()
  ])
  return {
    app: 'gbmuralarch',
    dbVersion: DB_VERSION,
    exportedAt: new Date().toISOString(),
    halls,
    elements,
    layers,
    decays,
    repairSteps
  }
}

/** 导出 JSON 文件到浏览器下载目录 */
export async function exportBackupJson(): Promise<{ fileName: string; counts: Record<string, number> }> {
  const payload = await buildBackupPayload()
  const fileName = `gbmuralarch-backup-v${payload.dbVersion}-${payload.exportedAt.slice(0, 19).replace(/[:T]/g, '')}.json`
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
  stampBackupTime(payload.exportedAt)
  return {
    fileName,
    counts: {
      halls: payload.halls.length,
      elements: payload.elements.length,
      layers: payload.layers.length,
      decays: payload.decays.length,
      repairSteps: payload.repairSteps.length
    }
  }
}

/** 读取用户选择的备份文件文本 */
export function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsText(file, 'utf-8')
  })
}

/** 导入备份：overwrite=true 时先清空全部表，否则按主键合并（同 id 覆盖） */
export async function importBackup(
  payload: BackupPayload,
  overwrite: boolean
): Promise<Record<string, number>> {
  if (overwrite) await clearAllTables()
  await db.transaction(
    'rw',
    [db.halls, db.elements, db.layers, db.decays, db.repairSteps],
    async () => {
      await db.halls.bulkPut(payload.halls)
      await db.elements.bulkPut(payload.elements)
      await db.layers.bulkPut(payload.layers)
      await db.decays.bulkPut(payload.decays)
      await db.repairSteps.bulkPut(payload.repairSteps)
    }
  )
  return {
    halls: payload.halls.length,
    elements: payload.elements.length,
    layers: payload.layers.length,
    decays: payload.decays.length,
    repairSteps: payload.repairSteps.length
  }
}

/** 追加式导入：为导入数据重新分配 id，避免覆盖现有档案 */
export function remapIds(payload: BackupPayload): BackupPayload {
  const hallIdMap = new Map<string, string>()
  const elementIdMap = new Map<string, string>()
  const layerIdMap = new Map<string, string>()
  const decayIdMap = new Map<string, string>()

  const halls = payload.halls.map((hall) => {
    const id = createId('hall')
    hallIdMap.set(hall.id, id)
    return { ...hall, id }
  })
  const elements = payload.elements.map((element) => {
    const id = createId('elem')
    elementIdMap.set(element.id, id)
    return { ...element, id, hallId: hallIdMap.get(element.hallId) ?? element.hallId }
  })
  const layers = payload.layers.map((layer) => {
    const id = createId('lay')
    layerIdMap.set(layer.id, id)
    return { ...layer, id, elementId: elementIdMap.get(layer.elementId) ?? layer.elementId }
  })
  const decays = payload.decays.map((decay) => {
    const id = createId('dec')
    decayIdMap.set(decay.id, id)
    return { ...decay, id, layerId: layerIdMap.get(decay.layerId) ?? decay.layerId }
  })
  const repairSteps = payload.repairSteps.map((step) => ({
    ...step,
    id: createId('step'),
    decayId: decayIdMap.get(step.decayId) ?? step.decayId
  }))
  return { ...payload, halls, elements, layers, decays, repairSteps }
}

/** 生成演示样例数据，便于首次打开即可看到完整链路 */
export async function seedDemoData(): Promise<void> {
  const now = Date.now()
  const hallId = createId('hall')
  const elementIds = [createId('elem'), createId('elem')]
  const layerIds = elementIds.map(() => createId('lay'))
  const decayIds = layerIds.map(() => createId('dec'))

  await db.transaction(
    'rw',
    [db.halls, db.elements, db.layers, db.decays, db.repairSteps],
    async () => {
      await db.halls.put({
        id: hallId,
        name: '大雄宝殿',
        era: '明嘉靖',
        structureType: '大木',
        roofType: '庑殿',
        disposalStatus: '修缮中',
        handoverAt: null,
        handoverRecords: [],
        createdAt: now,
        updatedAt: now
      })
      await db.elements.bulkPut([
        {
          id: elementIds[0],
          hallId,
          position: '檐下',
          name: '前檐明间额枋',
          layerCount: 2,
          baseLayer: '一麻五灰',
          status: '待修',
          createdAt: now,
          updatedAt: now
        },
        {
          id: elementIds[1],
          hallId,
          position: '梁枋',
          name: '七架梁',
          layerCount: 1,
          baseLayer: '单披灰',
          status: '观察',
          createdAt: now,
          updatedAt: now
        }
      ])
      await db.layers.bulkPut([
        {
          id: layerIds[0],
          elementId: elementIds[0],
          level: 1,
          patternName: '旋子',
          pigment: '石青',
          thicknessMm: 1.8,
          createdAt: now,
          updatedAt: now
        },
        {
          id: layerIds[1],
          elementId: elementIds[1],
          level: 1,
          patternName: '苏式',
          pigment: '土黄',
          thicknessMm: 1.2,
          createdAt: now,
          updatedAt: now
        }
      ])
      await db.decays.bulkPut([
        {
          id: decayIds[0],
          layerId: layerIds[0],
          type: '起甲',
          severity: '重度',
          areaCm2: 320.5,
          causeGuess: '地仗层脱胶，受檐口渗水影响',
          repaired: false,
          repairedAt: null,
          createdAt: now,
          updatedAt: now
        },
        {
          id: decayIds[1],
          layerId: layerIds[1],
          type: '龟裂',
          severity: '中度',
          areaCm2: 158,
          causeGuess: '木构件干缩引起画面开裂',
          repaired: false,
          repairedAt: null,
          createdAt: now,
          updatedAt: now
        }
      ])
      await db.repairSteps.bulkPut([
        {
          id: createId('step'),
          decayId: decayIds[0],
          seq: 1,
          name: '除尘',
          material: '软毛刷 + 去离子水',
          operator: '李文博',
          state: '已完成',
          createdAt: now,
          updatedAt: now
        },
        {
          id: createId('step'),
          decayId: decayIds[0],
          seq: 2,
          name: '回贴',
          material: '鱼鳔胶（2% 明矾水调和）',
          operator: '李文博',
          state: '进行中',
          createdAt: now,
          updatedAt: now
        }
      ])
    }
  )
}
