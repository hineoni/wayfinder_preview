import '@fontsource-variable/onest'
import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './app/app.vue'
import './app/styles.scss'

createApp(App).use(createPinia()).mount('#app')
