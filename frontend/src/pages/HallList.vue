<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { CircleCheck, Plus, Position, RefreshLeft, Tools, Van } from '@element-plus/icons-vue'
import EmptyPanel from '@/components/common/EmptyPanel.vue'
import FilterBar, { type FilterModel } from '@/components/common/FilterBar.vue'
import StatBadge from '@/components/common/StatBadge.vue'
import DisposalTag from '@/components/common/DisposalTag.vue'
import { useHallStore } from '@/stores/hallStore'
import { useDecayStore } from '@/stores/decayStore'
import { useRepairStore } from '@/stores/repairStore'
import { seedDemoData } from '@/utils/export'
import { formatArea } from '@/utils/severity'
import { formatDateTime } from '@/utils/datetime'
import {
  ROOF_TYPES,
  STRUCTURE_TYPES,
  DISPOSAL_STATUSES,
  type DisposalStatus,
  type Hall,
  type HandoverReadiness,
  type RoofType,
  type StructureType
} from '@/types/hall'

const router = useRouter()
const hallStore = useHallStore()
const decayStore = useDecayStore()
const repairStore = useRepairStore()

const dialogVisible = ref(false)
const submitting = ref(false)
const formRef = ref<FormInstance>()

const form = reactive<{
  name: string
  era: string
  structureType: StructureType
  roofType: RoofType
}>({
  name: '',
  era: '',
  structureType: '大木',
  roofType: '庑殿'
})

const rules: FormRules = {
  name: [{ required: true, message: '请填写殿宇名称', trigger: 'blur' }],
  era: [{ required: true, message: '请填写始建年代', trigger: 'blur' }]
}

const filterModel = computed<FilterModel>(() => ({
  keyword: hallStore.keyword,
  era: hallStore.eraFilter,
  structure: hallStore.structureFilter,
  disposal: hallStore.disposalFilter
}))

const filterSelects = computed(() => [
  {
    key: 'era',
    label: '年代',
    options: hallStore.eraOptions.map((era) => ({ label: era, value: era }))
  },
  {
    key: 'structure',
    label: '结构',
    options: STRUCTURE_TYPES.map((type) => ({ label: type, value: type }))
  },
  {
    key: 'disposal',
    label: '处置状态',
    options: DISPOSAL_STATUSES.map((status) => ({ label: status, value: status }))
  }
])

const cards = computed(() =>
  hallStore.filteredHalls.map((hall) => {
    const stat = hallStore.statMap[hall.id]
    const aggregate = decayStore.hallAggregate[hall.id]
    const risk = decayStore.hallRisk[hall.id] ?? 0
    const readiness = hallStore.handoverReadiness(hall.id)
    const steps = repairStore.steps.filter((step) => {
      const decay = decayStore.rows.find((row) => row.decay.id === step.decayId)
      return decay?.hallId === hall.id
    })
    const doneSteps = steps.filter((step) => step.state === '已完成').length
    return {
      hall,
      stat,
      areaText: formatArea(aggregate?.areaCm2 ?? 0),
      unrepaired: stat?.unrepairedCount ?? 0,
      decayCount: stat?.decayCount ?? 0,
      elementCount: stat?.elementCount ?? 0,
      layerCount: stat?.layerCount ?? 0,
      repairedPercent: stat?.repairedPercent ?? 0,
      risk,
      stepCount: steps.length,
      doneSteps,
      readiness,
      latestWithdraw: hallStore.latestWithdrawRecord(hall.id)
    }
  })
)

const structOptions = STRUCTURE_TYPES.map((type) => ({ label: type, value: type }))
const roofOptions = ROOF_TYPES.map((type) => ({ label: type, value: type }))

function handleFilterChange(value: FilterModel): void {
  hallStore.keyword = value.keyword
  hallStore.eraFilter = Array.isArray(value.era) ? value.era : []
  hallStore.structureFilter = Array.isArray(value.structure) ? value.structure : []
  hallStore.disposalFilter = Array.isArray(value.disposal) ? (value.disposal as DisposalStatus[]) : []
}

function openCreate(): void {
  form.name = ''
  form.era = ''
  form.structureType = structOptions[0].value
  form.roofType = roofOptions[0].value
  dialogVisible.value = true
}

async function submitCreate(): Promise<void> {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  submitting.value = true
  try {
    const hall = await hallStore.createHall({
      name: form.name.trim(),
      era: form.era.trim(),
      structureType: form.structureType,
      roofType: form.roofType
    })
    dialogVisible.value = false
    ElMessage.success(`已新建殿宇「${hall.name}」，请继续录入构件与彩画层位`)
    await router.push(`/halls/${hall.id}/elements`)
  } finally {
    submitting.value = false
  }
}

