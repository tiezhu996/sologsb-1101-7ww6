<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { Brush, Plus, Position, Promotion, RefreshLeft, Tools } from '@element-plus/icons-vue'
import EmptyPanel from '@/components/common/EmptyPanel.vue'
import FilterBar, { type FilterModel } from '@/components/common/FilterBar.vue'
import StatBadge from '@/components/common/StatBadge.vue'
import { useHallStore } from '@/stores/hallStore'
import { useDecayStore } from '@/stores/decayStore'
import { useRepairStore } from '@/stores/repairStore'
import { seedDemoData } from '@/utils/export'
import { formatArea } from '@/utils/severity'
import { formatDateTime } from '@/utils/datetime'
import {
  ROOF_TYPES,
  STRUCTURE_TYPES,
  type Hall,
  type HallDisposal,
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
  structure: hallStore.structureFilter
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
  }
])

const cards = computed(() =>
  hallStore.filteredHalls.map((hall) => {
    const stat = hallStore.statMap[hall.id]
    const aggregate = decayStore.hallAggregate[hall.id]
    const risk = decayStore.hallRisk[hall.id] ?? 0
    const steps = repairStore.steps.filter((step) => {
      const decay = decayStore.rows.find((row) => row.decay.id === step.decayId)
      return decay?.hallId === hall.id
    })
    const doneSteps = steps.filter((step) => step.state === '已完成').length
    const stepDecayIds = new Set(steps.map((step) => step.decayId))
    const pendingDecays = decayStore.rows.filter(
      (row) => row.hallId === hall.id && !stepDecayIds.has(row.decay.id)
    ).length
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
      unfinishedSteps: steps.length - doneSteps,
      pendingDecays
    }
  })
)

/** 移交核查弹窗：只存殿宇 id，剩余工作量实时从卡片聚合值取，避免弹窗期间数据过期 */
const handoverVisible = ref(false)
const handoverHallId = ref<string | null>(null)
const handoverSubmitting = ref(false)

const handoverTarget = computed(() => cards.value.find((card) => card.hall.id === handoverHallId.value) ?? null)

/** 未了结项 = 未修复病害 + 未收尾工序 */
const handoverRemaining = computed(() => {
  const target = handoverTarget.value
  if (!target) return 0
  return target.unrepaired + target.unfinishedSteps
})

const recallVisible = ref(false)
const recallHallId = ref<string | null>(null)
const recallReason = ref('')
const recallSubmitting = ref(false)

const recallTarget = computed<Hall | null>(
  () => hallStore.halls.find((hall) => hall.id === recallHallId.value) ?? null
)

const structOptions = STRUCTURE_TYPES.map((type) => ({ label: type, value: type }))
const roofOptions = ROOF_TYPES.map((type) => ({ label: type, value: type }))

function handleFilterChange(value: FilterModel): void {
  hallStore.keyword = value.keyword
  hallStore.eraFilter = Array.isArray(value.era) ? value.era : []
  hallStore.structureFilter = Array.isArray(value.structure) ? value.structure : []
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
      roofType: form.roofType,
      disposal: '在册',
      handedOverAt: null,
      lastRecallReason: '',
      lastRecalledAt: null
    })
    dialogVisible.value = false
    ElMessage.success(`已新建殿宇「${hall.name}」（在册），请继续录入构件与彩画层位`)
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
  if (hall.disposal === '已移交') {
    ElMessage.warning('该殿宇已移交文管所，档案只读，如需删除请先撤回移交')
    return
  }
  const confirmed = await ElMessageBox.confirm(
    `删除殿宇「${hall.name}」将同时删除其构件、层位、病害与工序记录，是否继续？`,
    '删除确认',
    { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
  ).catch(() => false)
  if (!confirmed) return
  await hallStore.removeHall(hall.id)
  ElMessage.success('已删除殿宇及其关联记录')
}

/** 在册 → 修缮中：现场开工，获得编辑权限 */
async function startRepair(hall: Hall): Promise<void> {
  await hallStore.startRepair(hall.id)
  ElMessage.success(`「${hall.name}」已转入修缮中`)
}

