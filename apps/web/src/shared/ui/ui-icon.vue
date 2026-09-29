<script setup lang="ts">
import { iconPaths, type IconName } from './icons'
defineProps<{ name: IconName }>()
</script>
<template>
  <svg
    class="ui-icon"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path :d="iconPaths[name]" />
  </svg>
</template>
