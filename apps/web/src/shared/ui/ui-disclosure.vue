<script setup lang="ts">
import UiIcon from './ui-icon.vue'
import { CollapsibleRoot, CollapsibleTrigger, CollapsibleContent } from 'reka-ui'
defineProps<{ title: string; description?: string }>()
</script>
<template>
  <CollapsibleRoot class="ui-disclosure">
    <CollapsibleTrigger class="ui-disclosure__trigger">
      <span>
        <strong>{{ title }}</strong>
        <small v-if="description">{{ description }}</small>
      </span>
      <UiIcon
        name="chevron-down"
        class="ui-disclosure__chevron"
      />
    </CollapsibleTrigger>
    <CollapsibleContent class="ui-disclosure__content"><slot /></CollapsibleContent>
  </CollapsibleRoot>
</template>
