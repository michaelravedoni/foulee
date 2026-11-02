import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
import '@fontsource-variable/inter/wght.css';
import '@fontsource/archivo-black/latin-400.css';
import '@fontsource/archivo-black/latin-ext-400.css';
import './design.css';
import './styles.css';

createApp(App).use(router).mount('#app');
