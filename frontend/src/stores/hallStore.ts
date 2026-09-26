import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { db, readUiPrefs, writeUiPrefs } from '@/utils/db'
import { useIdbTable } from '@/hooks/useIdbTable'
import type { Element } from '@/types/element'
import type {
  Hall,
  HallStat,
  HandoverReadiness,
  HandoverPendingDecay,
  HandoverPendingStep,
  DisposalStatus
} from '@/types/hall'
import type { PaintLayer } from '@/types/layer'
import type { Decay } from '@/types/decay'
import type { RepairStep } from '@/types/repair'

/** 已移交殿宇的只读守卫错误信息，各页面据此提示现场人员 */
export const HALL_LOCKED_MESSAGE = '该殿宇已移交文管所，档案锁定为只读；如发现漏项，请由文管所撤回后再修改。'

/**
 * 殿宇 store：维护殿宇列表、当前选中殿宇，并派生出各殿宇的病害统计。
 */
export const useHallStore = defineStore('hall', () => {
  const hallsTable = useIdbTable<Hall>((database) => database.halls)
  const elementsTable = useIdbTable<Element>((database) => database.elements, { sortByUpdatedAt: false })
  const layersTable = useIdbTable<PaintLayer>((database) => database.layers, { sortByUpdatedAt: false })
  const decaysTable = useIdbTable<Decay>((database) => database.decays)
  const repairStepsTable = useIdbTable<RepairStep>((database) => database.repairSteps)

  const prefs = readUiPrefs()
  const currentHallId = ref<string | null>(prefs.lastHallId)
  const keyword = ref('')
  const eraFilter = ref<string[]>([])
  const structureFilter = ref<string[]>([])
  const disposalFilter = ref<DisposalStatus[]>([])

  watch(currentHallId, (value) => {
    writeUiPrefs({ ...readUiPrefs(), lastHallId: value })
  })

  const halls = computed<Hall[]>(() => hallsTable.rows.value)
  const elements = computed<Element[]>(() => elementsTable.rows.value)
  const layers = computed<PaintLayer[]>(() => layersTable.rows.value)
  const decays = computed<Decay[]>(() => decaysTable.rows.value)
  const repairSteps = computed<RepairStep[]>(() => repairStepsTable.rows.value)
  const loading = computed(() => hallsTable.loading.value)

  /** 殿宇表是否已完成首次载入：直链场景用于区分「殿宇不存在」与「尚未读取」 */
  const hallsReady = computed(() => hallsTable.ready.value)

  const currentHall = computed<Hall | null>(
    () => halls.value.find((hall) => hall.id === currentHallId.value) ?? null
  )

  const eraOptions = computed<string[]>(() =>
    Array.from(new Set(halls.value.map((hall) => hall.era).filter((era) => era.length > 0))).sort()
  )

  /** 殿宇 id → 病害记录列表 */
  const decaysByHall = computed<Record<string, Decay[]>>(() => {
    const layerToElement = new Map<string, string>()
    layers.value.forEach((layer) => layerToElement.set(layer.id, layer.elementId))
    const elementToHall = new Map<string, string>()
    elements.value.forEach((element) => elementToHall.set(element.id, element.hallId))

    const grouped: Record<string, Decay[]> = {}
    decays.value.forEach((decay) => {
      const elementId = layerToElement.get(decay.layerId)
      const hallId = elementId ? elementToHall.get(elementId) : undefined
      if (!hallId) return
      if (!grouped[hallId]) grouped[hallId] = []
      grouped[hallId].push(decay)
    })
    return grouped
  })

  const stats = computed<HallStat[]>(() =>
    halls.value.map((hall) => {
      const list = decaysByHall.value[hall.id] ?? []
      const hallElements = elements.value.filter((element) => element.hallId === hall.id)
      const elementIds = new Set(hallElements.map((element) => element.id))
      const layerCount = layers.value.filter((layer) => elementIds.has(layer.elementId)).length
      const repaired = list.filter((decay) => decay.repaired).length
      return {
        hallId: hall.id,
        decayCount: list.length,
        unrepairedCount: list.length - repaired,
        elementCount: hallElements.length,
        layerCount,
        repairedPercent: list.length === 0 ? 0 : Math.round((repaired / list.length) * 100)
      }
    })
  )

  const statMap = computed<Record<string, HallStat>>(() => {
    const map: Record<string, HallStat> = {}
    stats.value.forEach((stat) => {
      map[stat.hallId] = stat
    })
    return map
  })

  /** 殿宇总览的筛选结果（关键字 + 年代 + 结构类型 + 处置状态） */
  const filteredHalls = computed<Hall[]>(() =>
    halls.value.filter((hall) => {
      const kw = keyword.value.trim()
      if (kw.length > 0) {
        const haystack = `${hall.name}${hall.era}${hall.roofType}${hall.structureType}`
        if (!haystack.includes(kw)) return false
      }
      if (eraFilter.value.length > 0 && !eraFilter.value.includes(hall.era)) return false
      if (structureFilter.value.length > 0 && !structureFilter.value.includes(hall.structureType)) return false
      if (disposalFilter.value.length > 0 && !disposalFilter.value.includes(hall.disposalStatus)) return false
      return true
    })
  )

  const totalDecay = computed(() => decays.value.length)
  const totalUnrepaired = computed(() => decays.value.filter((decay) => !decay.repaired).length)
  const totalArea = computed(() => decays.value.reduce((sum, decay) => sum + decay.areaCm2, 0))

  function setCurrentHall(id: string | null): void {
    currentHallId.value = id
  }

  async function createElement(
    payload: Omit<Element, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Element> {
    assertHallEditable(payload.hallId)
    return elementsTable.create(payload, 'elem')
  }

  async function updateElement(id: string, patch: Partial<Element>): Promise<void> {
    const element = elements.value.find((item) => item.id === id)
    if (element) assertHallEditable(element.hallId)
    await elementsTable.update(id, patch)
  }

  async function createLayer(
    payload: Omit<PaintLayer, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<PaintLayer> {
    const element = elements.value.find((item) => item.id === payload.elementId)
    if (element) assertHallEditable(element.hallId)
    const layer = await layersTable.create(payload, 'lay')
    await syncLayerCount(payload.elementId)
    return layer
  }

  async function updateLayer(id: string, patch: Partial<PaintLayer>): Promise<void> {
    const existing = layers.value.find((item) => item.id === id)
    const element = existing ? elements.value.find((item) => item.id === existing.elementId) : undefined
    if (element) assertHallEditable(element.hallId)
    await layersTable.update(id, patch)
    const layer = layers.value.find((item) => item.id === id)
    if (layer) await syncLayerCount(layer.elementId)
  }

  async function removeLayer(id: string): Promise<void> {
    const layer = layers.value.find((item) => item.id === id)
    const element = layer ? elements.value.find((item) => item.id === layer.elementId) : undefined
    if (element) assertHallEditable(element.hallId)
    const decayIds = decays.value.filter((decay) => decay.layerId === id).map((decay) => decay.id)
    await db.transaction('rw', [db.layers, db.decays, db.repairSteps], async () => {
      await db.repairSteps.where('decayId').anyOf(decayIds).delete()
      await db.decays.bulkDelete(decayIds)
      await db.layers.delete(id)
    })
    if (layer) await syncLayerCount(layer.elementId)
  }

  /** 级联删除构件及其层位、病害、工序 */
  async function removeElement(id: string): Promise<void> {
    const element = elements.value.find((item) => item.id === id)
    if (element) assertHallEditable(element.hallId)
    const layerIds = layersOfElement(id).map((layer) => layer.id)
    const decayIds = decays.value.filter((decay) => layerIds.includes(decay.layerId)).map((decay) => decay.id)
    await db.transaction(
      'rw',
      [db.elements, db.layers, db.decays, db.repairSteps],
      async () => {
        await db.repairSteps.where('decayId').anyOf(decayIds).delete()
        await db.decays.bulkDelete(decayIds)
        await db.layers.bulkDelete(layerIds)
        await db.elements.delete(id)
      }
    )
  }

  /** 层位数量变化后回写构件 layerCount，保证卡片回显一致 */
  async function syncLayerCount(elementId: string): Promise<void> {
    const count = layers.value.filter((layer) => layer.elementId === elementId).length
    const element = elements.value.find((item) => item.id === elementId)
    if (element && element.layerCount !== count) {
      await elementsTable.update(elementId, { layerCount: count } as Partial<Element>)
    }
  }

  function resetFilters(): void {
    keyword.value = ''
    eraFilter.value = []
    structureFilter.value = []
    disposalFilter.value = []
  }

  async function createHall(
    payload: Omit<Hall, 'id' | 'createdAt' | 'updatedAt' | 'disposalStatus' | 'handoverAt' | 'handoverRecords'> &
      Partial<Pick<Hall, 'disposalStatus' | 'handoverAt' | 'handoverRecords'>>
  ): Promise<Hall> {
    const hall = await hallsTable.create(
      {
        ...payload,
        // 新登记殿宇一律「在册」，移交时间与流转留痕为空
        disposalStatus: payload.disposalStatus ?? '在册',
        handoverAt: payload.handoverAt ?? null,
        handoverRecords: payload.handoverRecords ?? []
      },
      'hall'
    )
    currentHallId.value = hall.id
    return hall
  }

  async function updateHall(id: string, patch: Partial<Hall>): Promise<void> {
    await hallsTable.update(id, patch)
  }

  /** 殿宇是否处于可编辑状态（非已移交） */
  function isHallEditable(hallId: string): boolean {
    const hall = hallById(hallId)
    return hall ? hall.disposalStatus !== '已移交' : false
  }

  /** 已移交殿宇写操作守卫，供本 store 与其他 store 共用 */
  function assertHallEditable(hallId: string): void {
    if (!isHallEditable(hallId)) throw new Error(HALL_LOCKED_MESSAGE)
  }

  function hallOfLayer(layerId: string): Hall | null {
    const layer = layers.value.find((item) => item.id === layerId)
    const element = layer ? elements.value.find((item) => item.id === layer.elementId) : undefined
    return element ? hallById(element.hallId) ?? null : null
  }

  /** 病害 id → 所属殿宇，供病害 / 工序页面的只读判断 */
  function hallOfDecay(decayId: string): Hall | null {
    const decay = decays.value.find((item) => item.id === decayId)
    return decay ? hallOfLayer(decay.layerId) : null
  }

  function isDecayEditable(decayId: string): boolean {
    const hall = hallOfDecay(decayId)
    return hall ? hall.disposalStatus !== '已移交' : false
  }

  function assertDecayEditable(decayId: string): void {
    if (!isDecayEditable(decayId)) throw new Error(HALL_LOCKED_MESSAGE)
  }

  /** 移交前核对：汇总该殿宇未修完的病害与未收尾的工序 */
  function handoverReadiness(hallId: string): HandoverReadiness {
    const layerMap = new Map<string, PaintLayer>()
    layers.value.forEach((layer) => layerMap.set(layer.id, layer))
    const elementMap = new Map<string, Element>()
    elements.value.forEach((element) => elementMap.set(element.id, element))
    const hallElements = elements.value.filter((element) => element.hallId === hallId)
    const elementIds = new Set(hallElements.map((element) => element.id))
    const hallLayerIds = new Set(
      layers.value.filter((layer) => elementIds.has(layer.elementId)).map((layer) => layer.id)
    )
    const hallDecays = decays.value.filter((decay) => hallLayerIds.has(decay.layerId))
    const decayIds = new Set(hallDecays.map((decay) => decay.id))

    const toPendingDecay = (decay: Decay): HandoverPendingDecay => {
      const layer = layerMap.get(decay.layerId) ?? null
      const element = layer ? elementMap.get(layer.elementId) ?? null : null
      return { decay, layer, element }
    }
    const unrepaired = hallDecays.filter((decay) => !decay.repaired).map(toPendingDecay)

    const hallSteps = repairSteps.value.filter((step) => decayIds.has(step.decayId))
    const decayMap = new Map<string, Decay>()
    hallDecays.forEach((decay) => decayMap.set(decay.id, decay))
    const unfinishedSteps: HandoverPendingStep[] = hallSteps
      .filter((step) => step.state !== '已完成')
      .map((step) => {
        const decay = decayMap.get(step.decayId) ?? null
        const layer = decay ? layerMap.get(decay.layerId) ?? null : null
        const element = layer ? elementMap.get(layer.elementId) ?? null : null
        return { step, decay, layer, element }
      })

    return {
      decayTotal: hallDecays.length,
      repairedDecayCount: hallDecays.length - unrepaired.length,
      unrepaired,
      stepTotal: hallSteps.length,
      doneStepCount: hallSteps.length - unfinishedSteps.length,
      unfinishedSteps,
      remainingCount: unrepaired.length + unfinishedSteps.length,
      ready: unrepaired.length === 0 && unfinishedSteps.length === 0
    }
  }

  /** 在册 → 修缮中：修缮队领档开工 */
  async function startRepair(id: string): Promise<void> {
    const hall = hallById(id)
    if (!hall) return
    if (hall.disposalStatus !== '在册') {
      throw new Error('只有「在册」殿宇才能开始修缮')
    }
    await hallsTable.update(id, { disposalStatus: '修缮中' })
  }

  /** 修缮中 → 已移交：现场核对病害与工序后移交文管所，移交后档案只读 */
  async function handoverHall(id: string): Promise<void> {
    const hall = hallById(id)
    if (!hall) return
    if (hall.disposalStatus !== '修缮中') {
      throw new Error('只有「修缮中」殿宇才能移交')
    }
    const now = Date.now()
    await hallsTable.update(id, {
      disposalStatus: '已移交',
      handoverAt: now,
      handoverRecords: [...hall.handoverRecords, { type: 'handover', at: now }]
    })
  }

  /** 已移交 → 修缮中：文管所发现漏项撤回，必填原因并留痕，档案恢复编辑 */
  async function withdrawHandover(id: string, reason: string): Promise<void> {
    const hall = hallById(id)
    if (!hall) return
    if (hall.disposalStatus !== '已移交') {
      throw new Error('只有「已移交」殿宇才能撤回')
    }
    const trimmed = reason.trim()
    if (!trimmed) throw new Error('请填写撤回原因')
    const now = Date.now()
    await hallsTable.update(id, {
      disposalStatus: '修缮中',
      handoverRecords: [...hall.handoverRecords, { type: 'withdraw', at: now, reason: trimmed }]
    })
  }

  /** 最近一次撤回留痕（含原因），用于现场提示 */
  function latestWithdrawRecord(id: string): { at: number; reason: string } | null {
    const hall = hallById(id)
    if (!hall) return null
    for (let index = hall.handoverRecords.length - 1; index >= 0; index -= 1) {
      const record = hall.handoverRecords[index]
      if (record.type === 'withdraw' && record.reason) {
        return { at: record.at, reason: record.reason }
      }
    }
    return null
  }

  /** 级联删除：殿宇 → 构件 → 层位 → 病害 → 工序。已移交档案不允许删除 */
  async function removeHall(id: string): Promise<void> {
    assertHallEditable(id)
    const elementIds = elements.value.filter((element) => element.hallId === id).map((element) => element.id)
    const layerIds = layers.value
      .filter((layer) => elementIds.includes(layer.elementId))
      .map((layer) => layer.id)
    const decayIds = decays.value.filter((decay) => layerIds.includes(decay.layerId)).map((decay) => decay.id)
    await db.transaction(
      'rw',
      [db.halls, db.elements, db.layers, db.decays, db.repairSteps],
      async () => {
        await db.repairSteps.where('decayId').anyOf(decayIds).delete()
        await db.decays.bulkDelete(decayIds)
        await db.layers.bulkDelete(layerIds)
        await db.elements.bulkDelete(elementIds)
        await db.halls.delete(id)
      }
    )
    if (currentHallId.value === id) currentHallId.value = null
  }

  function elementById(id: string): Element | undefined {
    return elements.value.find((element) => element.id === id)
  }

  function hallById(id: string): Hall | undefined {
    return halls.value.find((hall) => hall.id === id)
  }

  function layersOfElement(elementId: string): PaintLayer[] {
    return layers.value
      .filter((layer) => layer.elementId === elementId)
      .sort((a, b) => a.level - b.level)
  }

  function decaysOfLayer(layerId: string): Decay[] {
    return decays.value.filter((decay) => decay.layerId === layerId)
  }

  function elementDecayCount(elementId: string): number {
    const layerIds = layersOfElement(elementId).map((layer) => layer.id)
    return decays.value.filter((decay) => layerIds.includes(decay.layerId)).length
  }

  return {
    halls,
    elements,
    layers,
    decays,
    repairSteps,
    loading,
    hallsReady,
    currentHallId,
    currentHall,
    keyword,
    eraFilter,
    structureFilter,
    disposalFilter,
    eraOptions,
    stats,
    statMap,
    decaysByHall,
    filteredHalls,
    totalDecay,
    totalUnrepaired,
    totalArea,
    setCurrentHall,
    resetFilters,
    createHall,
    updateHall,
    removeHall,
    isHallEditable,
    assertHallEditable,
    hallOfLayer,
    hallOfDecay,
    isDecayEditable,
    assertDecayEditable,
    handoverReadiness,
    startRepair,
    handoverHall,
    withdrawHandover,
    latestWithdrawRecord,
    createElement,
    updateElement,
    removeElement,
    createLayer,
    updateLayer,
    removeLayer,
    syncLayerCount,
    elementById,
    hallById,
    layersOfElement,
    decaysOfLayer,
    elementDecayCount
  }
})