/** 修缮中 → 在册 */
async function backToRegistered(hall: Hall): Promise<void> {
  await hallStore.backToRegistered(hall.id)
  ElMessage.success(`「${hall.name}」已退回在册`)
}

/** 点移交：先打开核查弹窗，当场说清剩余未修复病害与未收尾工序 */
function openHandover(hallId: string): void {
  handoverHallId.value = hallId
  handoverVisible.value = true
}

async function confirmHandover(): Promise<void> {
  const target = handoverTarget.value
  if (!target) return
  handoverSubmitting.value = true
  try {
    await hallStore.handoverHall(target.hall.id)
    handoverVisible.value = false
    ElMessage.success(`「${target.hall.name}」已移交文管所，构件、层位、病害与工序转为只读`)
  } finally {
    handoverSubmitting.value = false
  }
}

/** 文管所发现漏项时撤回：预填上次原因，确认后退回修缮中 */
function openRecall(hall: Hall): void {
  recallHallId.value = hall.id
  recallReason.value = hall.lastRecallReason
  recallVisible.value = true
}

async function confirmRecall(): Promise<void> {
  const hall = recallTarget.value
  if (!hall) return
  const reason = recallReason.value.trim()
  if (reason.length === 0) {
    ElMessage.warning('请填写撤回原因（漏项说明），将留档备查')
    return
  }
  recallSubmitting.value = true
  try {
    await hallStore.recallHall(hall.id, reason)
    recallVisible.value = false
    ElMessage.success(`「${hall.name}」已退回修缮中，档案恢复编辑`)
  } finally {
    recallSubmitting.value = false
  }
}

function disposalTagType(disposal: HallDisposal): 'info' | 'warning' | 'success' {
  if (disposal === '已移交') return 'success'
  if (disposal === '修缮中') return 'warning'
  return 'info'
}

