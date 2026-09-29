<script setup lang="ts">
import UiIcon from './ui-icon.vue'
import {
  ComboboxRoot,
  ComboboxAnchor,
  ComboboxInput,
  ComboboxTrigger,
  ComboboxPortal,
  ComboboxContent,
  ComboboxViewport,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxEmpty,
} from 'reka-ui'
/** Выбор из длинного списка (адреса, заявки) с поиском по подписи и пояснению. */
const props = defineProps<{
  options: readonly { value: string; label: string; description?: string }[]
  label: string
  placeholder?: string
  disabled?: boolean
}>()
const model = defineModel<string | undefined>()
function update(value: unknown) {
  if (typeof value === 'string') model.value = value
}
function display(value: unknown): string {
  return props.options.find((option) => option.value === value)?.label ?? ''
}
</script>
<template>
  <ComboboxRoot
    :model-value="model ?? ''"
    :disabled="disabled"
    open-on-click
    class="ui-combobox"
    @update:model-value="update"
  >
    <ComboboxAnchor class="ui-combobox__anchor">
      <UiIcon
        name="search"
        class="ui-combobox__search"
      />
      <ComboboxInput
        class="ui-combobox__input"
        :aria-label="label"
        :placeholder="placeholder ?? 'Найдите по адресу или номеру'"
        :display-value="display"
      />
      <ComboboxTrigger
        class="ui-combobox__trigger"
        aria-label="Показать варианты"
      >
        <UiIcon name="chevron-down" />
      </ComboboxTrigger>
    </ComboboxAnchor>
    <ComboboxPortal>
      <ComboboxContent
        class="ui-popover ui-combobox__content"
        position="popper"
        :side-offset="6"
        :collision-padding="12"
      >
        <ComboboxViewport class="ui-combobox__viewport">
          <ComboboxEmpty class="ui-combobox__empty">Ничего не найдено</ComboboxEmpty>
          <ComboboxItem
            v-for="option in options"
            :key="option.value"
            :value="option.value"
            :text-value="`${option.label} ${option.description ?? ''}`"
            class="ui-combobox__item"
          >
            <span class="ui-combobox__text">
              <span>{{ option.label }}</span>
              <small v-if="option.description">{{ option.description }}</small>
            </span>
            <ComboboxItemIndicator class="ui-combobox__check">
              <UiIcon name="check" />
            </ComboboxItemIndicator>
          </ComboboxItem>
        </ComboboxViewport>
      </ComboboxContent>
    </ComboboxPortal>
  </ComboboxRoot>
</template>
