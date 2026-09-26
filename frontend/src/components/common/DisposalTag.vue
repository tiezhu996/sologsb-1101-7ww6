<script setup lang="ts">
import type { DisposalStatus } from '@/types/hall'

withDefaults(
  defineProps<{
    status: DisposalStatus
    size?: 'default' | 'small'
  }>(),
  {
    size: 'default'
  }
)

const tagType: Record<DisposalStatus, 'info' | 'warning' | 'success'> = {
  在册: 'info',
  修缮中: 'warning',
  已移交: 'success'
}
</script>

<template>
  <el-tag :type="tagType[status]" :size="size" effect="dark" round>{{ status }}</el-tag>
</template>
