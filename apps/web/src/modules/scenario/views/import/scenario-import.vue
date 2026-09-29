<script setup lang="ts">
import {
  CustomInputError,
  importCustomScenario,
  type CustomInputIssue,
  type PreparedDataset,
} from '@wayfinder/dataset'
import { ref, shallowRef, watch } from 'vue'
import UiButton from '../../../../shared/ui/ui-button.vue'
import UiIcon from '../../../../shared/ui/ui-icon.vue'
import csvExample from '../../../../../../../datasets/samples/orders.csv?url'
import jsonExample from '../../../../../../../datasets/samples/scenario.json?url'

const props = defineProps<{ base: PreparedDataset; busy: boolean }>()
const emit = defineEmits<{ build: [dataset: PreparedDataset] }>()
const draft = shallowRef<PreparedDataset>()
const issues = ref<readonly CustomInputIssue[]>([])
const reading = ref(false)
let readId = 0
watch(
  () => props.base,
  () => {
    readId += 1
    draft.value = undefined
    issues.value = []
    reading.value = false
  },
)
async function selectFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  const current = ++readId
  draft.value = undefined
  issues.value = []
  reading.value = false
  if (file === undefined) return
  reading.value = true
  try {
    const bytes = await file.arrayBuffer()
    if (current !== readId) return
    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      if (!/\.csv$/i.test(file.name)) throw new Error('JSON должен быть в UTF-8')
      text = new TextDecoder('windows-1251').decode(bytes)
    }
    draft.value = importCustomScenario(text, file.name, props.base)
  } catch (cause) {
    if (current !== readId) return
    issues.value =
      cause instanceof CustomInputError
        ? cause.issues
        : [
            {
              location: 'Файл',
              message: cause instanceof Error ? cause.message : 'Не удалось прочитать файл',
            },
          ]
  } finally {
    if (current === readId) reading.value = false
  }
}
</script>

<template>
  <section
    class="scenario-import"
    data-tour="import"
    aria-labelledby="scenario-import-title"
  >
    <div class="scenario-import__intro">
      <h2 id="scenario-import-title">Свои данные</h2>
      <p>
        Территория: {{ base.title }}. CSV использует её бригады ({{ base.engineers.length }}); JSON
        задаёт свои. Для новых адресов укажите координаты; переезды к ним будут приближёнными.
      </p>
    </div>
    <label class="scenario-import__file">
      <UiIcon name="upload" />
      <span class="scenario-import__file-text">
        <strong>Выберите файл CSV или JSON</strong>
        <small>
          Пример:
          <a
            :href="csvExample"
            download="orders.csv"
          >
            CSV
          </a>
          или
          <a
            :href="jsonExample"
            download="scenario.json"
          >
            JSON
          </a>
        </small>
      </span>
      <input
        class="scenario-import__input"
        type="file"
        accept=".csv,.json"
        :disabled="busy"
        @change="selectFile"
      />
    </label>
    <div
      v-if="issues.length"
      class="scenario-import__issues"
      role="alert"
    >
      <p>Файл отклонён. Прежний план сохранён.</p>
      <ul>
        <li
          v-for="(issue, index) in issues"
          :key="index"
        >
          {{ issue.location }}: {{ issue.message }}
        </li>
      </ul>
    </div>
    <div class="scenario-import__footer">
      <p
        v-if="reading"
        role="status"
      >
        Читаем файл…
      </p>
      <p
        v-else-if="draft"
        role="status"
      >
        {{ draft.title }}: {{ draft.orders.length }} заявок, {{ draft.engineers.length }} бригад.
        Норматив аварии — 100 минут.
      </p>
      <UiButton
        variant="primary"
        :disabled="!draft || busy || reading"
        @click="draft && emit('build', draft)"
      >
        Построить план
      </UiButton>
    </div>
  </section>
</template>

<style lang="scss">
@use '../../../../shared/ui/mixins' as *;

.scenario-import {
  display: grid;
  gap: var(--space-16);
  max-width: 1632px;
  margin: var(--space-24) auto 0;
  padding: var(--space-20);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);

  @include md {
    margin: var(--space-16) var(--space-16) 0;
  }

  @media (width >= 1681px) {
    width: calc(100% - 48px);
  }

  &__intro {
    display: grid;
    gap: var(--space-4);
    max-width: 72ch;

    p {
      @include caption;
    }
  }

  &__file {
    position: relative;
    display: flex;
    gap: var(--space-16);
    align-items: center;
    padding: var(--space-20);
    color: var(--color-text-muted);
    background: var(--color-sunken);
    border: 1px dashed var(--color-border-strong);
    border-radius: var(--radius-md);
    cursor: pointer;

    &:hover,
    &:focus-within {
      border-color: var(--color-text-muted);
    }

    a {
      position: relative;
      z-index: 1;
    }
  }

  &__file-text {
    display: grid;
    gap: var(--space-2);

    strong {
      color: var(--color-text);
      font-weight: 500;
    }

    small {
      @include caption;
    }
  }

  &__input {
    position: absolute;
    cursor: pointer;
    opacity: 0;
    inset: 0;
  }

  &__issues {
    padding: var(--space-12) var(--space-16);
    color: var(--color-danger);
    font-size: var(--text-sm);
    background: var(--color-danger-soft);
    border-radius: var(--radius-md);
  }

  &__footer {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-12) var(--space-24);
    align-items: center;
    justify-content: flex-end;

    p {
      @include caption;

      margin-right: auto;
    }
  }
}
</style>