function openElements(hall: Hall): void {
  hallStore.setCurrentHall(hall.id)
  void router.push(`/halls/${hall.id}/elements`)
}

function openDecays(hall: Hall): void {
  hallStore.setCurrentHall(hall.id)
  decayStore.patchFilter({ halls: [hall.id] })
  void router.push('/decays')
}

function openRepair(hall: Hall): void {
  hallStore.setCurrentHall(hall.id)
  void router.push('/repair')
}

async function removeHall(hall: Hall): Promise<void> {
  if (hall.disposalStatus === '已移交') {
    ElMessage.warning('该殿宇已移交文管所，档案已锁定，不能删除')
    return
  }
  const confirmed = await ElMessageBox.confirm(
    `删除殿宇「${hall.name}」将同时删除其构件、层位、病害与工序记录，是否继续？`,
    '删除确认',
    { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
  ).catch(() => false)
  if (!confirmed) return
  try {
    await hallStore.removeHall(hall.id)
    ElMessage.success('已删除殿宇及其关联记录')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '删除失败')
  }
}

async function seed(): Promise<void> {
  await seedDemoData()
  ElMessage.success('已生成本地样例档案，可直接浏览各页面')
}

/** 在册 → 修缮中 */
async function startRepair(hall: Hall): Promise<void> {
  const confirmed = await ElMessageBox.confirm(
    `确认殿宇「${hall.name}」开始修缮？开工后现场人员可维护病害与工序，修缮完成再移交文管所。`,
    '开始修缮',
    { type: 'info', confirmButtonText: '开工', cancelButtonText: '取消' }
  ).catch(() => false)
  if (!confirmed) return
  try {
    await hallStore.startRepair(hall.id)
    ElMessage.success(`殿宇「${hall.name}」已进入修缮中`)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '操作失败')
  }
}

/* ---------------- 移交 ---------------- */

const handoverDialogVisible = ref(false)
const handoverHall = ref<Hall | null>(null)
const handoverReadiness = ref<HandoverReadiness | null>(null)
const handoverAcknowledged = ref(false)

function openHandover(hall: Hall): void {
  handoverHall.value = hall
  handoverReadiness.value = hallStore.handoverReadiness(hall.id)
  handoverAcknowledged.value = false
  handoverDialogVisible.value = true
}

function pendingDecayLocation(item: HandoverReadiness['unrepaired'][number]): string {
  const parts = [item.element ? `${item.element.position}·${item.element.name}` : '构件已删除']
  if (item.layer) parts.push(`第 ${item.layer.level} 层 ${item.layer.patternName}/${item.layer.pigment}`)
  return parts.join(' · ')
}

function pendingStepLocation(item: HandoverReadiness['unfinishedSteps'][number]): string {
  const parts = []
  if (item.element) parts.push(`${item.element.position}·${item.element.name}`)
  if (item.layer) parts.push(`第 ${item.layer.level} 层`)
  if (item.decay) parts.push(item.decay.type)
  return parts.length > 0 ? parts.join(' · ') : '关联病害已删除'
}

async function confirmHandover(): Promise<void> {
  const hall = handoverHall.value
  const readiness = handoverReadiness.value
  if (!hall || !readiness) return
  if (!readiness.ready && !handoverAcknowledged.value) return
  try {
    await hallStore.handoverHall(hall.id)
    handoverDialogVisible.value = false
    ElMessage.success(
      readiness.ready
        ? `殿宇「${hall.name}」病害与工序均已收尾，已移交文管所，档案锁定为只读`
        : `殿宇「${hall.name}」已移交文管所，剩余 ${readiness.remainingCount} 处已当场说明，档案锁定为只读`
    )
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '移交失败')
  }
}

/* ---------------- 撤回 ---------------- */

const withdrawDialogVisible = ref(false)
const withdrawHall = ref<Hall | null>(null)
const withdrawReason = ref('')

function openWithdraw(hall: Hall): void {
  withdrawHall.value = hall
  withdrawReason.value = ''
  withdrawDialogVisible.value = true
}

async function confirmWithdraw(): Promise<void> {
  const hall = withdrawHall.value
  if (!hall) return
  if (!withdrawReason.value.trim()) {
    ElMessage.warning('请填写撤回原因（漏项情况）')
    return
  }
  try {
    await hallStore.withdrawHandover(hall.id, withdrawReason.value)
    withdrawDialogVisible.value = false
    ElMessage.success(`殿宇「${hall.name}」已退回修缮中，现场可继续补录修改`)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '撤回失败')
  }
}
</script>