async function seed(): Promise<void> {
  await seedDemoData()
  ElMessage.success('已生成本地样例档案，可直接浏览各页面')
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
          </div>
          <div class="hall-card__tags">
            <el-tag :type="disposalTagType(card.hall.disposal)" effect="dark" round size="small">
              {{ card.hall.disposal }}
            </el-tag>
            <el-tag :type="card.unrepaired > 0 ? 'danger' : 'success'" effect="plain" round>
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
            <dt>工序完成</dt>
            <dd class="mono">{{ card.doneSteps }} / {{ card.stepCount }}</dd>
          </div>
          <div>
            <dt>未收尾</dt>
            <dd class="mono" :class="{ 'hall-card__warn': card.unfinishedSteps > 0 }">
              {{ card.unfinishedSteps }} 道
            </dd>
          </div>
        </dl>

        <div v-if="card.hall.disposal === '已移交' || card.hall.lastRecallReason" class="hall-card__disposal">
          <p v-if="card.hall.disposal === '已移交'" class="muted hall-card__handover">
            已于 {{ formatDateTime(card.hall.handedOverAt) }} 移交文管所，档案只读
          </p>
          <p v-if="card.hall.lastRecallReason" class="hall-card__recall">
            上次撤回：{{ card.hall.lastRecallReason }}（{{ formatDateTime(card.hall.lastRecalledAt) }}）
          </p>
        </div>

        <footer class="hall-card__actions">
          <el-button size="small" type="primary" plain :icon="Position" @click="openElements(card.hall)">
            构件与层位
          </el-button>
          <el-button size="small" :icon="Position" @click="openDecays(card.hall)">病害档案</el-button>
          <el-button size="small" :icon="Tools" @click="openRepair(card.hall)">修复工序</el-button>
          <span class="hall-card__actions-flow">
            <el-button
              v-if="card.hall.disposal === '在册'"
              size="small"
              type="warning"
              plain
              :icon="Brush"
              @click="startRepair(card.hall)"
            >
              开始修缮
            </el-button>
            <template v-else-if="card.hall.disposal === '修缮中'">
              <el-button size="small" type="success" plain :icon="Promotion" @click="openHandover(card.hall.id)">
                移交文管所
              </el-button>
              <el-button size="small" text @click="backToRegistered(card.hall)">退回在册</el-button>
            </template>
            <el-button
              v-else
              size="small"
              type="warning"
              plain
              :icon="RefreshLeft"
              @click="openRecall(card.hall)"
            >
              撤回移交
            </el-button>
          </span>
          <el-button
            size="small"
            type="danger"
            text
            :disabled="card.hall.disposal === '已移交'"
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

    <el-dialog v-model="handoverVisible" title="移交文管所 · 移交前核查" width="560px" append-to-body>
      <div v-if="handoverTarget" class="handover-check">
        <p class="handover-check__lead">「{{ handoverTarget.hall.name }}」移交前，请先核对剩余工作量：</p>
        <ul class="handover-check__list">
          <li>
            <span>未修复病害</span>
            <strong :class="{ 'is-zero': handoverTarget.unrepaired === 0 }">
              {{ handoverTarget.unrepaired }} 条
            </strong>
          </li>
          <li>
            <span>未收尾工序（未开始 / 进行中）</span>
            <strong :class="{ 'is-zero': handoverTarget.unfinishedSteps === 0 }">
              {{ handoverTarget.unfinishedSteps }} 道
            </strong>
          </li>
          <li>
            <span>其中尚未安排工序的病害</span>
            <strong :class="{ 'is-zero': handoverTarget.pendingDecays === 0 }">
              {{ handoverTarget.pendingDecays }} 条
            </strong>
          </li>
        </ul>
        <el-alert
          v-if="handoverRemaining > 0"
          type="warning"
          :closable="false"
          show-icon
          :title="`还剩 ${handoverRemaining} 处未了结（未修复病害 + 未收尾工序），请当场与文管所说清`"
          description="确认移交后档案将锁定为只读；文管所验收发现漏项时可撤回，退回修缮中后恢复编辑。"
        />
        <el-alert
          v-else
          type="success"
          :closable="false"
          show-icon
          title="病害与工序均已收尾，可以移交"
          description="确认移交后，该殿宇的构件、层位、病害与工序将只能查看，不能再编辑。"
        />
      </div>
      <template #footer>
        <el-button @click="handoverVisible = false">再改改</el-button>
        <el-button type="primary" :loading="handoverSubmitting" @click="confirmHandover">确认移交</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="recallVisible" title="撤回移交 · 退回修缮中" width="520px" append-to-body>
      <div v-if="recallTarget" class="recall-form">
        <p class="muted">
          「{{ recallTarget.name }}」于 {{ formatDateTime(recallTarget.handedOverAt) }} 移交文管所。
          撤回后退回「修缮中」，构件、层位、病害与工序恢复编辑。
        </p>
        <el-input
          v-model="recallReason"
          type="textarea"
          :rows="3"
          maxlength="120"
          show-word-limit
          placeholder="请填写文管所发现的漏项 / 撤回原因（必填，留档备查）"
        />
        <p v-if="recallTarget.lastRecallReason" class="muted recall-form__last">
          上次撤回原因：{{ recallTarget.lastRecallReason }}（{{ formatDateTime(recallTarget.lastRecalledAt) }}）
        </p>
      </div>
      <template #footer>
        <el-button @click="recallVisible = false">取消</el-button>
        <el-button type="warning" :loading="recallSubmitting" @click="confirmRecall">确认撤回</el-button>
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
  gap: 4px;
}

.hall-card__warn {
  color: #c0392b;
}

.hall-card__disposal {
  margin: -4px 0 0;
  font-size: 12px;
}

.hall-card__handover,
.hall-card__recall {
  margin: 2px 0 0;
}

.hall-card__recall {
  color: #b06b00;
}

.hall-card__actions-flow {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-right: auto;
}

.handover-check__lead {
  margin: 0 0 12px;
  font-weight: 600;
}

.handover-check__list {
  margin: 0 0 14px;
  padding: 0;
  list-style: none;
}

.handover-check__list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  margin-bottom: 8px;
  background: #fbf9f5;
  border: 1px dashed #ddd3c2;
  border-radius: 8px;
}

.handover-check__list strong {
  font-size: 15px;
  color: #c0392b;
}

.handover-check__list strong.is-zero {
  color: #1e8449;
}

.recall-form__last {
  margin: 10px 0 0;
  font-size: 12px;
  color: #b06b00;
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
