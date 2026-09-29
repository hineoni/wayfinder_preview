<script setup lang="ts">
import { Primitive } from 'reka-ui'
/** `primary` — главное действие экрана, `ghost` — действие без рамки, `icon` — квадратная кнопка с иконкой. */
defineProps<{ variant?: 'primary' | 'secondary' | 'ghost'; size?: 'sm'; icon?: boolean }>()
</script>
<template>
  <Primitive
    as="button"
    type="button"
    class="ui-button"
    :class="[
      `ui-button--${variant ?? 'secondary'}`,
      { 'ui-button--sm': size === 'sm', 'ui-button--icon': icon },
    ]"
  >
    <slot />
  </Primitive>
</template>
