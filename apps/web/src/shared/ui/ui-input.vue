<script setup lang="ts">
import { Primitive } from 'reka-ui'
const model = defineModel<string>({ required: true })
function update(event: Event) {
  if (event.target instanceof HTMLInputElement) model.value = event.target.value
}
</script>
<template>
  <Primitive
    as="input"
    class="ui-input"
    :value="model"
    @input="update"
  />
</template>