<template>
  <div>
    <div class="page-title">
      <div>
        <h2>殿宇总览</h2>
        <p>共 {{ hallStore.halls.length }} 处殿宇，{{ hallStore.totalDecay }} 条病害记录，未修复 {{ hallStore.totalUnrepaired }} 条</p>
      </div>
      <el-button type="primary" :icon="Plus" @click="openCreate">新建殿宇</el-button>
    </div>

    <div class="stat-row">
      <StatBadge label="殿宇总数" :value="hallStore.halls.length" suffix="处" icon="OfficeBuilding" tone="primary" />
      <StatBadge label="构件总数" :value="hallStore.elements.length" suffix="件" icon="Grid" tone="info" />
      <StatBadge label="彩画层位" :value="hallStore.layers.length" suffix="层" icon="Files" />
      <StatBadge label="病害记录" :value="hallStore.totalDecay" suffix="条" icon="Histogram" tone="warning" />
      <StatBadge
        label="未修复"
        :value="hallStore.totalUnrepaired"
        suffix="条"
        icon="WarningFilled"
        tone="danger"
        :percent="100 - decayStore.repairedPercent"
      />
      <StatBadge label="病害总面积" :value="formatArea(decayStore.totalArea)" icon="PieChart" tone="success" />
    </div>

    <FilterBar
      :model-value="filterModel"
      :selects="filterSelects"
      keyword-placeholder="按殿宇名称 / 年代 / 屋顶形制搜索"
      @change="handleFilterChange"
      @reset="hallStore.resetFilters()"
    />

    <div v-if="cards.length === 0" class="hall-empty">
      <EmptyPanel
        title="尚未登记殿宇"
        :description="
          hallStore.halls.length === 0
            ? '先从一处殿宇开始：新建殿宇后可继续录入构件、圈定彩画层位并判定病害。'
            : '当前筛选条件下没有匹配的殿宇，可重置条件或新建一处殿宇。'
        "
        action-text="新建殿宇"
        :show-seed="hallStore.halls.length === 0"
        @action="openCreate"
        @seed="seed"
      />
    </div>

    <div v-else class="hall-grid">
      <article v-for="card in cards" :key="card.hall.id" class="hall-card">
        <header class="hall-card__head">
          <div>
            <h3>{{ card.hall.name }}</h3>
            <p class="muted">{{ card.hall.era }} · {{ card.hall.structureType }} · {{ card.hall.roofType }}顶</p>
            <p v-if="card.hall.disposalStatus === '已移交' && card.hall.handoverAt" class="muted hall-card__handover">
              已于 {{ formatDateTime(card.hall.handoverAt) }} 移交文管所
            </p>
          </div>
          <div class="hall-card__tags">
            <DisposalTag :status="card.hall.disposalStatus" size="small" />
            <el-tag :type="card.unrepaired > 0 ? 'danger' : 'success'" effect="plain" round size="small">
              {{ card.unrepaired > 0 ? `未修复 ${card.unrepaired}` : '病害已清' }}
            </el-tag>
          </div>
        </header>

        <div class="hall-card__badges">
          <StatBadge label="病害总数" :value="card.decayCount" suffix="条" size="small" tone="warning" icon="Histogram" />
          <StatBadge label="未修复" :value="card.unrepaired" suffix="条" size="small" tone="danger" icon="WarningFilled" />
          <StatBadge
            label="构件 / 层位"
            :value="`${card.elementCount} / ${card.layerCount}`"
            size="small"
            icon="Grid"
            tone="info"
          />
          <StatBadge
            label="修复进度"
            :value="card.repairedPercent"
            suffix="%"
            size="small"
            tone="success"
            icon="TrendCharts"
            :percent="card.repairedPercent"
            show-percent
          />
        </div>

        <dl class="hall-card__meta">
          <div>
            <dt>病害面积</dt>
            <dd class="mono">{{ card.areaText }}</dd>
          </div>
          <div>
            <dt>风险加权分</dt>
            <dd class="mono">{{ card.risk }}</dd>
          </div>
          <div>
            <dt>工序完成</dt>
            <dd class="mono">{{ card.doneSteps }} / {{ card.stepCount }}</dd>
          </div>
        </dl>

        <el-alert
          v-if="card.latestWithdraw"
          :title="`文管所撤回：${card.latestWithdraw.reason}`"
          :description="`撤回时间：${formatDateTime(card.latestWithdraw.at)}`"
          type="warning"
          :closable="false"
          show-icon
          class="hall-card__withdraw"
        />

        <footer class="hall-card__actions">
          <el-button size="small" type="primary" plain :icon="Position" @click="openElements(card.hall)">
            构件与层位
          </el-button>
          <el-button size="small" :icon="Position" @click="openDecays(card.hall)">病害档案</el-button>
          <el-button size="small" :icon="Tools" @click="openRepair(card.hall)">修复工序</el-button>
          <el-button
            v-if="card.hall.disposalStatus === '在册'"
            size="small"
            type="warning"
            plain
            :icon="Tools"
            @click="startRepair(card.hall)"
          >
            开始修缮
          </el-button>
          <el-button
            v-if="card.hall.disposalStatus === '修缮中'"
            size="small"
            type="success"
            :icon="Van"
            @click="openHandover(card.hall)"
          >
            移交文管所
          </el-button>
          <el-button
            v-if="card.hall.disposalStatus === '已移交'"
            size="small"
            type="warning"
            :icon="RefreshLeft"
            @click="openWithdraw(card.hall)"
          >
            撤回移交
          </el-button>
          <el-button
            size="small"
            type="danger"
            text
            :disabled="card.hall.disposalStatus === '已移交'"
            @click="removeHall(card.hall)"
          >
            删除
          </el-button>
        </footer>
      </article>
    </div>

    <el-dialog v-model="dialogVisible" title="新建殿宇" width="520px" append-to-body>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="96px">
        <el-form-item label="殿宇名称" prop="name">
          <el-input v-model="form.name" placeholder="如：大雄宝殿" maxlength="30" show-word-limit />
        </el-form-item>
        <el-form-item label="始建年代" prop="era">
          <el-input v-model="form.era" placeholder="如：明嘉靖" maxlength="20" />
        </el-form-item>
        <el-form-item label="大木/小式" prop="structureType">
          <el-radio-group v-model="form.structureType">
            <el-radio v-for="item in structOptions" :key="item.value" :value="item.value">
              {{ item.label }}
            </el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="屋顶形制" prop="roofType">
          <el-radio-group v-model="form.roofType">
            <el-radio v-for="item in roofOptions" :key="item.value" :value="item.value">
              {{ item.label }}
            </el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitCreate">保存并录入构件</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="handoverDialogVisible" title="移交文管所 · 现场核对" width="640px" append-to-body>
      <div v-if="handoverHall && handoverReadiness">
        <p class="handover-lead">
          殿宇「<strong>{{ handoverHall.name }}</strong>」移交前核对病害与工序收尾情况：
        </p>

        <div class="handover-summary">
          <el-tag type="warning" effect="plain" size="large">
            病害已修复 {{ handoverReadiness.repairedDecayCount }} / {{ handoverReadiness.decayTotal }}
          </el-tag>
          <el-tag type="warning" effect="plain" size="large">
            工序已完成 {{ handoverReadiness.doneStepCount }} / {{ handoverReadiness.stepTotal }}
          </el-tag>
        </div>

        <el-alert
          v-if="handoverReadiness.ready"
          title="病害与工序均已收尾，可以移交。移交后构件、层位、病害与工序将锁定为只读。"
          type="success"
          :closable="false"
          show-icon
          class="handover-alert"
        />

        <template v-else>
          <el-alert
            :title="`尚有 ${handoverReadiness.remainingCount} 处未收尾，请当场向文管所说明后再确认移交。`"
            type="error"
            :closable="false"
            show-icon
            class="handover-alert"
          />

          <div v-if="handoverReadiness.unrepaired.length > 0" class="handover-section">
            <h4>未修完病害（{{ handoverReadiness.unrepaired.length }} 处）</h4>
            <ul class="handover-list">
              <li v-for="item in handoverReadiness.unrepaired" :key="item.decay.id">
                <el-tag size="small" type="danger" effect="plain">{{ item.decay.severity }}</el-tag>
                <span class="handover-list__main">
                  {{ item.decay.type }} · {{ formatArea(item.decay.areaCm2) }}
                  <span class="muted">（{{ pendingDecayLocation(item) }}）</span>
                </span>
              </li>
            </ul>
          </div>

          <div v-if="handoverReadiness.unfinishedSteps.length > 0" class="handover-section">
            <h4>未收尾工序（{{ handoverReadiness.unfinishedSteps.length }} 道）</h4>
            <ul class="handover-list">
              <li v-for="item in handoverReadiness.unfinishedSteps" :key="item.step.id">
                <el-tag size="small" type="warning" effect="plain">{{ item.step.state }}</el-tag>
                <span class="handover-list__main">
                  {{ item.step.name }}
                  <span class="muted">（{{ pendingStepLocation(item) }}）</span>
                </span>
              </li>
            </ul>
          </div>

          <el-checkbox v-model="handoverAcknowledged" class="handover-ack">
            已当场向文管所说明剩余 {{ handoverReadiness.remainingCount }} 处的情况，确认仍要移交
          </el-checkbox>
        </template>
      </div>
      <template #footer>
        <el-button @click="handoverDialogVisible = false">取消</el-button>
        <el-button
          type="success"
          :icon="CircleCheck"
          :disabled="!handoverReadiness?.ready && !handoverAcknowledged"
          @click="confirmHandover"
        >
          确认移交并锁定档案
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="withdrawDialogVisible" title="文管所撤回移交" width="560px" append-to-body>
      <div v-if="withdrawHall">
        <p class="handover-lead">
          殿宇「<strong>{{ withdrawHall.name }}</strong>」撤回后将退回「修缮中」，修缮队可恢复编辑构件、层位、病害与工序。
        </p>
        <el-alert
          v-if="withdrawHall.handoverAt"
          :title="`当前档案为 ${formatDateTime(withdrawHall.handoverAt)} 移交的版本`"
          type="info"
          :closable="false"
          show-icon
          class="handover-alert"
        />
        <el-input
          v-model="withdrawReason"
          type="textarea"
          :rows="4"
          maxlength="200"
          show-word-limit
          placeholder="请填写撤回原因 / 发现的漏项，如：前檐东侧新增 2 处起甲原档案未记录"
        />
        <div v-if="withdrawHall.handoverRecords.filter((record) => record.type === 'withdraw').length > 0" class="withdraw-history">
          <h4>历次撤回原因</h4>
          <ul class="withdraw-history__list">
            <li v-for="(record, index) in withdrawHall.handoverRecords.filter((item) => item.type === 'withdraw')" :key="index">
              <span class="mono muted">{{ formatDateTime(record.at) }}</span>
              <span>{{ record.reason }}</span>
            </li>
          </ul>
        </div>
      </div>
      <template #footer>
        <el-button @click="withdrawDialogVisible = false">取消</el-button>
        <el-button type="warning" :icon="RefreshLeft" :disabled="!withdrawReason.trim()" @click="confirmWithdraw">
          填原因并退回修缮中
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.hall-empty {
  margin-top: 16px;
}

.hall-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 16px;
  margin-top: 16px;
}

.hall-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: #ffffff;
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(75, 50, 38, 0.05);
}

.hall-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.hall-card__tags {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}

.hall-card__handover {
  margin: 4px 0 0 !important;
  font-size: 12px;
}

.hall-card__withdraw {
  margin-top: 2px;
}

.handover-lead {
  margin: 0 0 12px;
}

.handover-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 12px;
}

.handover-alert {
  margin-bottom: 12px;
}

.handover-section h4 {
  margin: 12px 0 6px;
  font-size: 14px;
}

.handover-list {
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 180px;
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: 8px;
}

.handover-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px dashed var(--line);
}

.handover-list li:last-child {
  border-bottom: none;
}

.handover-list__main {
  font-size: 13px;
}

.handover-ack {
  margin-top: 12px;
}

.withdraw-history {
  margin-top: 14px;
}

.withdraw-history h4 {
  margin: 0 0 6px;
  font-size: 13px;
  color: #6b6257;
}

.withdraw-history__list {
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 140px;
  overflow: auto;
}

.withdraw-history__list li {
  display: flex;
  gap: 10px;
  padding: 4px 0;
  font-size: 13px;
  border-bottom: 1px dashed var(--line);
}

.hall-card__head h3 {
  margin: 0;
  font-size: 17px;
}

.hall-card__head p {
  margin: 2px 0 0;
  font-size: 12px;
}

.hall-card__badges {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.hall-card__meta {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
  padding: 10px 0 0;
  border-top: 1px dashed var(--line);
}

.hall-card__meta dt {
  font-size: 12px;
  color: #8c8479;
}

.hall-card__meta dd {
  margin: 2px 0 0;
  font-size: 14px;
  font-weight: 600;
}

.hall-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: auto;
}
</style>
